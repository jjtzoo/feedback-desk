"""Email for notifications (D11, D18). The worker sends each notification row's email.

smtp  = Mailpit locally and in tests (nothing reaches real inboxes), or ZeptoMail's SMTP
        service in staging and production (company standard, D32)
gmail = Gmail API with a service account (the brief's choice, D11)
off   = no email (notification rows are marked skipped)
"""

import base64
import smtplib
from email.message import EmailMessage

from app.config import Settings
from app.models import Notification

FOOTER = (
    "\n\n--\nSmoke Signal, REDADAIR Digital team.\n"
    "Reply in the app rather than to this email; open the link above. "
    "You can mute an item from its page."
)


def render(n: Notification, base_url: str) -> tuple[str, str]:
    body = f"{n.body}\n\n" if n.body else ""
    return n.title, f"{body}Open it: {base_url}{n.link}{FOOTER}"


def build(settings: Settings, to: str, subject: str, body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    return msg


def send(settings: Settings, to: str, subject: str, body: str) -> None:
    """Blocking send, called by the worker in a thread."""
    msg = build(settings, to, subject, body)
    if settings.email_backend == "gmail":
        _send_gmail(settings, msg)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def _send_gmail(settings: Settings, msg: EmailMessage) -> None:
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/gmail.send"])
    if settings.gmail_sender and hasattr(credentials, "with_subject"):
        credentials = credentials.with_subject(settings.gmail_sender)  # domain-wide delegation
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    response = AuthorizedSession(credentials).post(  # type: ignore[no-untyped-call]
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", json={"raw": raw}, timeout=30
    )
    response.raise_for_status()


def redact(email: str | None) -> str:
    """For logs: keep the first letter and the domain."""
    if not email or "@" not in email:
        return "<none>"
    local, domain = email.split("@", 1)
    return f"{local[:1]}***@{domain}"
