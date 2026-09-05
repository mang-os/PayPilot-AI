from datetime import timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import seed, timeutils
from app.database import Base
from app.models.catalog import DiscountType, Inventory, Offer, Product


def test_catalog_seed_is_add_only_and_idempotent():
    """Re-running a seed preserves known SKUs, inventories, and offers."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    original = next(product for product in seed.PRODUCTS if product["sku"] == "EAR-001")

    try:
        existing_product = Product(
            sku=original["sku"],
            name="Existing checkout product",
            description="Existing checkout description",
            category=original["category"],
            price=9876.00,
            image_url="",
        )
        session.add(existing_product)
        session.flush()
        existing_product_id = existing_product.id
        session.add(Inventory(
            product_id=existing_product.id,
            quantity_available=4,
            reserved_quantity=2,
        ))
        session.add(Offer(
            code="WELCOME10",
            description="Existing checkout offer",
            discount_type=DiscountType.FLAT,
            discount_value=1,
            min_cart_amount=0,
            max_discount_amount=None,
            valid_from=timeutils.utcnow(),
            valid_until=timeutils.utcnow() + timedelta(days=1),
            is_active=False,
        ))
        session.commit()

        first_results = seed.seed_catalog(session)
        assert first_results == {
            "products_added": len(seed.PRODUCTS) - 1,
            "products_skipped": 1,
            "offers_added": len(seed.OFFERS) - 1,
            "offers_skipped": 1,
        }
        assert session.query(Product).count() == len(seed.PRODUCTS)
        assert session.query(Inventory).count() == len(seed.PRODUCTS)
        assert session.query(Offer).count() == len(seed.OFFERS)

        preserved_product = session.query(Product).filter_by(sku="EAR-001").one()
        preserved_inventory = session.query(Inventory).filter_by(product_id=existing_product_id).one()
        preserved_offer = session.query(Offer).filter_by(code="WELCOME10").one()
        assert preserved_product.id == existing_product_id
        assert preserved_product.name == "Existing checkout product"
        assert float(preserved_product.price) == 9876.00
        assert preserved_inventory.quantity_available == 4
        assert preserved_inventory.reserved_quantity == 2
        assert preserved_offer.description == "Existing checkout offer"
        assert preserved_offer.discount_type == DiscountType.FLAT

        second_results = seed.seed_catalog(session)
        assert second_results == {
            "products_added": 0,
            "products_skipped": len(seed.PRODUCTS),
            "offers_added": 0,
            "offers_skipped": len(seed.OFFERS),
        }
        assert session.query(Product).count() == len(seed.PRODUCTS)
        assert session.query(Inventory).count() == len(seed.PRODUCTS)
        assert session.query(Offer).count() == len(seed.OFFERS)
    finally:
        session.close()
        engine.dispose()
