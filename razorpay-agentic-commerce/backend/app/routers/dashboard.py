from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.audit import AuditEvent
from app.models.checkout import CheckoutSession, CheckoutStatus, Order, Transaction

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
