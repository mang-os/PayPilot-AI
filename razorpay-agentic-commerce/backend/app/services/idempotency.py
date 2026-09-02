import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.checkout import CheckoutSession


def derive_key(agent_id: str, items: list[dict], offer_code: str | None, mandate_id: str | None) -> str:
    """If the agent doesn't supply an explicit Idempotency-Key, derive a
    stable one from the request contents so an accidental network-retry
    of the exact same checkout request is still caught."""
    canonical = json.dumps(
        {"agent_id": agent_id, "items": items, "offer_code": offer_code, "mandate_id": mandate_id},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def find_existing(db: Session, idempotency_key: str) -> CheckoutSession | None:
    stmt = select(CheckoutSession).where(CheckoutSession.idempotency_key == idempotency_key)
    return db.execute(stmt).scalar_one_or_none()
