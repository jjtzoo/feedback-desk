"""The per-turn rubric of evals/run_conversations.py (D68), on the chats of 26 Oct. The rubric is judged
on Gemini; here it must fail those chats and pass a good one."""

from evals.run_conversations import Turn, judge_turns, question_kinds

IMPACT = ["Blocking my work", "Slowing me down", "Nice-to-have"]
TOOLS = ["AFSS Portal", "RAKE Agent", "Not sure"]
CASE = {"name": "slow", "expect": "card", "messages": []}


def test_question_kinds_read_only_the_questions() -> None:
    assert question_kinds("Which tool are you using when it's running slow?") == {"tool"}
    assert question_kinds("Is it stopping you from getting your work done, or is it just a bit of a nuisance?") == {
        "impact"
    }
    assert question_kinds("It's affecting the whole team. Thanks for that.") == set()


def test_item_15_impact_chips_under_the_tool_question_fail() -> None:
    turns = [
        Turn(
            "My app is slow",
            ["Sorry to hear that. Which tool are you using when it's running slow?"],
            [("impact", IMPACT)],
        )
    ]
    problems = judge_turns(CASE | {"chips": ["tools"]}, turns)
    assert any("impact chips under a question that isn't about the impact" in p for p in problems)
    assert any("expected the tool chips" in p for p in problems)


def test_item_16_asking_again_after_pushback_fails() -> None:
    ask = "Is it stopping you from getting your work done, or is it just a bit of a nuisance?"
    again = (
        "Sorry, I know you mentioned it's slow.\nI just need to know how much it's affecting your work\n"
        "to help the team set the right priority.\n" + ask
    )
    turns = [
        Turn("My app is slow", ["Which tool is this about?"], [("project", TOOLS)]),
        Turn("AFSS Portal", [ask], [("impact", IMPACT)]),
        Turn("I already said it's slow", [again], [("impact", IMPACT)]),
    ]
    problems = judge_turns(CASE, turns)
    assert any("turn 3: asked the impact question again" in p for p in problems)
    assert any("asked about impact after they had said it" in p for p in problems)
    assert any("turn 3: a reply of 4 lines" in p for p in problems)


def test_item_18_dashes_and_long_answers_about_sig_fail() -> None:
    answer = "I'm Sig — I help you send feedback.\nI work with RAKE.\nRAKE answers policy.\nI route items.\nAsk away."
    problems = judge_turns({"name": "role", "expect": "no_card", "messages": []}, [Turn("what is your role", [answer])])
    assert any("a dash as punctuation" in p for p in problems) and any("5 lines" in p for p in problems)


def test_a_good_chat_passes() -> None:
    turns = [
        Turn(
            "My app is slow", ["Sorry it's slow, that gets old fast. Which tool is this about?"], [("project", TOOLS)]
        ),
        Turn("AFSS Portal", ["Got it. Which screen is slow, and since when?"]),
        Turn("the statement list takes ages to load", ["Here's what I'll send. Check it and press Confirm."]),
    ]
    assert judge_turns(
        CASE | {"chips": ["tools", "no_impact", "card"], "never_ask": ["how much it affects their work"]}, turns
    ) == ["turn 3: expected the card"]
    turns[2].card = {"title": "AFSS Portal: statement list slow"}
    assert judge_turns(CASE | {"chips": ["tools", "no_impact", "card"]}, turns) == []
