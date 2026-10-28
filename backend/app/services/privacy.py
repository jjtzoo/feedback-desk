"""Mask secrets before anything is stored, and spot abuse about a named colleague (brief §5.5)."""

import re
from collections.abc import Iterable

# The separator is atomic and an existing marker is skipped, so masking twice changes nothing.
_PASSWORD = re.compile(
    r"(?<!\[)\b(password|passwd|pwd|passcode|pin)\b((?>\s*(?:is|was|:|=)\s*|\s+))(?!\[password removed\])(\S+)",
    re.IGNORECASE,
)
_DIGIT_RUN = re.compile(r"(?<![\w-])\d(?:[ -]?\d){8,18}(?![\w-])")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
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


def hide_names(text: str, names: Iterable[str]) -> str:
    """For someone else's view of an item (D97): email addresses, and the names of the people on it, full
    or in part, read "someone". Names match as written (capitalised), so "Will" is hidden but "will" is
    not; a name nobody on the item has is not caught."""
    words = {w for n in names for w in (n.strip(), *re.split(r"[\s-]+", n)) if len(w) > 1}
    text = _EMAIL.sub("someone", text)
    if not words:
        return text
    # Longest first, so "Mei Lin" becomes one "someone", not two.
    alternatives = "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))
    return re.sub(rf"\b(?:{alternatives})\b", "someone", text)


def is_abusive_about(text: str, names: list[str]) -> bool:
    """True when the text insults a named colleague; such items go to the Admins only."""
    low = text.lower()
    if not any(re.search(rf"\b{re.escape(w)}\b", low) for w in _ABUSE_WORDS):
        return False
    return any(re.search(rf"\b{re.escape(n.lower())}\b", low) for n in names if n)
