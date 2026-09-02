from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.errors import CheckoutStateError, PolicyViolationError, RazorpayTimeoutError
from app.models.agents import AgentRegistry, CartMandate, MandateStatus
from app.models.catalog import Inventory
from app.models.checkout import CheckoutSession, CheckoutStatus
from app.schemas.checkout import (
    CheckoutCompleteResponse,
    CheckoutCreateRequest,
    CheckoutResponse,
    CheckoutUpdateRequest,
)
from app.services import audit_service as audit
from app.services import checkout_engine, idempotency, policy_engine, razorpay_service
from app.services.agent_auth import get_current_agent
from app.config import settings

router = APIRouter(prefix="/acp/checkouts", tags=["acp-checkouts"])


def _to_response(checkout: CheckoutSession, cls=CheckoutResponse, **extra):
    return cls(
        checkout_id=checkout.id,
        status=checkout.status.value,
        items=checkout.items,
        offer_code=checkout.offer_code,
        mandate_id=checkout.mandate_id,
        subtotal=checkout.subtotal,
        discount_amount=checkout.discount_amount,
        tax_amount=checkout.tax_amount,
        final_amount=checkout.final_amount,
        currency=checkout.currency,
        razorpay_order_id=checkout.razorpay_order_id,
        failure_reason=checkout.failure_reason,
        created_at=checkout.created_at,
        updated_at=checkout.updated_at,
        **extra,
    )


def _apply_totals(checkout: CheckoutSession, totals: checkout_engine.CheckoutTotals) -> None:
    checkout.items = [
        {"product_id": li.product_id, "name": li.name, "quantity": li.quantity, "unit_price": li.unit_price}
        for li in totals.items
    ]
    checkout.subtotal = totals.subtotal
    checkout.discount_amount = totals.discount_amount
    checkout.tax_amount = totals.tax_amount
    checkout.final_amount = totals.final_amount
    checkout.currency = totals.currency


