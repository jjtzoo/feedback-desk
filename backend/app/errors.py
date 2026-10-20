"""Errors raised by services and turned into {"error": {"code", "message"}} by the API."""


class ServiceError(Exception):
    status_code = 400

    def __init__(self, code: str, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        if status_code is not None:
            self.status_code = status_code


class NotFound(ServiceError):
    status_code = 404

    def __init__(self, message: str = "Not found.") -> None:
        super().__init__("not_found", message)


class Conflict(ServiceError):
    status_code = 409


class Forbidden(ServiceError):
    status_code = 403

    def __init__(self, message: str = "You can't do that.") -> None:
        super().__init__("forbidden", message)
