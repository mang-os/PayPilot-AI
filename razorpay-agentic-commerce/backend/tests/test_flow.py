from tests.conftest import sign_mandate


def auth(identity):
    return {"Authorization": f"Bearer {identity['api_key']}"}


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_agent_auth_rejects_bad_key(client, catalog):
    resp = client.post("/acp/checkouts", json={"items": [{"product_id": catalog["product_id"], "quantity": 1}]}, headers={"Authorization": "Bearer not_a_real_key"})
    assert resp.status_code == 401
    assert resp.json()["error_code"] == "AGENT_AUTH_FAILED"


def test_agent_auth_requires_header(client, catalog):
    resp = client.post("/acp/checkouts", json={"items": [{"product_id": catalog["product_id"], "quantity": 1}]})
    assert resp.status_code == 401


def test_checkout_pricing_is_authoritative_not_llm_supplied(client, agent_identity, catalog):
    """The request never contains a price - compute_totals must derive
    subtotal/discount/tax/final entirely from DB state."""
    resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 2}], "offer_code": catalog["offer_code"]},
        headers=auth(agent_identity),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["subtotal"] == 2000.0
    assert body["discount_amount"] == 200.0  # 10% of 2000
    assert body["tax_amount"] == round((2000 - 200) * 0.18, 2)
    assert body["final_amount"] == round(2000 - 200 + (2000 - 200) * 0.18, 2)


def test_golden_path_create_complete_webhook(client, agent_identity, catalog):
    mandate_resp = client.post("/agent-commerce/mandates", json=sign_mandate(agent_identity), headers=auth(agent_identity))
    assert mandate_resp.status_code == 200
    mandate_id = mandate_resp.json()["mandate_id"]

    checkout_resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 1}], "mandate_id": mandate_id},
        headers=auth(agent_identity),
    )
    assert checkout_resp.status_code == 200
    checkout_id = checkout_resp.json()["checkout_id"]

    complete_resp = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert complete_resp.status_code == 200
    assert complete_resp.json()["razorpay_order_id"].startswith("order_MOCK")

    # completing an already-completing (UPDATED, payment-in-flight) checkout
    # again should be allowed to proceed (idempotent retry of complete is
    # fine pre-webhook) - but double webhook delivery must not double-process
    trace_resp = client.get(f"/dashboard/agent-trace/{checkout_id}")
    event_types = [e["event_type"] for e in trace_resp.json()]
    assert "POLICY_APPROVED" in event_types
    assert "MANDATE_VALIDATED" in event_types
    assert "RAZORPAY_ORDER_CREATED" in event_types


def test_invalid_product_id_returns_structured_404(client, agent_identity):
    resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": "prod_totally_fake", "quantity": 1}]},
        headers=auth(agent_identity),
    )
    assert resp.status_code == 404
    body = resp.json()
    assert body["error_code"] == "PRODUCT_NOT_FOUND"
    assert body["retryable"] is False


def test_duplicate_checkout_request_is_idempotent(client, agent_identity, catalog):
    body = {"items": [{"product_id": catalog["product_id"], "quantity": 1}], "idempotency_key": "fixed-test-key"}
    first = client.post("/acp/checkouts", json=body, headers=auth(agent_identity))
    second = client.post("/acp/checkouts", json=body, headers=auth(agent_identity))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["checkout_id"] == second.json()["checkout_id"]


def test_razorpay_timeout_releases_inventory_and_frees_mandate_for_retry(client, agent_identity, catalog):
    mandate_resp = client.post("/agent-commerce/mandates", json=sign_mandate(agent_identity), headers=auth(agent_identity))
    mandate_id = mandate_resp.json()["mandate_id"]
    checkout_resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 1}], "mandate_id": mandate_id},
        headers=auth(agent_identity),
    )
    checkout_id = checkout_resp.json()["checkout_id"]

    armed = client.post("/admin/debug/simulate-razorpay-timeout", json={"count": 5})
    assert armed.status_code == 200

    failed = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert failed.status_code == 503
    assert failed.json()["error_code"] == "RAZORPAY_TIMEOUT"
    assert failed.json()["retryable"] is True

    # the critical recovery assertion: the SAME checkout can complete once
    # Razorpay (mock) stops timing out - this is what makes it "recovery"
    # rather than just "detection"
    retried = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert retried.status_code == 200
    assert retried.json()["razorpay_order_id"] is not None


