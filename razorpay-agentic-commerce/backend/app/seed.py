"""
Populates a fresh DB with demo data: a small electronics catalog, two
offers, and one pre-registered demo agent. The demo agent's private key
is written to scripts/demo_agent_key.txt (git-ignored) purely so
scripts/demo_buyer_agent.py can sign mandates as that agent - in a real
system the private key would never leave the agent's own process.

Run with: python -m app.seed
"""
import json
from datetime import timedelta
from pathlib import Path

from app import timeutils
from app.database import Base, SessionLocal, engine
from app.models.agents import AgentCredential, AgentRegistry, AgentStatus
from app.models.catalog import DiscountType, Inventory, Offer, Product
from app.services import mandate_service
from app.services.agent_auth import hash_api_key

DEMO_API_KEY = "sk_agent_demo_key_do_not_use_in_prod"
KEY_FILE = Path(__file__).resolve().parent.parent / "scripts" / "demo_agent_key.json"

PRODUCTS = [
    dict(sku="EAR-001", name="AeroBuds Pro Wireless Earbuds", description="Active noise cancelling, 30h battery", category="audio", price=2499.00, image_url="", qty=50),
    dict(sku="EAR-002", name="SoundWave Lite Earbuds", description="Budget wireless earbuds with punchy bass", category="audio", price=1299.00, image_url="", qty=120),
    dict(sku="HDPH-001", name="Cadence Over-Ear Headphones", description="Studio-grade over-ear, ANC, 40h battery", category="audio", price=5999.00, image_url="", qty=25),
    dict(sku="WATCH-001", name="Pulse Fit Smartwatch", description="Heart rate, SpO2, 7-day battery", category="wearables", price=3499.00, image_url="", qty=40),
    dict(sku="SPKR-001", name="Boom Mini Bluetooth Speaker", description="IPX7 waterproof, 12h playback", category="audio", price=1799.00, image_url="", qty=60),
    dict(sku="CHRG-001", name="RapidVolt 65W GaN Charger", description="3-port fast charger for laptop + phone + buds", category="accessories", price=1499.00, image_url="", qty=80),
    dict(sku="CBL-001", name="FlexLink USB-C Cable 2m", description="Braided, 100W PD rated", category="accessories", price=399.00, image_url="", qty=3),  # deliberately low stock for demo
]

OFFERS = [
    dict(code="WELCOME10", description="10% off for new agent integrations", discount_type=DiscountType.PERCENTAGE, discount_value=10, min_cart_amount=1000, max_discount_amount=500),
    dict(code="FLAT200", description="Flat Rs.200 off on carts above Rs.2500", discount_type=DiscountType.FLAT, discount_value=200, min_cart_amount=2500, max_discount_amount=None),
]


def run():
    Base.metadata.create_all(bind=engine)  # no-op if alembic already applied, safe either way
    db = SessionLocal()
    try:
        if db.query(Product).count() > 0:
            print("Seed data already present, skipping catalog/offer seed.")
        else:
            for p in PRODUCTS:
                product = Product(sku=p["sku"], name=p["name"], description=p["description"], category=p["category"], price=p["price"], image_url=p["image_url"])
                db.add(product)
                db.flush()
                db.add(Inventory(product_id=product.id, quantity_available=p["qty"], reserved_quantity=0))
            for o in OFFERS:
                db.add(Offer(
                    code=o["code"], description=o["description"], discount_type=o["discount_type"],
                    discount_value=o["discount_value"], min_cart_amount=o["min_cart_amount"],
                    max_discount_amount=o["max_discount_amount"], valid_from=timeutils.utcnow(),
                    valid_until=timeutils.utcnow() + timedelta(days=90), is_active=True,
                ))
            db.commit()
            print(f"Seeded {len(PRODUCTS)} products and {len(OFFERS)} offers.")

        existing_agent = db.query(AgentRegistry).filter(AgentRegistry.agent_name == "demo-buyer-agent").first()
        if existing_agent:
            print(f"Demo agent already exists: {existing_agent.id}")
            return

        private_key_hex, public_key_hex = mandate_service.generate_keypair()
        agent = AgentRegistry(
            agent_name="demo-buyer-agent",
            status=AgentStatus.ACTIVE,
            public_key=public_key_hex,
            max_transaction_limit=10000.00,
            max_daily_limit=25000.00,
        )
        db.add(agent)
        db.flush()
        db.add(AgentCredential(agent_id=agent.id, api_key_hash=hash_api_key(DEMO_API_KEY)))
        db.commit()

        KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        KEY_FILE.write_text(json.dumps({
            "agent_id": agent.id,
            "api_key": DEMO_API_KEY,
            "private_key_hex": private_key_hex,
            "public_key_hex": public_key_hex,
        }, indent=2))

        print(f"Demo agent created: {agent.id}")
        print(f"Demo agent key material written to {KEY_FILE}")
    finally:
        db.close()


if __name__ == "__main__":
    run()
