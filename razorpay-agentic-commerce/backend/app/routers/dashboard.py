from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import timeutils
from app.database import get_db
from app.models.audit import AuditEvent
from app.models.agents import CartMandate
from app.models.catalog import Inventory, Offer, Product
from app.models.checkout import CheckoutSession, CheckoutStatus, Order, Transaction
from app.schemas.catalog import StorefrontCatalogResponse
from app.schemas.checkout import DashboardCheckoutDetailResponse

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

FAILURE_EVENT_TYPES = {
    "AGENT_AUTH_FAILED",
    "MANDATE_REJECTED",
    "POLICY_REJECTED",
    "RAZORPAY_TIMEOUT",
    "ESCALATED",
    "DUPLICATE_CHECKOUT_DETECTED",
    "WEBHOOK_SIGNATURE_INVALID",
    "PAYMENT_FAILED",
    "ORDER_FAILED",
}


@router.get("/catalog", response_model=StorefrontCatalogResponse)
def get_catalog(db: Session = Depends(get_db)):
    """Return active storefront data without invoking agent or payment flows."""
    now = timeutils.utcnow()
    product_rows = db.execute(
        select(Product, Inventory)
        .outerjoin(Inventory, Inventory.product_id == Product.id)
        .where(Product.is_active.is_(True))
        .order_by(Product.name.asc())
    ).all()
    offers = db.execute(
        select(Offer)
        .where(
            Offer.is_active.is_(True),
            Offer.valid_from <= now,
            or_(Offer.valid_until.is_(None), Offer.valid_until >= now),
        )
        .order_by(Offer.code.asc())
    ).scalars().all()

    return {
        "products": [
            {
                "id": product.id,
                "sku": product.sku,
                "name": product.name,
                "description": product.description,
                "category": product.category,
                "price": float(product.price),
                "image_url": product.image_url,
                "inventory": (
                    {
                        "quantity_available": inventory.quantity_available,
                        "reserved_quantity": inventory.reserved_quantity,
                    }
                    if inventory
                    else None
                ),
            }
            for product, inventory in product_rows
        ],
        "offers": [
            {
                "code": offer.code,
                "description": offer.description,
                "discount_type": offer.discount_type.value,
                "discount_value": float(offer.discount_value),
                "min_cart_amount": float(offer.min_cart_amount),
                "max_discount_amount": float(offer.max_discount_amount) if offer.max_discount_amount is not None else None,
                "valid_from": offer.valid_from,
                "valid_until": offer.valid_until,
                "is_active": offer.is_active,
            }
            for offer in offers
        ],
    }


@router.get("/transactions")
def list_transactions(db: Session = Depends(get_db), limit: int = Query(50, le=200)):
    rows = db.execute(
        select(Order, Transaction)
        .join(Transaction, Transaction.order_id == Order.id, isouter=True)
        .order_by(Order.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "order_id": order.id,
            "checkout_id": order.checkout_session_id,
            "agent_id": order.agent_id,
            "final_amount": float(order.final_amount),
            "currency": order.currency,
            "status": order.status.value,
            "razorpay_payment_id": txn.razorpay_payment_id if txn else None,
            "transaction_status": txn.status.value if txn else None,
            "created_at": order.created_at.isoformat(),
        }
        for order, txn in rows
    ]


@router.get("/checkouts")
def list_checkouts(db: Session = Depends(get_db), limit: int = Query(50, le=200)):
    """Backs the checkout-picker in the Agent Trace screen."""
    rows = db.execute(select(CheckoutSession).order_by(CheckoutSession.created_at.desc()).limit(limit)).scalars().all()
    return [
        {
            "checkout_id": c.id,
            "agent_id": c.agent_id,
            "status": c.status.value,
            "final_amount": float(c.final_amount) if c.final_amount is not None else None,
            "created_at": c.created_at.isoformat(),
        }
        for c in rows
    ]


@router.get("/checkouts/{checkout_id}", response_model=DashboardCheckoutDetailResponse)
def get_checkout_detail(checkout_id: str, db: Session = Depends(get_db)):
    """Return a safe dashboard view of a persisted checkout and mandate."""
    checkout = db.get(CheckoutSession, checkout_id)
    if checkout is None:
        raise HTTPException(status_code=404, detail="Checkout not found.")

    mandate = db.get(CartMandate, checkout.mandate_id) if checkout.mandate_id else None
    return {
        "checkout_id": checkout.id,
        "agent_id": checkout.agent_id,
        "status": checkout.status.value,
        "items": [
            {
                "product_id": item["product_id"],
                "name": item["name"],
                "quantity": item["quantity"],
                "unit_price": float(item["unit_price"]),
            }
            for item in checkout.items
        ],
        "offer_code": checkout.offer_code,
        "subtotal": float(checkout.subtotal) if checkout.subtotal is not None else None,
        "discount_amount": float(checkout.discount_amount) if checkout.discount_amount is not None else None,
        "tax_amount": float(checkout.tax_amount) if checkout.tax_amount is not None else None,
        "final_amount": float(checkout.final_amount) if checkout.final_amount is not None else None,
        "currency": checkout.currency,
        "razorpay_order_id": checkout.razorpay_order_id,
        "failure_reason": checkout.failure_reason,
        "created_at": checkout.created_at,
        "updated_at": checkout.updated_at,
        "mandate": (
            {
                "mandate_id": mandate.id,
                "max_amount": float(mandate.max_amount),
                "currency": mandate.currency,
                "expires_at": mandate.expires_at,
                "status": mandate.status.value,
            }
            if mandate
            else None
        ),
    }


@router.get("/agent-trace/{checkout_id}")
def agent_trace(checkout_id: str, db: Session = Depends(get_db)):
    events = db.execute(
        select(AuditEvent).where(AuditEvent.checkout_id == checkout_id).order_by(AuditEvent.created_at.asc())
    ).scalars().all()
    return [
        {
            "id": e.id,
            "event_type": e.event_type,
            "message": e.message,
            "payload": e.payload,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.get("/failures")
def list_failures(db: Session = Depends(get_db), limit: int = Query(100, le=500)):
    events = db.execute(
        select(AuditEvent)
        .where(AuditEvent.event_type.in_(FAILURE_EVENT_TYPES))
        .order_by(AuditEvent.created_at.desc())
        .limit(limit)
    ).scalars().all()
    failed_checkouts = db.execute(
        select(CheckoutSession).where(CheckoutSession.status == CheckoutStatus.FAILED).order_by(CheckoutSession.updated_at.desc()).limit(limit)
    ).scalars().all()
    return {
        "failure_events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "checkout_id": e.checkout_id,
                "agent_id": e.agent_id,
                "message": e.message,
                "payload": e.payload,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
        "failed_checkouts": [
            {
                "checkout_id": c.id,
                "agent_id": c.agent_id,
                "failure_reason": c.failure_reason,
                "final_amount": float(c.final_amount) if c.final_amount is not None else None,
                "updated_at": c.updated_at.isoformat(),
            }
            for c in failed_checkouts
        ],
    }
