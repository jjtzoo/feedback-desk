"""Embeddings for duplicate detection (brief §5.4), stored with pgvector.

Gemini embeddings when a model is configured; otherwise a deterministic hashing embedding so
duplicate search works locally and in tests (D23). The threshold differs per backend.
"""

import asyncio
import hashlib
import itertools
import logging
import math
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import ColumnElement, and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Feedback, FeedbackEmbedding
from app.models.entities import EMBEDDING_DIM
from app.models.enums import OPEN_STATUSES
from app.services import usage

log = logging.getLogger(__name__)

STUB_MODEL = "stub-hashing-v1"
STUB_THRESHOLD = 0.5
_STOP = frozenset(
    {
        "about",
        "after",
        "again",
        "all",
        "also",
        "and",
        "any",
        "are",
        "been",
        "before",
        "being",
        "both",
        "but",
        "can",
        "can't",
        "cant",
        "could",
        "each",
        "for",
        "from",
        "had",
        "has",
        "have",
        "into",
        "it's",
        "its",
        "just",
        "more",
        "most",
        "not",
        "only",
        "other",
        "our",
        "please",
        "really",
        "should",
        "some",
        "such",
        "than",
        "that",
        "the",
        "their",
        "them",
        "then",
        "there",
        "they",
        "this",
        "very",
        "was",
        "were",
        "what",
        "when",
        "which",
        "with",
        "would",
        "you",
        "your",
    }
)


def _model_name() -> str:
    from app.agent_runtime import model_choice

    choice = model_choice()
    real = choice.provider in ("gemini", "vertex") and choice.configured
    return get_settings().embedding_model if real else STUB_MODEL


def threshold() -> float:
    return STUB_THRESHOLD if _model_name() == STUB_MODEL else get_settings().duplicate_threshold


def _stub_embed(text: str) -> list[float]:
    words = [w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2 and w not in _STOP]
    features = words + [f"{a}_{b}" for a, b in itertools.pairwise(words)]
    vec = [0.0] * EMBEDDING_DIM
    for f in features:
        h = int(hashlib.md5(f.encode(), usedforsecurity=False).hexdigest(), 16)
        vec[h % EMBEDDING_DIM] += 1.0 if (h >> 12) % 2 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed(text: str) -> tuple[list[float], str]:
    model = _model_name()
    if model == STUB_MODEL:
        return _stub_embed(text), model

    def call() -> list[float]:
        from google import genai
        from google.genai import types

        client = genai.Client()
        result = client.models.embed_content(
            model=model,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=EMBEDDING_DIM, task_type="SEMANTIC_SIMILARITY"),
        )
        values = list(result.embeddings[0].values or []) if result.embeddings else []
        norm = math.sqrt(sum(v * v for v in values)) or 1.0
        return [v / norm for v in values]

    vector = await asyncio.to_thread(call)
    # The Gemini API reports no token count for embeddings; record an estimate (D36).
    await usage.record(kind="embedding", model=model, input_tokens=usage.estimate_tokens(text), estimated=True)
    return vector, model


async def store(db: AsyncSession, feedback_id: uuid.UUID, text: str) -> None:
    """Save the item's embedding. A failure only costs duplicate search; the item is kept."""
    try:
        vector, model = await embed(text)
    except Exception:
        log.exception("embedding failed for %s; duplicate search will skip it", feedback_id)
        return
    existing = await db.get(FeedbackEmbedding, feedback_id)
    if existing is None:
        db.add(FeedbackEmbedding(feedback_id=feedback_id, embedding=vector, model=model))
    else:
        existing.embedding, existing.model = vector, model


async def backfill(db: AsyncSession, limit: int = 20) -> int:
    """Embed open items with no embedding (the call failed when they were saved) or one from another
    model (the model changed), so duplicate search finds them again. Returns how many."""
    from app.agent_runtime import model_choice

    choice = model_choice()
    if choice.provider in ("gemini", "vertex") and not choice.configured:
        # The real model is chosen but unreachable here; the stub would overwrite its embeddings.
        log.warning("embedding backfill skipped: %s", choice.detail)
        return 0
    current = _model_name()
    stale = (
        select(Feedback)
        .outerjoin(FeedbackEmbedding, FeedbackEmbedding.feedback_id == Feedback.id)
        .where(
            Feedback.status.in_(OPEN_STATUSES),
            Feedback.duplicate_of.is_(None),
            or_(FeedbackEmbedding.feedback_id.is_(None), FeedbackEmbedding.model != current),
        )
        .order_by(Feedback.created_at)
        .limit(limit)
    )
    done = 0
    for fb in list(await db.scalars(stale)):
        try:
            vector, model = await embed(f"{fb.title}. {fb.summary}")
        except Exception:
            log.exception("embedding backfill stopped at %s", fb.ref_no)
            break
        # An upsert: an overlapping worker run may embed the same item.
        await db.execute(
            insert(FeedbackEmbedding)
            .values(feedback_id=fb.id, embedding=vector, model=model)
            .on_conflict_do_update(index_elements=["feedback_id"], set_={"embedding": vector, "model": model})
        )
        done += 1
    return done


@dataclass
class Similar:
    feedback_id: uuid.UUID
    ref_no: str
    title: str
    created_at_iso: str
    status: str
    similarity: float
    # When it was fixed (resolved, or closed as fixed), for a match that may have come back (review item 37).
    fixed_at_iso: str | None = None


async def find_similar(
    db: AsyncSession,
    project_id: uuid.UUID,
    text: str,
    *,
    exclude_id: uuid.UUID | None = None,
    limit: int = 3,
    fixed_days: int = 0,
) -> list[Similar]:
    """Open items in the same project above the threshold, most similar first; with `fixed_days`, also
    items closed as fixed within that many days, so a bug that comes back is linked to its fix."""
    vector, model = await embed(text)
    distance = FeedbackEmbedding.embedding.cosine_distance(vector)
    searched: ColumnElement[bool] = Feedback.status.in_(OPEN_STATUSES)
    if fixed_days > 0:
        since = datetime.now(UTC) - timedelta(days=fixed_days)
        searched = or_(searched, and_(Feedback.ending == "fixed", Feedback.resolved_at >= since))
    query = (
        select(Feedback, distance.label("distance"))
        .join(FeedbackEmbedding, FeedbackEmbedding.feedback_id == Feedback.id)
        .where(
            Feedback.project_id == project_id,
            searched,
            Feedback.duplicate_of.is_(None),
            Feedback.flagged.is_(False),  # for the Admins only: never offered as a match
            FeedbackEmbedding.model == model,
        )
        .order_by(distance)
        .limit(limit)
    )
    if exclude_id is not None:
        query = query.where(Feedback.id != exclude_id)
    cutoff = threshold()
    out: list[Similar] = []
    for fb, dist in await db.execute(query):
        similarity = 1.0 - float(dist)
        if similarity >= cutoff:
            fixed = fb.resolved_at if fb.status == "resolved" or fb.ending == "fixed" else None
            out.append(
                Similar(
                    fb.id,
                    fb.ref_no,
                    fb.title,
                    fb.created_at.isoformat(),
                    fb.status,
                    round(similarity, 3),
                    fixed.isoformat() if fixed else None,
                )
            )
    return out
