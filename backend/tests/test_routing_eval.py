"""The Sprint 2 gate set (evals/routing_set.yaml). On the stub model this checks the set and
the runner work end to end; the 85/85/80 gate itself is judged on Gemini (run
`uv run python -m evals.run_routing` once the key is in)."""

from evals.run_routing import GATE, load_items, report, run

KEYS = {"message", "answers", "project", "work_type", "assignee"}


def test_set_has_40_well_formed_items() -> None:
    items = load_items()
    assert len(items) == 40
    assert all(set(i) >= KEYS for i in items)
    assert {i["work_type"] for i in items} == {"fix", "improvement", "new_feature", "no_change"}


async def test_runner_scores_the_set_end_to_end() -> None:
    score = await run(load_items())
    print(report(score))
    assert score.total == 40 and score.incomplete_briefs == 0
    # The stub is a keyword baseline, not the gate; it should still get most projects right.
    assert score.rate("project") >= 0.6 and set(score.correct) == set(GATE)
