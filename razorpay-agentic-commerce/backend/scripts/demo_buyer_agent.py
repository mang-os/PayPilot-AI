"""
Simulates an external AI Buyer Agent talking to the Agentic Commerce API
over plain HTTP - exactly what a real buyer agent would do. Because the
"buyer" here is an agent, not a human, this script IS the demo: run it
live and narrate the printed steps.

Usage:
    python -m scripts.demo_buyer_agent
    python -m scripts.demo_buyer_agent --scenario invalid_product
    python -m scripts.demo_buyer_agent --scenario duplicate_checkout
    python -m scripts.demo_buyer_agent --scenario razorpay_timeout

Requires the API running locally (see README) and app/seed.py already run.
"""
import argparse
import hashlib
import hmac
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mandate_service  # noqa: E402
from app.config import settings  # noqa: E402

KEY_FILE = Path(__file__).resolve().parent / "demo_agent_key.json"
BASE_URL = "http://localhost:8000"


def banner(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def load_agent_identity() -> dict:
    if not KEY_FILE.exists():
        sys.exit(f"Missing {KEY_FILE}. Run `python -m app.seed` first.")
    return json.loads(KEY_FILE.read_text())


def auth_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"}


def sign_webhook_body(body: bytes) -> str:
    return hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()


def run_golden_path(client: httpx.Client, identity: dict) -> None:
    headers = auth_headers(identity["api_key"])

    banner("STEP 1: Discover products via the Merchant Agent (LLM orchestrator)")
    resp = client.post(f"{BASE_URL}/agent-commerce/query", json={"query": "wireless earbuds under 3000"}, headers=headers)
    resp.raise_for_status()
    query_result = resp.json()
    print(json.dumps(query_result, indent=2))
    if not query_result["matched_products"]:
        sys.exit("No products matched - is the DB seeded? Run `python -m app.seed`.")
    chosen_product = query_result["matched_products"][0]
    offer_code = query_result["suggested_offer"]["code"] if query_result["suggested_offer"] else None
    print(f"\n-> Chosen product: {chosen_product['name']} (₹{chosen_product['price']})")
    print(f"-> Suggested offer: {offer_code}")

    banner("STEP 2: Create a signed Cart Mandate (AP2-inspired)")
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    max_amount = 6000.00
    payload = mandate_service.canonical_payload(identity["agent_id"], max_amount, "INR", expires_at)
    signature = mandate_service.sign_payload(identity["private_key_hex"], payload)
    resp = client.post(
        f"{BASE_URL}/agent-commerce/mandates",
        json={
            "agent_id": identity["agent_id"],
            "max_amount": max_amount,
            "currency": "INR",
            "expires_at": expires_at.isoformat(),
            "signature": signature,
        },
        headers=headers,
    )
    resp.raise_for_status()
    mandate = resp.json()
    print(json.dumps(mandate, indent=2))

    banner("STEP 3: Create checkout (POST /acp/checkouts)")
    resp = client.post(
        f"{BASE_URL}/acp/checkouts",
        json={
            "items": [{"product_id": chosen_product["id"], "quantity": 1}],
            "offer_code": offer_code,
            "mandate_id": mandate["mandate_id"],
        },
        headers=headers,
    )
    resp.raise_for_status()
    checkout = resp.json()
    print(json.dumps(checkout, indent=2))
    checkout_id = checkout["checkout_id"]

    banner("STEP 4: Update checkout - bump quantity to 2 (PATCH /acp/checkouts/{id})")
    resp = client.patch(
        f"{BASE_URL}/acp/checkouts/{checkout_id}",
        json={"items": [{"product_id": chosen_product["id"], "quantity": 2}]},
        headers=headers,
    )
    resp.raise_for_status()
    checkout = resp.json()
    print(json.dumps(checkout, indent=2))
    print(f"\n-> Recomputed final_amount for qty=2: {checkout['final_amount']} {checkout['currency']}")

    banner("STEP 5: Complete checkout - policy engine + Razorpay order (POST .../complete)")
    resp = client.post(f"{BASE_URL}/acp/checkouts/{checkout_id}/complete", headers=headers)
    resp.raise_for_status()
    completed = resp.json()
    print(json.dumps(completed, indent=2))
    razorpay_order_id = completed["razorpay_order_id"]

    banner("STEP 6: Simulate the Razorpay webhook (payment.captured)")
    print("(In a live demo with real test-mode keys, this event would come from")
    print(" Razorpay itself after completing payment via Razorpay Checkout with a")
    print(" test card. This script signs and sends the same shape locally so the")
    print(" full pipeline - including signature verification - is exercised.)\n")
    webhook_payload = {
        "event": "payment.captured",
        "payload": {
            "payment": {
                "entity": {
                    "id": f"pay_DEMO{checkout_id[-8:]}",
                    "order_id": razorpay_order_id,
                    "amount": int(round(completed["final_amount"] * 100)),
                    "currency": completed["currency"],
                    "signature": "demo_signature_not_cryptographically_meaningful",
                }
            }
        },
    }
    body = json.dumps(webhook_payload).encode()
    sig = sign_webhook_body(body)
    resp = client.post(
        f"{BASE_URL}/webhooks/razorpay",
        content=body,
        headers={"Content-Type": "application/json", "X-Razorpay-Signature": sig},
    )
    resp.raise_for_status()
    print(json.dumps(resp.json(), indent=2))

    banner(f"STEP 7: Full audit trail for checkout {checkout_id}")
    resp = client.get(f"{BASE_URL}/dashboard/agent-trace/{checkout_id}")
    resp.raise_for_status()
    for event in resp.json():
        print(f"  [{event['created_at']}] {event['event_type']:<28} {event['message']}")

    banner("DONE - golden path complete")


def run_invalid_product_scenario(client: httpx.Client, identity: dict) -> None:
    headers = auth_headers(identity["api_key"])
    banner("FAILURE SCENARIO: Invalid Product ID")
    resp = client.post(
        f"{BASE_URL}/acp/checkouts",
        json={"items": [{"product_id": "prod_does_not_exist", "quantity": 1}]},
        headers=headers,
    )
    print(f"HTTP {resp.status_code}")
    print(json.dumps(resp.json(), indent=2))
    print("\n-> Detected: PRODUCT_NOT_FOUND, retryable=False (agent should fix the product_id, not blindly retry).")


def run_duplicate_checkout_scenario(client: httpx.Client, identity: dict) -> None:
    headers = auth_headers(identity["api_key"])
    banner("FAILURE SCENARIO: Duplicate Checkout Request")
    resp = client.post(f"{BASE_URL}/agent-commerce/query", json={"query": "speaker"}, headers=headers)
    product = resp.json()["matched_products"][0]

    body = {"items": [{"product_id": product["id"], "quantity": 1}], "idempotency_key": "demo-fixed-key-001"}
    print("Sending the SAME request twice with idempotency_key='demo-fixed-key-001'...\n")
    first = client.post(f"{BASE_URL}/acp/checkouts", json=body, headers=headers).json()
    second = client.post(f"{BASE_URL}/acp/checkouts", json=body, headers=headers).json()
    print("First response checkout_id: ", first["checkout_id"])
    print("Second response checkout_id:", second["checkout_id"])
    print(f"\n-> Same checkout_id returned both times: {first['checkout_id'] == second['checkout_id']}")
    print("   No duplicate order was created - see /dashboard/failures for the DUPLICATE_CHECKOUT_DETECTED audit event.")


def run_razorpay_timeout_scenario(client: httpx.Client, identity: dict) -> None:
    headers = auth_headers(identity["api_key"])
    banner("FAILURE SCENARIO: Razorpay Timeout")

    resp = client.post(f"{BASE_URL}/agent-commerce/query", json={"query": "charger"}, headers=headers)
    product = resp.json()["matched_products"][0]
    print(f"-> Product: {product['name']} (₹{product['price']})")

    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
    payload = mandate_service.canonical_payload(identity["agent_id"], 5000.00, "INR", expires_at)
    signature = mandate_service.sign_payload(identity["private_key_hex"], payload)
    mandate = client.post(
        f"{BASE_URL}/agent-commerce/mandates",
        json={"agent_id": identity["agent_id"], "max_amount": 5000.00, "currency": "INR", "expires_at": expires_at.isoformat(), "signature": signature},
        headers=headers,
    ).json()

    checkout = client.post(
        f"{BASE_URL}/acp/checkouts",
        json={"items": [{"product_id": product["id"], "quantity": 1}], "mandate_id": mandate["mandate_id"]},
        headers=headers,
    ).json()
    checkout_id = checkout["checkout_id"]
    print(f"-> Checkout created: {checkout_id}, final_amount={checkout['final_amount']}")

    print("\nArming 5 consecutive simulated Razorpay timeouts on the server")
    print("(5 > the 3-attempt retry budget, so this WILL exhaust retries and escalate)...")
    armed = client.post(f"{BASE_URL}/admin/debug/simulate-razorpay-timeout", json={"count": 5})
    print(json.dumps(armed.json(), indent=2))

    print("\nCompleting checkout - expect retries, then a 503 RAZORPAY_TIMEOUT error:\n")
    resp = client.post(f"{BASE_URL}/acp/checkouts/{checkout_id}/complete", headers=headers)
    print(f"HTTP {resp.status_code}")
    print(json.dumps(resp.json(), indent=2))

    banner(f"Recovery check: audit trail for {checkout_id}")
    trace = client.get(f"{BASE_URL}/dashboard/agent-trace/{checkout_id}").json()
    for event in trace:
        print(f"  [{event['created_at']}] {event['event_type']:<28} {event['message']}")
    print("\n-> Expect to see INVENTORY_RESERVED followed by RAZORPAY_TIMEOUT and ESCALATED:")
    print("   inventory was released and the mandate freed, so the agent can safely retry")
    print("   this same checkout by calling complete again once Razorpay recovers.")

    print("\nRetrying the same checkout now that no more timeouts are armed:")
    resp = client.post(f"{BASE_URL}/acp/checkouts/{checkout_id}/complete", headers=headers)
    print(f"HTTP {resp.status_code}")
    print(json.dumps(resp.json(), indent=2))


def main():
    global BASE_URL
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=["golden_path", "invalid_product", "duplicate_checkout", "razorpay_timeout"], default="golden_path")
    parser.add_argument("--base-url", default=BASE_URL)
    args = parser.parse_args()

    BASE_URL = args.base_url

    identity = load_agent_identity()
    with httpx.Client(timeout=15.0) as client:
        if args.scenario == "golden_path":
            run_golden_path(client, identity)
        elif args.scenario == "invalid_product":
            run_invalid_product_scenario(client, identity)
        elif args.scenario == "duplicate_checkout":
            run_duplicate_checkout_scenario(client, identity)
        elif args.scenario == "razorpay_timeout":
            run_razorpay_timeout_scenario(client, identity)


if __name__ == "__main__":
    main()
