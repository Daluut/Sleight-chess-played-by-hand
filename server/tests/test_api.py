import json

from fastapi.testclient import TestClient

import main


def client():
    return TestClient(main.app)


def recv_until(ws, pred, limit=10):
    """Read messages until one matches pred. Broadcasts make exact counting fragile."""
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        if pred(msg):
            return msg
    raise AssertionError("expected message not received")


def test_create_room_and_two_players_play_a_move():
    c = client()
    room_id = c.post("/api/rooms").json()["id"]
    with c.websocket_connect(f"/api/ws/{room_id}") as white, c.websocket_connect(f"/api/ws/{room_id}") as black:
        white.send_text(json.dumps({"type": "join", "token": None, "seat": "w"}))
        welcome = recv_until(white, lambda m: m["type"] == "welcome")
        assert welcome["you"] == "w" and welcome["token"]

        black.send_text(json.dumps({"type": "join", "token": None, "seat": "b"}))
        assert recv_until(black, lambda m: m["type"] == "welcome")["you"] == "b"
        recv_until(white, lambda m: m["type"] == "state" and m["status"] == "playing")

        white.send_text(json.dumps({"type": "move", "uci": "e2e4"}))
        state = recv_until(black, lambda m: m["type"] == "state" and m["moves"] == ["e2e4"])
        assert state["turn"] == "b"

        # White tries to move again out of turn: only white gets the error.
        white.send_text(json.dumps({"type": "move", "uci": "d2d4"}))
        err = recv_until(white, lambda m: m["type"] == "error")
        assert err["message"] == "It is not your turn."

        black.send_text(json.dumps({"type": "move", "uci": "e7e5"}))
        recv_until(white, lambda m: m["type"] == "state" and m["moves"] == ["e2e4", "e7e5"])


def test_unknown_room_is_rejected():
    c = client()
    raised = False
    try:
        with c.websocket_connect("/api/ws/doesnotexist") as ws:
            ws.receive_text()
    except Exception:
        raised = True
    assert raised


def test_review_endpoint_works_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    res = client().post(
        "/api/review",
        json={
            "playerColor": "w",
            "result": "checkmate",
            "accuracy": 80,
            "pgn": "1. e4",
            "mistakes": [
                {
                    "index": 0,
                    "moveNumber": 1,
                    "san": "a3",
                    "playedUci": "a2a3",
                    "fenBefore": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                    "cpLoss": 120,
                    "category": "mistake",
                    "bestUci": "e2e4",
                }
            ],
        },
    )
    assert res.status_code == 200
    assert res.json()["source"] == "template"
