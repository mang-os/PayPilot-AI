from datetime import datetime, timezone


def utcnow() -> datetime:
    """The only 'current time' function used anywhere in this codebase.
    Naive, but always UTC by construction."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize(dt: datetime) -> datetime:
    """Strips tzinfo from an incoming (possibly aware) datetime, converting
    to UTC first if it carries some other offset. Used when a timezone-aware
    timestamp arrives over the API boundary (JSON always round-trips
    offsets correctly) and needs to be stored alongside naive-UTC columns."""
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt
