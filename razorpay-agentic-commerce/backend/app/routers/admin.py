"""
Minimal agent-onboarding endpoint. Not part of the spec's named
deliverables, but needed to make the "Agent Registry" concrete: this is
how a new trusted buyer agent actually gets a row in agent_registry plus
credentials, instead of only existing via the seed script.

In a real deployment the agent would generate its own Ed25519 keypair and
only ever send the merchant its PUBLIC key. Here, for demo convenience,
the server generates the pair and returns the private key in the response
body exactly once - clearly marked as a demo-only shortcut.
"""
import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.agents import AgentCredential, AgentRegistry, AgentStatus
from app.services import mandate_service, razorpay_service
from app.services.agent_auth import hash_api_key
from app.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])


class RegisterAgentRequest(BaseModel):
    agent_name: str
    max_transaction_limit: float | None = None
    max_daily_limit: float | None = None


class RegisterAgentResponse(BaseModel):
    agent_id: str
    api_key: str
    private_key_hex: str
    public_key_hex: str
    note: str = (
        "Store api_key and private_key_hex securely now - the API key is "
        "hashed at rest and the private key is never stored server-side, "
        "so neither can be recovered later."
    )


@router.post("/agents", response_model=RegisterAgentResponse)
def register_agent(body: RegisterAgentRequest, db: Session = Depends(get_db)):
    private_key_hex, public_key_hex = mandate_service.generate_keypair()
    api_key = f"sk_agent_{secrets.token_hex(16)}"

    agent = AgentRegistry(
        agent_name=body.agent_name,
        status=AgentStatus.ACTIVE,
        public_key=public_key_hex,
        max_transaction_limit=body.max_transaction_limit or settings.DEFAULT_AGENT_TXN_LIMIT,
        max_daily_limit=body.max_daily_limit or settings.DEFAULT_AGENT_DAILY_LIMIT,
    )
    db.add(agent)
    db.flush()

    credential = AgentCredential(agent_id=agent.id, api_key_hash=hash_api_key(api_key))
    db.add(credential)
    db.commit()

    return RegisterAgentResponse(
        agent_id=agent.id,
        api_key=api_key,
        private_key_hex=private_key_hex,
        public_key_hex=public_key_hex,
    )


class SimulateTimeoutRequest(BaseModel):
    count: int = 5  # more than the retry budget (3), guarantees escalation


@router.post("/debug/simulate-razorpay-timeout")
def simulate_razorpay_timeout(body: SimulateTimeoutRequest):
    """
    Demo/test-only lever: makes the next `count` calls to
    razorpay_service.create_order() raise a timeout, so the failure-recovery
    path (retry -> escalate -> release inventory -> free mandate) can be
    demonstrated on demand instead of waiting for a real network timeout.
    Not gated behind auth because this whole API is a hackathon MVP running
    against Razorpay TEST MODE - this must not exist in a production build.
    """
    for _ in range(body.count):
        razorpay_service.simulate_timeout_once()
    return {"status": "armed", "count": body.count}
