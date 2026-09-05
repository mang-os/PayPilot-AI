from datetime import timedelta

from app import seed, timeutils
from app.models.agents import CartMandate, MandateStatus
from app.models.catalog import DiscountType, Inventory, Offer, Product
from app.models.checkout import CheckoutSession, CheckoutStatus


def _add_storefront_data(db_session):
    product_data = next(product for product in seed.PRODUCTS if product["sku"] == "EAR-001")
    product = Product(
        sku=product_data["sku"],
        name=product_data["name"],
        description=product_data["description"],
        category=product_data["category"],
        price=product_data["price"],
        image_url=product_data["image_url"],
    )
    inactive_product = Product(
        sku="INACTIVE-001",
        name="Inactive Product",
        description="Must not appear in storefront data",
        category="test",
        price=1.00,
        image_url="",
        is_active=False,
    )
    db_session.add_all([product, inactive_product])
    db_session.flush()
    db_session.add_all([
        Inventory(product_id=product.id, quantity_available=8, reserved_quantity=2),
        Inventory(product_id=inactive_product.id, quantity_available=99, reserved_quantity=0),
    ])
    now = timeutils.utcnow()
    offer = Offer(
        code="WELCOME10",
        description="10% off for new agent integrations",
        discount_type=DiscountType.PERCENTAGE,
        discount_value=10,
        min_cart_amount=1000,
        max_discount_amount=500,
        valid_from=now - timedelta(minutes=1),
        valid_until=now + timedelta(days=1),
        is_active=True,
    )
    expired_offer = Offer(
        code="EXPIRED",
        description="Must not appear in storefront data",
        discount_type=DiscountType.FLAT,
        discount_value=1,
        min_cart_amount=0,
        max_discount_amount=None,
        valid_from=now - timedelta(days=2),
        valid_until=now - timedelta(days=1),
        is_active=True,
    )
    db_session.add_all([offer, expired_offer])
    db_session.commit()
    return product


def test_catalog_returns_active_storefront_data_without_commerce_mutation(client, db_session):
    product = _add_storefront_data(db_session)

    response = client.get("/dashboard/catalog")

    assert response.status_code == 200
    body = response.json()
    assert body["products"] == [
        {
            "id": product.id,
            "sku": "EAR-001",
            "name": "AeroBuds Pro Wireless Earbuds",
            "description": "Active noise cancelling, 30h battery",
            "category": "audio",
            "price": 2499.0,
            "image_url": "",
            "inventory": {"quantity_available": 8, "reserved_quantity": 2},
        }
    ]
    assert len(body["offers"]) == 1
    assert body["offers"][0] == {
        "code": "WELCOME10",
        "description": "10% off for new agent integrations",
        "discount_type": "PERCENTAGE",
        "discount_value": 10.0,
        "min_cart_amount": 1000.0,
        "max_discount_amount": 500.0,
        "valid_from": body["offers"][0]["valid_from"],
        "valid_until": body["offers"][0]["valid_until"],
        "is_active": True,
    }
    inventory = db_session.query(Inventory).filter_by(product_id=product.id).one()
    assert inventory.quantity_available == 8
    assert inventory.reserved_quantity == 2
    assert db_session.query(Product).count() == 2
    assert db_session.query(Offer).count() == 2


def test_checkout_detail_returns_safe_persisted_data_without_commerce_mutation(client, db_session, agent_identity):
    mandate = CartMandate(
        agent_id=agent_identity["agent_id"],
        max_amount=5000.00,
        currency="INR",
        expires_at=timeutils.utcnow() + timedelta(minutes=30),
        signature="must-not-be-returned",
        signed_payload="must-not-be-returned",
        status=MandateStatus.ACTIVE,
    )
    db_session.add(mandate)
    db_session.flush()
    checkout = CheckoutSession(
        agent_id=agent_identity["agent_id"],
        status=CheckoutStatus.UPDATED,
        items=[{"product_id": "prod_dashboard", "name": "Dashboard Widget", "quantity": 2, "unit_price": 1000.00}],
        offer_code="WELCOME10",
        mandate_id=mandate.id,
        subtotal=2000.00,
        discount_amount=200.00,
        tax_amount=324.00,
        final_amount=2124.00,
        currency="INR",
        razorpay_order_id="order_dashboard_read_only",
    )
    db_session.add(checkout)
    db_session.commit()

    response = client.get(f"/dashboard/checkouts/{checkout.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["checkout_id"] == checkout.id
    assert body["agent_id"] == agent_identity["agent_id"]
    assert body["status"] == "UPDATED"
    assert body["items"] == [
        {"product_id": "prod_dashboard", "name": "Dashboard Widget", "quantity": 2, "unit_price": 1000.0}
    ]
    assert body["offer_code"] == "WELCOME10"
    assert body["subtotal"] == 2000.0
    assert body["discount_amount"] == 200.0
    assert body["tax_amount"] == 324.0
    assert body["final_amount"] == 2124.0
    assert body["currency"] == "INR"
    assert body["razorpay_order_id"] == "order_dashboard_read_only"
    assert body["failure_reason"] is None
    assert body["mandate"] == {
        "mandate_id": mandate.id,
        "max_amount": 5000.0,
        "currency": "INR",
        "expires_at": body["mandate"]["expires_at"],
        "status": "ACTIVE",
    }
    assert set(body["mandate"]) == {"mandate_id", "max_amount", "currency", "expires_at", "status"}
    assert "signature" not in response.text
    assert "signed_payload" not in response.text

    db_session.expire_all()
    persisted_checkout = db_session.get(CheckoutSession, checkout.id)
    persisted_mandate = db_session.get(CartMandate, mandate.id)
    assert persisted_checkout.items == checkout.items
    assert float(persisted_checkout.final_amount) == 2124.0
    assert persisted_mandate.signature == "must-not-be-returned"
    assert persisted_mandate.signed_payload == "must-not-be-returned"


def test_checkout_detail_returns_404_for_unknown_checkout(client):
    response = client.get("/dashboard/checkouts/chk_unknown")

    assert response.status_code == 404
    assert response.json() == {"detail": "Checkout not found."}
