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

# Keep the original seven definitions unchanged: verified demo flows reference
# their SKUs and catalog values.
PRODUCTS = [
    dict(sku="EAR-001", name="AeroBuds Pro Wireless Earbuds", description="Active noise cancelling, 30h battery", category="audio", price=2499.00, image_url="", qty=50),
    dict(sku="EAR-002", name="SoundWave Lite Earbuds", description="Budget wireless earbuds with punchy bass", category="audio", price=1299.00, image_url="", qty=120),
    dict(sku="HDPH-001", name="Cadence Over-Ear Headphones", description="Studio-grade over-ear, ANC, 40h battery", category="audio", price=5999.00, image_url="", qty=25),
    dict(sku="WATCH-001", name="Pulse Fit Smartwatch", description="Heart rate, SpO2, 7-day battery", category="wearables", price=3499.00, image_url="", qty=40),
    dict(sku="SPKR-001", name="Boom Mini Bluetooth Speaker", description="IPX7 waterproof, 12h playback", category="audio", price=1799.00, image_url="", qty=60),
    dict(sku="CHRG-001", name="RapidVolt 65W GaN Charger", description="3-port fast charger for laptop + phone + buds", category="accessories", price=1499.00, image_url="", qty=80),
    dict(sku="CBL-001", name="FlexLink USB-C Cable 2m", description="Braided, 100W PD rated", category="accessories", price=399.00, image_url="", qty=3),  # deliberately low stock for demo
    dict(sku="EAR-003", name="Nimbus ANC Wireless Earbuds", description="Adaptive noise control, 36h total playback", category="audio", price=4499.00, image_url="", qty=45),
    dict(sku="IEM-001", name="Resonance Wired IEMs", description="Dual-driver in-ear monitors with detachable cable", category="audio", price=1599.00, image_url="", qty=70),
    dict(sku="SBR-001", name="RoomTone Compact Soundbar", description="2.1-channel TV soundbar with HDMI ARC", category="audio", price=7999.00, image_url="", qty=18),
    dict(sku="MIC-001", name="VoxNest USB Microphone", description="Cardioid USB microphone for streaming and calls", category="audio", price=2999.00, image_url="", qty=35),
    dict(sku="KBM-001", name="Forge 75 Mechanical Keyboard", description="Hot-swappable compact keyboard with tactile switches", category="computing", price=4999.00, image_url="", qty=30),
    dict(sku="MSE-001", name="MovoArc Wireless Mouse", description="Silent wireless mouse with 18-month battery life", category="computing", price=1499.00, image_url="", qty=85),
    dict(sku="MSE-002", name="Elevate Ergo Mouse", description="Vertical ergonomic mouse with adjustable DPI", category="computing", price=2799.00, image_url="", qty=42),
    dict(sku="HUB-001", name="PortBridge 7-in-1 USB-C Hub", description="USB-C hub with HDMI, SD reader, and 100W pass-through", category="computing", price=2499.00, image_url="", qty=55),
    dict(sku="CAM-001", name="FramePro 1080p Webcam", description="Full HD webcam with privacy shutter and dual microphones", category="computing", price=2199.00, image_url="", qty=48),
    dict(sku="STND-001", name="LiftDesk Aluminum Laptop Stand", description="Foldable height-adjustable stand for laptops up to 16 inches", category="computing", price=1299.00, image_url="", qty=65),
    dict(sku="SSD-001", name="SwiftStore 1TB External SSD", description="Pocket SSD with USB-C 10Gbps transfer speeds", category="computing", price=8999.00, image_url="", qty=20),
    dict(sku="CHRG-003", name="VoltGrid 100W GaN Charger", description="Four-port GaN charger for laptops, tablets, and phones", category="accessories", price=3499.00, image_url="", qty=36),
    dict(sku="PB-001", name="ChargeNest 10000mAh Power Bank", description="Slim 22.5W power bank with USB-C fast charging", category="mobile", price=1999.00, image_url="", qty=58),
    dict(sku="WLC-001", name="MagniNest Wireless Charger", description="15W magnetic wireless charging pad with USB-C cable", category="mobile", price=1699.00, image_url="", qty=50),
    dict(sku="PHST-001", name="OrbitGrip Adjustable Phone Stand", description="Pocket-friendly aluminum stand for phones and small tablets", category="mobile", price=299.00, image_url="", qty=110),
    dict(sku="CTRL-001", name="ArcadeLink Wireless Controller", description="Low-latency controller with hall-effect triggers", category="gaming", price=3499.00, image_url="", qty=32),
    dict(sku="GHEAD-001", name="StrikeSound Gaming Headset", description="Wired gaming headset with flip-to-mute microphone", category="gaming", price=3199.00, image_url="", qty=38),
    dict(sku="GMSE-001", name="Vector Gaming Mouse", description="Lightweight 16000 DPI gaming mouse with programmable buttons", category="gaming", price=1799.00, image_url="", qty=60),
    dict(sku="BAND-001", name="Pulse Flex Fitness Band", description="Sleep tracking, activity modes, and 10-day battery", category="wearables", price=1999.00, image_url="", qty=75),
    dict(sku="WATCH-002", name="Vista Active Smartwatch", description="AMOLED display, GPS workouts, and 5-day battery", category="wearables", price=5499.00, image_url="", qty=28),
    dict(sku="PLUG-001", name="HomeFlow Smart Plug", description="Wi-Fi smart plug with energy monitoring and schedules", category="smart-home", price=799.00, image_url="", qty=90),
    dict(sku="BULB-001", name="LumaGlow Smart Bulb", description="Colour-tunable 9W Wi-Fi LED bulb with scenes", category="smart-home", price=699.00, image_url="", qty=100),
    dict(sku="HOMECAM-001", name="Sentinel Indoor Security Camera", description="1080p pan-tilt camera with night vision and two-way audio", category="smart-home", price=2999.00, image_url="", qty=34),
]

