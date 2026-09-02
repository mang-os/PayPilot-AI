import sys
from datetime import timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.main as main_module  # noqa: E402
from app import timeutils  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.agents import AgentCredential, AgentRegistry, AgentStatus  # noqa: E402
from app.models.catalog import DiscountType, Inventory, Offer, Product  # noqa: E402
from app.services import mandate_service  # noqa: E402
from app.services.agent_auth import hash_api_key  # noqa: E402

TEST_DB_URL = "sqlite:///:memory:"


@pytest.fixture(autouse=True)
def isolate_external_services(monkeypatch):
    """Keep API tests independent of configured external provider credentials."""
    monkeypatch.setattr(settings, "GROQ_API_KEY", "")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_ID", "")
    monkeypatch.setattr(settings, "RAZORPAY_KEY_SECRET", "")


@pytest.fixture()
def db_session(monkeypatch):
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    # The AgentRequest-logging middleware in main.py can't use Depends(get_db)
    # (middleware isn't part of FastAPI's DI graph), so it calls SessionLocal()
    # directly - which, without this, would silently hit the real dev.db
    # instead of this test's in-memory database.
    monkeypatch.setattr(main_module, "SessionLocal", TestingSessionLocal)

    session = TestingSessionLocal()
    yield session
    session.close()
    app.dependency_overrides.clear()


@pytest.fixture()
def client(db_session):
    return TestClient(app)


@pytest.fixture()
def agent_identity(db_session):
    private_key_hex, public_key_hex = mandate_service.generate_keypair()
    agent = AgentRegistry(
        agent_name="test-agent",
        status=AgentStatus.ACTIVE,
        public_key=public_key_hex,
        max_transaction_limit=10000.00,
        max_daily_limit=25000.00,
    )
    db_session.add(agent)
    db_session.flush()
    api_key = "sk_agent_test_key"
    db_session.add(AgentCredential(agent_id=agent.id, api_key_hash=hash_api_key(api_key)))
    db_session.commit()
    return {"agent_id": agent.id, "api_key": api_key, "private_key_hex": private_key_hex, "public_key_hex": public_key_hex}


@pytest.fixture()
def catalog(db_session):
    product = Product(sku="TEST-001", name="Test Widget", description="A widget for testing", category="test", price=1000.00)
    db_session.add(product)
    db_session.flush()
    db_session.add(Inventory(product_id=product.id, quantity_available=10, reserved_quantity=0))
    offer = Offer(
        code="TESTOFF10", description="10% test offer", discount_type=DiscountType.PERCENTAGE,
        discount_value=10, min_cart_amount=0, max_discount_amount=None,
        valid_from=timeutils.utcnow(), valid_until=timeutils.utcnow() + timedelta(days=1), is_active=True,
    )
    db_session.add(offer)
    db_session.commit()
    return {"product_id": product.id, "offer_code": offer.code}


def sign_mandate(identity: dict, max_amount: float = 5000.0):
    expires_at = timeutils.utcnow().replace(tzinfo=timezone.utc) + timedelta(minutes=30)
    payload = mandate_service.canonical_payload(identity["agent_id"], max_amount, "INR", expires_at)
    signature = mandate_service.sign_payload(identity["private_key_hex"], payload)
    return {
        "agent_id": identity["agent_id"],
        "max_amount": max_amount,
        "currency": "INR",
        "expires_at": expires_at.isoformat(),
        "signature": signature,
    }