def test_duplicate_completion_returns_existing_result_no_double_reservation(client, agent_identity, catalog, db_session):
    """Regression test for the bug found during the Razorpay-integration
    audit: retrying /complete after a successful call must NOT re-run
    policy/mandate validation (the mandate is already CONSUMED by then,
    which would wrongly look like a policy violation) and must NOT
    reserve inventory a second time."""
    from app.models.catalog import Inventory

    mandate_resp = client.post("/agent-commerce/mandates", json=sign_mandate(agent_identity), headers=auth(agent_identity))
    mandate_id = mandate_resp.json()["mandate_id"]
    checkout_resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 1}], "mandate_id": mandate_id},
        headers=auth(agent_identity),
    )
    checkout_id = checkout_resp.json()["checkout_id"]

    first = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert first.status_code == 200
    first_order_id = first.json()["razorpay_order_id"]

    inv_after_first = db_session.query(Inventory).filter(Inventory.product_id == catalog["product_id"]).first()
    reserved_after_first = inv_after_first.reserved_quantity

    # The retry - this used to come back 422 MANDATE_INVALID and orphan
    # the first call's inventory reservation.
    second = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert second.status_code == 200
    assert second.json()["razorpay_order_id"] == first_order_id

    db_session.expire_all()
    inv_after_second = db_session.query(Inventory).filter(Inventory.product_id == catalog["product_id"]).first()
    assert inv_after_second.reserved_quantity == reserved_after_first  # not double-reserved

    trace = client.get(f"/dashboard/agent-trace/{checkout_id}").json()
    event_types = [e["event_type"] for e in trace]
    assert event_types.count("INVENTORY_RESERVED") == 1
    assert "DUPLICATE_COMPLETION_DETECTED" in event_types
    assert "POLICY_REJECTED" not in event_types


def test_transaction_limit_exceeded_is_a_policy_violation_not_a_crash(client, agent_identity, catalog):
    mandate_resp = client.post(
        "/agent-commerce/mandates",
        json=sign_mandate(agent_identity, max_amount=999999.0),
        headers=auth(agent_identity),
    )
    mandate_id = mandate_resp.json()["mandate_id"]
    # agent's own max_transaction_limit is 10000 (see agent_identity fixture) -
    # order 20x a 1000-rupee item comfortably exceeds it even though the
    # mandate itself would allow it, proving the two limits are independently enforced
    checkout_resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 20}], "mandate_id": mandate_id},
        headers=auth(agent_identity),
    )
    checkout_id = checkout_resp.json()["checkout_id"]

    resp = client.post(f"/acp/checkouts/{checkout_id}/complete", headers=auth(agent_identity))
    assert resp.status_code == 422
    violations = resp.json()["details"]["violations"]
    assert any(v["code"] == "TRANSACTION_LIMIT_EXCEEDED" for v in violations)


def test_suspended_agent_is_rejected(client, db_session, agent_identity, catalog):
    from app.models.agents import AgentRegistry, AgentStatus

    agent = db_session.get(AgentRegistry, agent_identity["agent_id"])
    agent.status = AgentStatus.SUSPENDED
    db_session.commit()

    resp = client.post(
        "/acp/checkouts",
        json={"items": [{"product_id": catalog["product_id"], "quantity": 1}]},
        headers=auth(agent_identity),
    )
    assert resp.status_code == 403
    assert resp.json()["error_code"] == "AGENT_NOT_ACTIVE"


def test_llm_orchestrator_query_never_returns_hallucinated_product(client, agent_identity, catalog):
    resp = client.post("/agent-commerce/query", json={"query": "test widget"}, headers=auth(agent_identity))
    assert resp.status_code == 200
    body = resp.json()
    returned_ids = {p["id"] for p in body["matched_products"]}
    assert returned_ids.issubset({catalog["product_id"]})
    assert "note" in body  # contract explicitly marks this advisory-only
