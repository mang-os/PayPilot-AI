"""
Every deliberate failure in this system raises one of these instead of
letting an exception fall through uncaught. app/main.py registers a single
handler for AgentCommerceError that:
  1. writes an audit_events row (so nothing fails silently)
  2. returns a structured {error_code, message, retryable, details} body

`retryable` is the machine-readable signal that tells a buyer agent whether
retrying the same request is sane (e.g. a Razorpay timeout) versus futile
(e.g. an invalid product_id - retrying without changing the request will
just fail again).
"""


class AgentCommerceError(Exception):
    error_code = "INTERNAL_ERROR"
    status_code = 500
    retryable = False

    def __init__(self, message: str, details: dict | None = None):
        self.message = message
        self.details = details or {}
        super().__init__(message)


class AgentAuthError(AgentCommerceError):
    error_code = "AGENT_AUTH_FAILED"
    status_code = 401
    retryable = False


class AgentSuspendedError(AgentCommerceError):
    error_code = "AGENT_NOT_ACTIVE"
    status_code = 403
    retryable = False


class ProductNotFoundError(AgentCommerceError):
    error_code = "PRODUCT_NOT_FOUND"
    status_code = 404
    retryable = False


class InventoryUnavailableError(AgentCommerceError):
    error_code = "INVENTORY_UNAVAILABLE"
    status_code = 409
    retryable = True  # stock levels change; worth a retry with lower qty / later


class OfferInvalidError(AgentCommerceError):
    error_code = "OFFER_INVALID"
    status_code = 400
    retryable = False


class CartMinimumNotMetError(AgentCommerceError):
    error_code = "CART_MINIMUM_NOT_MET"
    status_code = 400
    retryable = False


class TransactionLimitExceededError(AgentCommerceError):
    error_code = "TRANSACTION_LIMIT_EXCEEDED"
    status_code = 403
    retryable = False


class DailyLimitExceededError(AgentCommerceError):
    error_code = "DAILY_LIMIT_EXCEEDED"
    status_code = 403
    retryable = False


class MandateInvalidError(AgentCommerceError):
    error_code = "MANDATE_INVALID"
    status_code = 400
    retryable = False


class MandateExpiredError(AgentCommerceError):
    error_code = "MANDATE_EXPIRED"
    status_code = 400
    retryable = False


class MandateAmountExceededError(AgentCommerceError):
    error_code = "MANDATE_AMOUNT_EXCEEDED"
    status_code = 400
    retryable = False


class CheckoutStateError(AgentCommerceError):
    error_code = "CHECKOUT_STATE_INVALID"
    status_code = 409
    retryable = False


class PolicyViolationError(AgentCommerceError):
    """Raised with `details={"violations": [...]}` listing every failed
    policy check at once, so an agent can fix everything in one retry
    instead of discovering violations one at a time."""
    error_code = "POLICY_VIOLATION"
    status_code = 422
    retryable = False


class RazorpayTimeoutError(AgentCommerceError):
    error_code = "RAZORPAY_TIMEOUT"
    status_code = 503
    retryable = True


class RazorpayError(AgentCommerceError):
    error_code = "RAZORPAY_ERROR"
    status_code = 502
    retryable = True


class WebhookSignatureInvalidError(AgentCommerceError):
    error_code = "WEBHOOK_SIGNATURE_INVALID"
    status_code = 400
    retryable = False
