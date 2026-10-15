import chess

from coach import Explanation, Mistake, ReviewRequest, build_review, grounded_facts, template_review

START = chess.STARTING_FEN


def make_request(**overrides) -> ReviewRequest:
    base = dict(
        playerColor="w",
        result="checkmate",
        accuracy=72.5,
        pgn="1. e4 e5",
        mistakes=[
            Mistake(
                index=0,
                moveNumber=1,
                san="a3",
                playedUci="a2a3",
                fenBefore=START,
                cpLoss=250,
                category="blunder",
                bestUci="e2e4",
            )
        ],
    )
    base.update(overrides)
    return ReviewRequest(**base)


def test_grounded_facts_adds_san_from_python_chess():
    facts = grounded_facts(make_request())
    assert facts[0]["yourMove"] == "a3"
    assert facts[0]["betterMove"] == "e4"
    assert facts[0]["pawnsLost"] == 2.5


def test_illegal_played_move_is_dropped_not_explained():
    bad = make_request(
        mistakes=[
            Mistake(index=0, moveNumber=1, san="x", playedUci="e2e5", fenBefore=START, cpLoss=300, category="blunder")
        ]
    )
    assert grounded_facts(bad) == []


def test_template_review_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = build_review(make_request())
    assert result.source == "template"
    assert result.explanations[0].index == 0
    assert "a3" in result.explanations[0].text and "e4" in result.explanations[0].text


def test_llm_output_for_unknown_index_is_ignored(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    fake = {
        "summary": "Good effort.",
        "habit": "Check threats.",
        "explanations": [{"index": 99, "text": "invented"}, {"index": 0, "text": "Real explanation."}],
    }
    import coach

    monkeypatch.setattr(coach, "call_llm", lambda req, facts: fake)
    result = build_review(make_request())
    assert result.source == "llm"
    texts = {e.index: e.text for e in result.explanations}
    assert texts == {0: "Real explanation."}


def test_llm_failure_falls_back_to_template(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test")
    import coach

    def boom(req, facts):
        raise RuntimeError("network down")

    monkeypatch.setattr(coach, "call_llm", boom)
    result = build_review(make_request())
    assert result.source == "template"
