from pydantic import BaseModel


class ErrorResponse(BaseModel):
    error_code: str
    message: str
    retryable: bool
    details: dict | None = None
