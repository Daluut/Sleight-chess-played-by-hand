"""Multiplayer rooms: seats, the authoritative board, and move validation.

The server is the referee. Clients send UCI moves ("e2e4"); a move is only
applied if it is legal in the current position and it is that seat's turn.
Rooms live in memory and disappear when the server restarts, which is fine
for games on a local network.
"""

from __future__ import annotations

import random
import secrets
from dataclasses import dataclass, field

import chess

Seat = str  # "w" or "b"


@dataclass
class Room:
    id: str
    board: chess.Board = field(default_factory=chess.Board)
    moves: list[str] = field(default_factory=list)
    # seat -> the token of the player sitting in it
    seats: dict[Seat, str | None] = field(default_factory=lambda: {"w": None, "b": None})
    # token -> seat, so a refreshed browser can take its seat back
    tokens: dict[str, Seat] = field(default_factory=dict)
    resigned_by: Seat | None = None

    # ----- seats -----

    def join(self, token: str | None, seat_pref: str) -> tuple[str, Seat | None]:
        """Return (token, seat). seat is None for spectators.

        seat_pref is "w", "b", "random" or "spectator". A returning player gets
        their old seat back regardless of the preference.
        """
        if token and token in self.tokens:
            return token, self.tokens[token]
        if seat_pref == "spectator":
            return secrets.token_urlsafe(16), None

        free = [s for s in ("w", "b") if self.seats[s] is None]
        if not free:
            return secrets.token_urlsafe(16), None  # room full: watch only

        if seat_pref in free:
            seat = seat_pref
        elif seat_pref in ("w", "b"):
            seat = free[0]  # requested colour taken: give the other one
        else:
            seat = random.choice(free)

        new_token = secrets.token_urlsafe(16)
        self.seats[seat] = new_token
        self.tokens[new_token] = seat
        return new_token, seat

    def seat_filled(self, seat: Seat) -> bool:
        return self.seats[seat] is not None

    # ----- game -----

    @property
    def status(self) -> str:
        if self.resigned_by or self.board.is_game_over():
            return "over"
        if self.seat_filled("w") and self.seat_filled("b"):
            return "playing"
        return "waiting"

    def result(self) -> dict | None:
        if self.resigned_by:
            winner = "b" if self.resigned_by == "w" else "w"
            return {"reason": "resign", "winner": winner}
        if not self.board.is_game_over():
            return None
        if self.board.is_checkmate():
            return {"reason": "checkmate", "winner": "b" if self.board.turn == chess.WHITE else "w"}
        if self.board.is_stalemate():
            return {"reason": "stalemate", "winner": None}
        return {"reason": "draw", "winner": None}

    def apply_move(self, seat: Seat, uci: str) -> str | None:
        """Apply a move. Returns an error message, or None when it was accepted."""
        if self.status != "playing":
            return "The game is not in progress yet." if self.status == "waiting" else "The game is over."
        if seat != ("w" if self.board.turn == chess.WHITE else "b"):
            return "It is not your turn."
        try:
            move = chess.Move.from_uci(uci)
        except ValueError:
            return "That is not a valid move format."
        if move not in self.board.legal_moves:
            return "Illegal move."
        self.board.push(move)
        self.moves.append(uci)
        return None

    def resign(self, seat: Seat) -> str | None:
        if self.status != "playing":
            return "There is no game to resign from."
        self.resigned_by = seat
        return None

    def state(self) -> dict:
        return {
            "type": "state",
            "fen": self.board.fen(),
            "moves": list(self.moves),
            "turn": "w" if self.board.turn == chess.WHITE else "b",
            "status": self.status,
            "result": self.result(),
            "seats": {"w": self.seat_filled("w"), "b": self.seat_filled("b")},
        }


class RoomStore:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    def create(self) -> Room:
        room_id = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
        room = Room(id=room_id)
        self.rooms[room_id] = room
        return room

    def get(self, room_id: str) -> Room | None:
        return self.rooms.get(room_id)
