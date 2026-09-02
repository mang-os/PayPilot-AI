from sqlalchemy.orm import Session

from app.models.audit import AuditEvent

# Canonical event_type vocabulary. Routers/services should use these
# constants rather than free-typing strings, so the dashboard and any
# future analytics can rely on a closed set of event types.
REQUEST_RECEIVED = "REQUEST_RECEIVED"
AGENT_AUTHENTICATED = "AGENT_AUTHENTICATED"
AGENT_AUTH_FAILED = "AGENT_AUTH_FAILED"
PRODUCT_SEARCH = "PRODUCT_SEARCH"
INVENTORY_VERIFIED = "INVENTORY_VERIFIED"
OFFER_SELECTED = "OFFER_SELECTED"
MANDATE_CREATED = "MANDATE_CREATED"
MANDATE_VALIDATED = "MANDATE_VALIDATED"
MANDATE_REJECTED = "MANDATE_REJECTED"
POLICY_APPROVED = "POLICY_APPROVED"
POLICY_REJECTED = "POLICY_REJECTED"
INVENTORY_RESERVED = "INVENTORY_RESERVED"
INVENTORY_RELEASED = "INVENTORY_RELEASED"
RAZORPAY_ORDER_CREATED = "RAZORPAY_ORDER_CREATED"
RAZORPAY_TIMEOUT = "RAZORPAY_TIMEOUT"
RETRY_ATTEMPTED = "RETRY_ATTEMPTED"
ESCALATED = "ESCALATED"
DUPLICATE_CHECKOUT_DETECTED = "DUPLICATE_CHECKOUT_DETECTED"
DUPLICATE_COMPLETION_DETECTED = "DUPLICATE_COMPLETION_DETECTED"
WEBHOOK_RECEIVED = "WEBHOOK_RECEIVED"
WEBHOOK_SIGNATURE_INVALID = "WEBHOOK_SIGNATURE_INVALID"
PAYMENT_VERIFIED = "PAYMENT_VERIFIED"
PAYMENT_FAILED = "PAYMENT_FAILED"
ORDER_COMPLETED = "ORDER_COMPLETED"
ORDER_FAILED = "ORDER_FAILED"
CHECKOUT_CREATED = "CHECKOUT_CREATED"
CHECKOUT_UPDATED = "CHECKOUT_UPDATED"


def log_event(
    db: Session,
    event_type: str,
    message: str = "",
    checkout_id: str | None = None,
    agent_id: str | None = None,
    payload: dict | None = None,
) -> AuditEvent:
    event = AuditEvent(
        event_type=event_type,
        checkout_id=checkout_id,
        agent_id=agent_id,
        message=message,
        payload=payload,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