@router.post("", response_model=CheckoutResponse)
def create_checkout(
    body: CheckoutCreateRequest,
    request: Request,
    agent: AgentRegistry = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    request.state.agent_id = agent.id
    items_raw = [item.model_dump() for item in body.items]
    audit.log_event(db, audit.REQUEST_RECEIVED, "Checkout create request", agent_id=agent.id, payload={"items": items_raw})
    audit.log_event(db, audit.AGENT_AUTHENTICATED, "Agent authenticated", agent_id=agent.id)

    idem_key = body.idempotency_key or idempotency.derive_key(agent.id, items_raw, body.offer_code, body.mandate_id)
    existing = idempotency.find_existing(db, idem_key)
    if existing is not None:
        audit.log_event(
            db,
            audit.DUPLICATE_CHECKOUT_DETECTED,
            f"Duplicate checkout request matched existing checkout {existing.id}; returning it instead of creating a new one.",
            checkout_id=existing.id,
            agent_id=agent.id,
        )
        return _to_response(existing)

    totals = checkout_engine.compute_totals(db, items_raw, body.offer_code)
    audit.log_event(db, audit.INVENTORY_VERIFIED, "Line items resolved against live catalog", agent_id=agent.id)
    if body.offer_code:
        audit.log_event(db, audit.OFFER_SELECTED, f"Offer '{body.offer_code}' applied", agent_id=agent.id)

    checkout = CheckoutSession(
        agent_id=agent.id,
        status=CheckoutStatus.CREATED,
        offer_code=body.offer_code,
        mandate_id=body.mandate_id,
        idempotency_key=idem_key,
    )
    _apply_totals(checkout, totals)
    db.add(checkout)
    db.commit()
    db.refresh(checkout)

    audit.log_event(db, audit.CHECKOUT_CREATED, f"Checkout {checkout.id} created, final_amount={checkout.final_amount}", checkout_id=checkout.id, agent_id=agent.id)
    return _to_response(checkout)


@router.patch("/{checkout_id}", response_model=CheckoutResponse)
def update_checkout(
    checkout_id: str,
    body: CheckoutUpdateRequest,
    request: Request,
    agent: AgentRegistry = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    request.state.agent_id = agent.id
    checkout = db.get(CheckoutSession, checkout_id)
    if checkout is None or checkout.agent_id != agent.id:
        raise CheckoutStateError(f"Checkout '{checkout_id}' not found for this agent.")
    if checkout.status not in (CheckoutStatus.CREATED, CheckoutStatus.UPDATED):
        raise CheckoutStateError(f"Checkout status is {checkout.status.value}; cannot update.")

    audit.log_event(db, audit.REQUEST_RECEIVED, "Checkout update request", checkout_id=checkout.id, agent_id=agent.id)

    items_raw = [item.model_dump() for item in body.items] if body.items is not None else checkout.items
    offer_code = body.offer_code if body.offer_code is not None else checkout.offer_code
    mandate_id = body.mandate_id if body.mandate_id is not None else checkout.mandate_id

    totals = checkout_engine.compute_totals(db, items_raw, offer_code)
    _apply_totals(checkout, totals)
    checkout.offer_code = offer_code
    checkout.mandate_id = mandate_id
    checkout.status = CheckoutStatus.UPDATED
    db.commit()
    db.refresh(checkout)

    audit.log_event(db, audit.CHECKOUT_UPDATED, f"Checkout {checkout.id} updated, final_amount={checkout.final_amount}", checkout_id=checkout.id, agent_id=agent.id)
    return _to_response(checkout)


@router.post("/{checkout_id}/complete", response_model=CheckoutCompleteResponse)
def complete_checkout(
    checkout_id: str,
    request: Request,
    agent: AgentRegistry = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    request.state.agent_id = agent.id
    checkout = db.get(CheckoutSession, checkout_id)
    if checkout is None or checkout.agent_id != agent.id:
        raise CheckoutStateError(f"Checkout '{checkout_id}' not found for this agent.")

    audit.log_event(db, audit.REQUEST_RECEIVED, "Checkout complete request", checkout_id=checkout.id, agent_id=agent.id)

    # Idempotency against retries of THIS endpoint itself (distinct from
    # idempotency.py, which only covers duplicate checkout *creation*).
    # If a Razorpay order already exists on this checkout, a previous call
    # already ran policy validation, consumed the mandate, and reserved
    # inventory - re-running any of that here would incorrectly reject the
    # mandate (it's now CONSUMED, not ACTIVE) and orphan the reservation
    # the first call made. Whether payment is still pending or has already
    # resolved (via webhook, possibly concurrently with this very request),
    # the correct response to a retry is always "here's what's already
    # true", never "let me redo the money-moving steps".
    if checkout.razorpay_order_id is not None:
        audit.log_event(
            db,
            audit.DUPLICATE_COMPLETION_DETECTED,
            f"Checkout {checkout.id} already has Razorpay order {checkout.razorpay_order_id}; "
            "returning the existing result instead of re-running policy/mandate/inventory logic.",
            checkout_id=checkout.id,
            agent_id=agent.id,
        )
        return _to_response(
            checkout,
            cls=CheckoutCompleteResponse,
            razorpay_key_id=settings.RAZORPAY_KEY_ID or "rzp_test_MOCKMODE",
        )

    # Re-price from scratch, right before payment - never trust the
    # snapshot taken at create/update time, which may be stale.
    try:
        totals = checkout_engine.compute_totals(db, checkout.items, checkout.offer_code)
    except Exception as exc:
        checkout.status = CheckoutStatus.FAILED
        checkout.failure_reason = str(exc)
        db.commit()
        audit.log_event(db, audit.ORDER_FAILED, f"Repricing at completion failed: {exc}", checkout_id=checkout.id, agent_id=agent.id)
        raise
    _apply_totals(checkout, totals)
    db.commit()

    try:
        policy_engine.validate_checkout_completion(db, checkout, agent, totals)
    except PolicyViolationError as exc:
        checkout.status = CheckoutStatus.FAILED
        checkout.failure_reason = exc.message
        db.commit()
        audit.log_event(
            db, audit.POLICY_REJECTED, exc.message, checkout_id=checkout.id, agent_id=agent.id,
            payload=exc.details,
        )
        raise

    audit.log_event(db, audit.POLICY_APPROVED, "All policy checks passed", checkout_id=checkout.id, agent_id=agent.id)

    # Lock the mandate now that we're committing to a payment attempt -
    # prevents the same mandate being used by a second, concurrent checkout.
    mandate = db.get(CartMandate, checkout.mandate_id)
    mandate.status = MandateStatus.CONSUMED
    db.commit()
    audit.log_event(db, audit.MANDATE_VALIDATED, f"Mandate {mandate.id} validated and consumed", checkout_id=checkout.id, agent_id=agent.id)

    # Reserve inventory (move from available -> reserved) before contacting
    # Razorpay, so stock can't be double-sold while payment is in flight.
    for item in totals.items:
        inv = db.execute(select(Inventory).where(Inventory.product_id == item.product_id)).scalar_one()
        inv.quantity_available -= item.quantity
        inv.reserved_quantity += item.quantity
    db.commit()
    audit.log_event(db, audit.INVENTORY_RESERVED, "Inventory reserved for pending payment", checkout_id=checkout.id, agent_id=agent.id)

    try:
        order = razorpay_service.create_order(
            amount_paise=checkout_engine.to_paise(totals.final_amount),
            currency=totals.currency,
            receipt=checkout.id,
            notes={"checkout_id": checkout.id, "agent_id": agent.id},
        )
    except RazorpayTimeoutError as exc:
        _release_reservation(db, totals)
        mandate.status = MandateStatus.ACTIVE  # payment never attempted - free the mandate for retry
        # This is a RETRYABLE failure (exc.retryable is True): leave the
        # checkout in UPDATED, not FAILED. FAILED is terminal - the policy
        # engine's own consistency check refuses to complete a FAILED
        # checkout - so marking it FAILED here would silently contradict
        # the "retryable: true" this error reports to the agent. The same
        # checkout_id can be POSTed to /complete again once Razorpay recovers.
        checkout.status = CheckoutStatus.UPDATED
        checkout.failure_reason = "razorpay_timeout"
        db.commit()
        audit.log_event(db, audit.RAZORPAY_TIMEOUT, str(exc), checkout_id=checkout.id, agent_id=agent.id)
        audit.log_event(db, audit.ESCALATED, "Razorpay order creation exhausted retries; inventory released, mandate freed. Checkout left in UPDATED state so the agent can retry /complete on the same checkout_id.", checkout_id=checkout.id, agent_id=agent.id)
        raise

    checkout.razorpay_order_id = order["id"]
    checkout.failure_reason = None
    db.commit()
    db.refresh(checkout)
    audit.log_event(db, audit.RAZORPAY_ORDER_CREATED, f"Razorpay order {order['id']} created", checkout_id=checkout.id, agent_id=agent.id, payload={"razorpay_order_id": order["id"], "amount_paise": order["amount"]})

    return _to_response(
        checkout,
        cls=CheckoutCompleteResponse,
        razorpay_key_id=settings.RAZORPAY_KEY_ID or "rzp_test_MOCKMODE",
    )


def _release_reservation(db: Session, totals: checkout_engine.CheckoutTotals) -> None:
    for item in totals.items:
        inv = db.execute(select(Inventory).where(Inventory.product_id == item.product_id)).scalar_one()
        inv.quantity_available += item.quantity
        inv.reserved_quantity -= item.quantity
    db.commit()
