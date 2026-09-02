"""
Order creation talks to Razorpay's API (or, with no keys configured, runs
in MOCK mode - see app/config.py). Webhook signature verification is
NEVER mocked: it's a plain HMAC-SHA256 check per Razorpay's documented
scheme (hexdigest of the raw request body, keyed with the webhook secret),
so the "never trust frontend success, only trust the verified webhook"
rule is genuinely enforced even while the order-creation side is mocked
for local testing.
"""
import hashlib
import hmac
import logging
import secrets
import socket

import razorpay
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import settings
from app.errors import RazorpayError, RazorpayTimeoutError

logger = logging.getLogger("razorpay_service")

_client: razorpay.Client | None = None
_timeout_injections_remaining = 0  # test/demo hook, see simulate_timeout_once()


def _get_client() -> razorpay.Client:
    global _client
    if _client is None:
        _client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    return _client


def simulate_timeout_once() -> None:
    """Test/demo hook: makes the *next* create_order call raise
    RazorpayTimeoutError, so the failure-recovery path can be demonstrated
    on demand rather than waiting for a real network timeout."""
    global _timeout_injections_remaining
    _timeout_injections_remaining += 1


class _TransientRazorpayFailure(Exception):
    """Internal-only: marks a failure as worth retrying."""


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=0.5, min=0.5, max=4),
    retry=retry_if_exception_type(_TransientRazorpayFailure),
)
def _create_order_with_retry(amount_paise: int, currency: str, receipt: str, notes: dict) -> dict:
    global _timeout_injections_remaining
    if _timeout_injections_remaining > 0:
        _timeout_injections_remaining -= 1
        raise _TransientRazorpayFailure("simulated timeout")

    if settings.RAZORPAY_MOCK_MODE:
        return {
            "id": f"order_MOCK{secrets.token_hex(7)}",
            "amount": amount_paise,
            "currency": currency,
            "receipt": receipt,
            "status": "created",
            "notes": notes,
        }

    try:
        client = _get_client()
        return client.order.create(
            {
                "amount": amount_paise,
                "currency": currency,
                "receipt": receipt,
                "notes": notes,
                "payment_capture": 1,
            }
        )
    except (socket.timeout, TimeoutError) as exc:
        raise _TransientRazorpayFailure(str(exc)) from exc
    except Exception as exc:  # razorpay SDK raises its own error types
        # Treat anything that looks like a connectivity/timeout issue as
        # transient (retryable); anything else (bad request, auth) is not.
        if "timeout" in str(exc).lower() or "connection" in str(exc).lower():
            raise _TransientRazorpayFailure(str(exc)) from exc
        raise RazorpayError(f"Razorpay order creation failed: {exc}") from exc


def create_order(amount_paise: int, currency: str, receipt: str, notes: dict) -> dict:
    try:
        return _create_order_with_retry(amount_paise, currency, receipt, notes)
    except _TransientRazorpayFailure as exc:
        # Exhausted all retries - escalate as a proper timeout error for
        # the caller (checkout router) to log + mark FAILED.
        raise RazorpayTimeoutError(
            f"Razorpay order creation timed out after retries: {exc}",
            details={"receipt": receipt},
        ) from exc


def verify_webhook_signature(payload_body: bytes, signature: str) -> bool:
    if not signature:
        return False
    expected = hmac.new(
        settings.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        payload_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
