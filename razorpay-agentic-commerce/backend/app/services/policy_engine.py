"""
Deterministic Policy Engine. Every check the spec lists is implemented as
its own small function returning a violation string or None, and
validate_checkout_completion runs all of them and collects every failure
before raising - so a buyer agent gets a complete picture in one round
trip instead of discovering violations one at a time.

Nothing here is an LLM call. This entire module is boring, deterministic
Python and SQL on purpose.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import timeutils
from app.errors import PolicyViolationError
from app.models.agents import AgentRegistry, AgentStatus, CartMandate, MandateStatus
from app.models.catalog import Inventory
from app.models.checkout import CheckoutSession, CheckoutStatus, Order, OrderStatus
from app.services import mandate_service
from app.services.checkout_engine import CheckoutTotals


@dataclass
class Violation:
    code: str
    message: str


def _check_agent(agent: AgentRegistry) -> Violation | None:
    if agent.status != AgentStatus.ACTIVE:
        return Violation("AGENT_NOT_ACTIVE", f"Agent status is {agent.status.value}, not ACTIVE.")
    return None


def _check_inventory(db: Session, totals: CheckoutTotals) -> list[Violation]:
    violations = []
    for item in totals.items:
        inv = db.execute(select(Inventory).where(Inventory.product_id == item.product_id)).scalar_one_or_none()
        available = inv.quantity_available if inv else 0
        if available < item.quantity:
            violations.append(
                Violation(
                    "INVENTORY_UNAVAILABLE",
                    f"Requested {item.quantity} of '{item.name}' but only {available} available.",
                )
            )
    return violations


def _check_transaction_limit(agent: AgentRegistry, totals: CheckoutTotals) -> Violation | None:
    if totals.final_amount > float(agent.max_transaction_limit):
        return Violation(
            "TRANSACTION_LIMIT_EXCEEDED",
            f"Final amount {totals.final_amount:.2f} exceeds agent transaction limit {float(agent.max_transaction_limit):.2f}.",
        )
    return None


def _check_daily_limit(db: Session, agent: AgentRegistry, totals: CheckoutTotals) -> Violation | None:
    today_start = timeutils.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    spent_today = db.execute(
        select(func.coalesce(func.sum(Order.final_amount), 0)).where(
            Order.agent_id == agent.id,
            Order.status == OrderStatus.PAID,
            Order.created_at >= today_start,
        )
    ).scalar_one()
    projected = float(spent_today) + totals.final_amount
    if projected > float(agent.max_daily_limit):
        return Violation(
            "DAILY_LIMIT_EXCEEDED",
            f"Today's spend {float(spent_today):.2f} + this order {totals.final_amount:.2f} = "
            f"{projected:.2f}, exceeding daily limit {float(agent.max_daily_limit):.2f}.",
        )
    return None


def _check_mandate(db: Session, agent: AgentRegistry, mandate_id: str | None, totals: CheckoutTotals) -> list[Violation]:
    violations = []
    if mandate_id is None:
        violations.append(Violation("MANDATE_MISSING", "No mandate_id attached to this checkout."))
        return violations

    mandate = db.get(CartMandate, mandate_id)
    if mandate is None:
        violations.append(Violation("MANDATE_INVALID", f"Mandate '{mandate_id}' does not exist."))
        return violations

    if mandate.agent_id != agent.id:
        violations.append(Violation("MANDATE_INVALID", "Mandate does not belong to the authenticated agent."))
        return violations

    if mandate.status != MandateStatus.ACTIVE:
        violations.append(Violation("MANDATE_INVALID", f"Mandate status is {mandate.status.value}, not ACTIVE."))

    if mandate.expires_at < timeutils.utcnow():
        violations.append(Violation("MANDATE_EXPIRED", f"Mandate expired at {mandate.expires_at.isoformat()}."))

    if totals.final_amount > float(mandate.max_amount):
        violations.append(
            Violation(
                "MANDATE_AMOUNT_EXCEEDED",
                f"Final amount {totals.final_amount:.2f} exceeds mandate limit {float(mandate.max_amount):.2f}.",
            )
        )

    # Defense in depth: re-verify the cryptographic signature against the
    # *stored* payload string, again, right here at spend time - not just
    # trusting that it was checked once at mandate-creation time. We reuse
    # the exact signed_payload bytes rather than reconstructing them from
    # `expires_at`, since a DB round-trip cannot be guaranteed to reproduce
    # byte-identical isoformat() output.
    if not mandate_service.verify_signature(agent.public_key, mandate.signed_payload.encode("utf-8"), mandate.signature):
        violations.append(Violation("MANDATE_INVALID", "Mandate signature does not verify against agent's public key."))

    return violations


def _check_checkout_consistency(checkout: CheckoutSession, agent: AgentRegistry) -> Violation | None:
    if checkout.agent_id != agent.id:
        return Violation("CHECKOUT_STATE_INVALID", "Checkout does not belong to the authenticated agent.")
    if checkout.status not in (CheckoutStatus.CREATED, CheckoutStatus.UPDATED):
        return Violation("CHECKOUT_STATE_INVALID", f"Checkout status is {checkout.status.value}; cannot complete.")
    return None


def validate_checkout_completion(
    db: Session,
    checkout: CheckoutSession,
    agent: AgentRegistry,
    totals: CheckoutTotals,
) -> None:
    """Runs every policy check from the spec. Raises PolicyViolationError
    with all violations attached if any fail; returns None (silently) on
    a clean pass. Product existence, offer existence/active-ness, and cart
    minimum are already enforced by checkout_engine.compute_totals, which
    is called before this - so they don't need to be re-checked here."""
    violations: list[Violation] = []

    consistency = _check_checkout_consistency(checkout, agent)
    if consistency:
        violations.append(consistency)

    agent_violation = _check_agent(agent)
    if agent_violation:
        violations.append(agent_violation)

    violations.extend(_check_inventory(db, totals))

    txn_violation = _check_transaction_limit(agent, totals)
    if txn_violation:
        violations.append(txn_violation)

    daily_violation = _check_daily_limit(db, agent, totals)
    if daily_violation:
        violations.append(daily_violation)

    violations.extend(_check_mandate(db, agent, checkout.mandate_id, totals))

    if violations:
        raise PolicyViolationError(
            f"{len(violations)} policy violation(s) blocked this checkout.",
            details={"violations": [{"code": v.code, "message": v.message} for v in violations]},
        )
