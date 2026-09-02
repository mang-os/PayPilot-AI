"""
This router + acp_checkouts.py together form the "Protocol Adapter Layer +
Agent Commerce API" from the architecture diagram: they normalize an
external buyer agent's request (whether a free-text query or a structured
ACP call) into calls against the deterministic services underneath.

/agent-commerce/query is advisory-only and read-only - it never creates a
checkout, mandate, or DB write beyond audit logging. /agent-commerce/mandates
is the one write in this router, and it's gated entirely by signature
verification.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import timeutils
from app.database import get_db
from app.errors import AgentAuthError, MandateInvalidError
from app.models.agents import AgentRegistry, CartMandate, MandateStatus
from app.orchestrator.merchant_agent import MerchantAgent
from app.schemas.agents import AgentQueryRequest, AgentQueryResponse, MandateCreateRequest, MandateCreateResponse
from app.services import mandate_service
from app.services.agent_auth import get_current_agent
from app.services import audit_service as audit

router = APIRouter(prefix="/agent-commerce", tags=["agent-commerce"])


@router.post("/query", response_model=AgentQueryResponse)
def query_merchant_agent(
    body: AgentQueryRequest,
    request: Request,
    agent: AgentRegistry = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    request.state.agent_id = agent.id
    audit.log_event(db, audit.REQUEST_RECEIVED, f"Agent query: {body.query!r}", agent_id=agent.id)
    audit.log_event(db, audit.AGENT_AUTHENTICATED, "Agent authenticated for query", agent_id=agent.id)

    merchant_agent = MerchantAgent()
    result = merchant_agent.handle_query(db, body.query)

    audit.log_event(
        db,
        audit.PRODUCT_SEARCH,
        f"Orchestrator returned {len(result.matched_products)} product(s)",
        agent_id=agent.id,
        payload={"product_ids": [p.id for p in result.matched_products], "offer_code": result.suggested_offer.code if result.suggested_offer else None},
    )
    return result


@router.post("/mandates", response_model=MandateCreateResponse)
def create_mandate(
    body: MandateCreateRequest,
    request: Request,
    agent: AgentRegistry = Depends(get_current_agent),
    db: Session = Depends(get_db),
):
    request.state.agent_id = agent.id

    if body.agent_id != agent.id:
        raise AgentAuthError("mandate agent_id does not match the authenticated agent.")

    now = datetime.now(timezone.utc)
    expires_at = body.expires_at if body.expires_at.tzinfo else body.expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise MandateInvalidError("expires_at must be in the future.")
    if expires_at > now + timedelta(hours=24):
        raise MandateInvalidError("expires_at may not be more than 24 hours out.")

    # The signature must be verified against the EXACT expires_at the agent
    # signed - never a server-recomputed value, or clock drift/network
    # latency between signing and this request would make every signature
    # fail to verify even for a perfectly legitimate agent.
    payload = mandate_service.canonical_payload(agent.id, body.max_amount, body.currency, expires_at)

    if not mandate_service.verify_signature(agent.public_key, payload, body.signature):
        audit.log_event(db, audit.MANDATE_REJECTED, "Mandate signature failed verification", agent_id=agent.id)
        raise MandateInvalidError("Mandate signature does not verify against the agent's registered public key.")

    mandate = CartMandate(
        agent_id=agent.id,
        max_amount=body.max_amount,
        currency=body.currency,
        expires_at=timeutils.normalize(expires_at),
        signature=body.signature,
        signed_payload=payload.decode("utf-8"),
        status=MandateStatus.ACTIVE,
    )
    db.add(mandate)
    db.commit()
    db.refresh(mandate)

    audit.log_event(
        db,
        audit.MANDATE_CREATED,
        f"Mandate created for up to {body.max_amount} {body.currency}",
        agent_id=agent.id,
        payload={"mandate_id": mandate.id, "max_amount": body.max_amount},
    )

    return MandateCreateResponse(
        mandate_id=mandate.id,
        agent_id=mandate.agent_id,
        max_amount=float(mandate.max_amount),
        currency=mandate.currency,
        expires_at=mandate.expires_at,
        status=mandate.status.value,
    )
