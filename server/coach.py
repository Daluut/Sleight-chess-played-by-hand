"""The post-game coach.

The browser sends the mistakes Stockfish found. This module checks them, turns
the moves into SAN text with python-chess, and asks an LLM to explain each one.
The LLM only receives facts we supply. If there is no API key, or the call
fails, we return plain template sentences instead.
"""

from __future__ import annotations

import json
import os
import re
from typing import Literal

import chess
from pydantic import BaseModel, Field

Color = Literal["w", "b"]


class Mistake(BaseModel):
    index: int = Field(ge=0, le=500)
    moveNumber: int = Field(ge=1, le=500)
    san: str = Field(max_length=16)
    playedUci: str = Field(pattern=r"^[a-h][1-8][a-h][1-8][qrbn]?$")
    fenBefore: str = Field(max_length=120)
    cpLoss: int = Field(ge=0, le=20000)
    category: Literal["inaccuracy", "mistake", "blunder"]
    bestUci: str | None = Field(default=None, pattern=r"^[a-h][1-8][a-h][1-8][qrbn]?$")


class ReviewRequest(BaseModel):
    playerColor: Color
    result: str = Field(max_length=32)
    accuracy: float = Field(ge=0, le=100)
    pgn: str = Field(max_length=8000)
    mistakes: list[Mistake] = Field(max_length=8)


class Explanation(BaseModel):
    index: int
    text: str


class ReviewResponse(BaseModel):
    source: Literal["llm", "template"]
    summary: str
    habit: str
    explanations: list[Explanation]


def _san(board: chess.Board, uci: str | None) -> str | None:
    if not uci:
        return None
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return None
    return board.san(move) if move in board.legal_moves else None


def grounded_facts(req: ReviewRequest) -> list[dict]:
    """Check each mistake against python-chess and add the SAN text. Bad rows are dropped."""
    facts: list[dict] = []
    for m in req.mistakes:
        try:
            board = chess.Board(m.fenBefore)
        except ValueError:
            continue
        played = _san(board, m.playedUci)
        if played is None:
            continue  # the played move is not legal in this position: ignore this row
        best = _san(board, m.bestUci)
        facts.append(
            {
                "index": m.index,
                "moveNumber": m.moveNumber,
                "color": "White" if board.turn == chess.WHITE else "Black",
                "yourMove": played,
                "betterMove": best,
                "category": m.category,
                "pawnsLost": round(m.cpLoss / 100, 1),
                "positionFen": m.fenBefore,
            }
        )
    return facts


def template_explanation(fact: dict) -> str:
    better = (
        f"{fact['betterMove']} was the stronger move."
        if fact["betterMove"]
        else "The engine found a stronger option."
    )
    return (
        f"You played {fact['yourMove']}, which lost about {fact['pawnsLost']} pawns of "
        f"advantage ({fact['category']}). {better}"
    )


def template_review(req: ReviewRequest, facts: list[dict]) -> ReviewResponse:
    return ReviewResponse(
        source="template",
        summary=f"Your accuracy was {req.accuracy:.1f}%. Review the flagged moves below.",
        habit="Before each move, check what your opponent can do next.",
        explanations=[Explanation(index=f["index"], text=template_explanation(f)) for f in facts],
    )


SYSTEM_PROMPT = """You are a friendly chess coach. You are given the player's most costly moves,
as found by the Stockfish engine. Rules:
- Explain only the facts supplied. Never invent other analysis or moves.
- For each item write one or two short sentences in plain English: what went wrong
  and what the better move achieves. Explain any chess term you use.
- Then write a 2-3 sentence summary and one habit to work on.
Reply with JSON only, in this shape:
{"summary": "...", "habit": "...", "explanations": [{"index": 0, "text": "..."}]}"""


def _parse_llm_json(text: str) -> dict:
    # Models sometimes wrap JSON in a code fence; strip that before parsing.
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    return json.loads(cleaned)


def call_llm(req: ReviewRequest, facts: list[dict]) -> dict:
    """Ask the LLM. Imported lazily so the server runs without the SDK or a key."""
    import anthropic  # noqa: PLC0415

    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
    payload = {"accuracy": req.accuracy, "playerColor": req.playerColor, "result": req.result, "mistakes": facts}
    message = client.messages.create(
        model=os.getenv("COACH_MODEL", "claude-haiku-5-5"),
        max_tokens=1200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": json.dumps(payload)}],
    )
    text = "".join(block.text for block in message.content if getattr(block, "type", "") == "text")
    return _parse_llm_json(text)


def build_review(req: ReviewRequest) -> ReviewResponse:
    facts = grounded_facts(req)
    if not facts:
        return ReviewResponse(
            source="template",
            summary=f"Your accuracy was {req.accuracy:.1f}%. No big mistakes stood out this game.",
            habit="Keep checking your opponent's threats before each move.",
            explanations=[],
        )
    if not os.getenv("ANTHROPIC_API_KEY"):
        return template_review(req, facts)
    try:
        data = call_llm(req, facts)
        allowed = {f["index"] for f in facts}
        # Only keep explanations for moves we actually sent; fill any gaps with the template.
        by_index = {int(e["index"]): str(e["text"]) for e in data.get("explanations", []) if int(e["index"]) in allowed}
        explanations = [
            Explanation(index=f["index"], text=by_index.get(f["index"], template_explanation(f))) for f in facts
        ]
        return ReviewResponse(
            source="llm",
            summary=str(data.get("summary", ""))[:800] or template_review(req, facts).summary,
            habit=str(data.get("habit", ""))[:300] or template_review(req, facts).habit,
            explanations=explanations,
        )
    except Exception:  # network, quota, or bad JSON: never fail the user's review
        return template_review(req, facts)
