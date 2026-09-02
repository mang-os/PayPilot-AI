"""
Real Ed25519 signatures, not the HMAC-style mock the spec says is
acceptable. The flow:

  1. At agent registration, generate_keypair() produces a private/public
     key pair. The public key (hex) is stored on agent_registry.public_key.
     The private key never touches the database - only the agent holds it
     (in this demo, the seed script writes it to a local file that only
     the demo script reads, standing in for "the agent's own secure
     storage").

  2. To request a mandate, the agent signs a canonical payload
     (agent_id + max_amount + currency + expiry) with its private key.
     `create_mandate` in the agent_commerce router verifies that signature
     against the agent's stored public key before writing the CartMandate
     row - so a mandate can only be created by whoever holds that agent's
     private key.

  3. At checkout completion, the Policy Engine calls verify_mandate_signature
     again against the *stored* mandate row. This is deliberate
     defense-in-depth: never trust a DB row alone for a spend authorization,
     even one you verified earlier - always re-verify the cryptographic
     proof at the point of spend.
"""
from datetime import datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature


def generate_keypair() -> tuple[str, str]:
    """Returns (private_key_hex, public_key_hex)."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    priv_bytes = private_key.private_bytes_raw()
    pub_bytes = public_key.public_bytes_raw()
    return priv_bytes.hex(), pub_bytes.hex()


def canonical_payload(agent_id: str, max_amount: float, currency: str, expires_at: datetime) -> bytes:
    """The exact byte string that gets signed. Both signer (agent) and
    verifier (merchant) must construct this identically, so the format is
    intentionally simple and explicit rather than relying on JSON key
    ordering."""
    return (
        f"agent_id={agent_id}|max_amount={max_amount:.2f}|"
        f"currency={currency}|expires_at={expires_at.isoformat()}"
    ).encode("utf-8")


def sign_payload(private_key_hex: str, payload: bytes) -> str:
    private_key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(private_key_hex))
    signature = private_key.sign(payload)
    return signature.hex()


def verify_signature(public_key_hex: str, payload: bytes, signature_hex: str) -> bool:
    try:
        public_key = Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_key_hex))
        public_key.verify(bytes.fromhex(signature_hex), payload)
        return True
    except (InvalidSignature, ValueError):
        return False
