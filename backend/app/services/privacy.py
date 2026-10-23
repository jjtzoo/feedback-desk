"""Mask secrets before anything is stored, and spot abuse about a named colleague (brief §5.5)."""

import re

# The separator is atomic and an existing marker is skipped, so masking twice changes nothing.
_PASSWORD = re.compile(
    r"(?<!\[)\b(password|passwd|pwd|passcode|pin)\b((?>\s*(?:is|was|:|=)\s*|\s+))(?!\[password removed\])(\S+)",
    re.IGNORECASE,
)
_DIGIT_RUN = re.compile(r"(?<![\w-])\d(?:[ -]?\d){8,18}(?![\w-])")
_ABUSE_WORDS = (
    "idiot",
    "stupid",
    "useless",
    "incompetent",
    "moron",
    "lazy",
    "hate",
    "pathetic",
    "dumb",
)


def _luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def _tfn_ok(digits: str) -> bool:
    weights = (1, 4, 3, 7, 5, 8, 6, 9, 10)
    return len(digits) == 9 and sum(int(d) * w for d, w in zip(digits, weights, strict=True)) % 11 == 0


def mask(text: str) -> str:
    """Replace passwords, card numbers and TFNs with a marker. Ordinary numbers are kept, and
    already-masked text comes back unchanged."""

    def password(m: re.Match[str]) -> str:
        return f"{m.group(1)}{m.group(2)}[password removed]"

    def number(m: re.Match[str]) -> str:
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            return "[card number removed]"
        if len(digits) == 9 and _tfn_ok(digits):
            return "[TFN removed]"
        return m.group(0)

    return _DIGIT_RUN.sub(number, _PASSWORD.sub(password, text))


def is_abusive_about(text: str, names: list[str]) -> bool:
    """True when the text insults a named colleague; such items go to the Admins only."""
    low = text.lower()
    if not any(re.search(rf"\b{re.escape(w)}\b", low) for w in _ABUSE_WORDS):
        return False
    return any(re.search(rf"\b{re.escape(n.lower())}\b", low) for n in names if n)
