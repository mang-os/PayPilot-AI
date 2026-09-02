"""
"Never trust frontend success. Only trust verified server-side webhook
events." This file is the only code path in the whole system that marks
a checkout COMPLETED or moves an Order to PAID - there is no endpoint
where a client can just claim "payment succeeded" and have it believed.
"""
import json

from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.orm import Session
from fastapi import Depends

from app.database import get_db
from app.errors import WebhookSignatureInvalidError
from app.models.agents import CartMandate, MandateStatus
from app.models.catalog import Inventory
from app.models.checkout import CheckoutSession, CheckoutStatus, Order, OrderStatus, Transaction, TransactionStatus
from app.services import audit_service as audit
from app.services import razorpay_service

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/razorpay")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    raw_body = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")

    if not razorpay_service.verify_webhook_signature(raw_body, signature):
        audit.log_event(db, audit.WEBHOOK_SIGNATURE_INVALID, "Webhook signature verification failed - event ignored.")
        raise WebhookSignatureInvalidError("Invalid webhook signature.")

    payload = json.loads(raw_body)
    event = payload.get("event", "")
    entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    razorpay_order_id = entity.get("order_id")
    razorpay_payment_id = entity.get("id")

    audit.log_event(db, audit.WEBHOOK_RECEIVED, f"Webhook event={event} order_id={razorpay_order_id}", payload={"event": event, "razorpay_order_id": razorpay_order_id})

    checkout = db.execute(select(CheckoutSession).where(CheckoutSession.razorpay_order_id == razorpay_order_id)).scalar_one_or_none()
    if checkout is None:
        # Unknown order - ack anyway (per Razorpay's retry semantics) but log it.
        audit.log_event(db, audit.WEBHOOK_RECEIVED, f"No checkout found for razorpay_order_id={razorpay_order_id}; ignoring.")
        return {"status": "ignored", "reason": "unknown_order_id"}

    # Webhook idempotency: Razorpay may redeliver the same event.
    existing_txn = db.execute(
        select(Transaction).where(Transaction.razorpay_payment_id == razorpay_payment_id)
    ).scalar_one_or_none()
    if existing_txn is not None:
        audit.log_event(db, audit.WEBHOOK_RECEIVED, f"Duplicate webhook delivery for payment {razorpay_payment_id}; already processed.", checkout_id=checkout.id, agent_id=checkout.agent_id)
        return {"status": "already_processed"}

    if event == "payment.captured":
        _handle_captured(db, checkout, razorpay_payment_id, entity)
    elif event == "payment.failed":
        _handle_failed(db, checkout, razorpay_payment_id, entity)
    else:
        audit.log_event(db, audit.WEBHOOK_RECEIVED, f"Unhandled event type '{event}' - no state change.", checkout_id=checkout.id, agent_id=checkout.agent_id)

    return {"status": "processed"}


def _handle_captured(db: Session, checkout: CheckoutSession, payment_id: str, entity: dict) -> None:
    order = Order(
        checkout_session_id=checkout.id,
        agent_id=checkout.agent_id,
        items=checkout.items,
        subtotal=checkout.subtotal,
        discount_amount=checkout.discount_amount,
        tax_amount=checkout.tax_amount,
        final_amount=checkout.final_amount,
        currency=checkout.currency,
        status=OrderStatus.PAID,
    )
    db.add(order)
    db.flush()  # get order.id before creating the transaction row

    txn = Transaction(
        order_id=order.id,
        razorpay_order_id=checkout.razorpay_order_id,
        razorpay_payment_id=payment_id,
        razorpay_signature=entity.get("signature") if isinstance(entity, dict) else None,
        status=TransactionStatus.CAPTURED,
        amount=checkout.final_amount,
        currency=checkout.currency,
        raw_webhook_payload=entity,
    )
    db.add(txn)

    # Finalize inventory: the reservation is now a real, permanent
    # deduction. quantity_available was already reduced at reservation
    # time, so we only need to clear the reservation itself.
    for item in checkout.items:
        inv = db.execute(select(Inventory).where(Inventory.product_id == item["product_id"])).scalar_one()
        inv.reserved_quantity -= item["quantity"]

    checkout.status = CheckoutStatus.COMPLETED
    db.commit()

    audit.log_event(db, audit.PAYMENT_VERIFIED, f"Payment {payment_id} verified via webhook", checkout_id=checkout.id, agent_id=checkout.agent_id)
    audit.log_event(db, audit.ORDER_COMPLETED, f"Order {order.id} completed", checkout_id=checkout.id, agent_id=checkout.agent_id, payload={"order_id": order.id, "final_amount": float(checkout.final_amount)})


def _handle_failed(db: Session, checkout: CheckoutSession, payment_id: str, entity: dict) -> None:
    order = Order(
        checkout_session_id=checkout.id,
        agent_id=checkout.agent_id,
        items=checkout.items,
        subtotal=checkout.subtotal,
        discount_amount=checkout.discount_amount,
        tax_amount=checkout.tax_amount,
        final_amount=checkout.final_amount,
        currency=checkout.currency,
        status=OrderStatus.FAILED,
    )
    db.add(order)
    db.flush()

    txn = Transaction(
        order_id=order.id,
        razorpay_order_id=checkout.razorpay_order_id,
        razorpay_payment_id=payment_id,
        status=TransactionStatus.FAILED,
        amount=checkout.final_amount,
        currency=checkout.currency,
        raw_webhook_payload=entity,
    )
    db.add(txn)

    # Release the reservation and free the mandate - the authorization was
    # never actually used, so it should be available for a retry.
    for item in checkout.items:
        inv = db.execute(select(Inventory).where(Inventory.product_id == item["product_id"])).scalar_one()
        inv.quantity_available += item["quantity"]
        inv.reserved_quantity -= item["quantity"]

    if checkout.mandate_id:
        mandate = db.get(CartMandate, checkout.mandate_id)
        if mandate and mandate.status == MandateStatus.CONSUMED:
            mandate.status = MandateStatus.ACTIVE

    checkout.status = CheckoutStatus.FAILED
    checkout.failure_reason = "payment_failed"
    db.commit()

    audit.log_event(db, audit.PAYMENT_FAILED, f"Payment {payment_id} failed per webhook", checkout_id=checkout.id, agent_id=checkout.agent_id)
    audit.log_event(db, audit.ORDER_FAILED, f"Order for checkout {checkout.id} failed; inventory released, mandate freed for retry.", checkout_id=checkout.id, agent_id=checkout.agent_id)