OFFERS = [
    dict(code="WELCOME10", description="10% off for new agent integrations", discount_type=DiscountType.PERCENTAGE, discount_value=10, min_cart_amount=1000, max_discount_amount=500),
    dict(code="FLAT200", description="Flat Rs.200 off on carts above Rs.2500", discount_type=DiscountType.FLAT, discount_value=200, min_cart_amount=2500, max_discount_amount=None),
]


def seed_catalog(db):
    """Add missing catalog rows without modifying existing checkout data."""
    products_added = 0
    products_skipped = 0
    offers_added = 0
    offers_skipped = 0

    for p in PRODUCTS:
        existing_product = db.query(Product).filter(Product.sku == p["sku"]).first()
        if existing_product:
            products_skipped += 1
            continue

        product = Product(
            sku=p["sku"], name=p["name"], description=p["description"],
            category=p["category"], price=p["price"], image_url=p["image_url"],
        )
        db.add(product)
        db.flush()
        db.add(Inventory(product_id=product.id, quantity_available=p["qty"], reserved_quantity=0))
        products_added += 1

    for o in OFFERS:
        existing_offer = db.query(Offer).filter(Offer.code == o["code"]).first()
        if existing_offer:
            offers_skipped += 1
            continue

        db.add(Offer(
            code=o["code"], description=o["description"], discount_type=o["discount_type"],
            discount_value=o["discount_value"], min_cart_amount=o["min_cart_amount"],
            max_discount_amount=o["max_discount_amount"], valid_from=timeutils.utcnow(),
            valid_until=timeutils.utcnow() + timedelta(days=90), is_active=True,
        ))
        offers_added += 1

    db.commit()
    return {
        "products_added": products_added,
        "products_skipped": products_skipped,
        "offers_added": offers_added,
        "offers_skipped": offers_skipped,
    }


def run():
    Base.metadata.create_all(bind=engine)  # no-op if alembic already applied, safe either way
    db = SessionLocal()
    try:
        results = seed_catalog(db)
        print(f"Added {results['products_added']} new products.")
        print(f"Skipped {results['products_skipped']} existing products.")
        print(f"Added {results['offers_added']} new offers.")
        print(f"Skipped {results['offers_skipped']} existing offers.")

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
