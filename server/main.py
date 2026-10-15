"""FastAPI server: the coach endpoint and the multiplayer relay.

Run from the server folder:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import json
import os
import socket

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from coach import ReviewRequest, ReviewResponse, build_review
from rooms import Room, RoomStore

load_dotenv()  # reads server/.env if present; the key never goes in git

app = FastAPI(title="Sleight server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

rooms = RoomStore()
# room id -> list of live connections: {"ws": WebSocket, "seat": "w"|"b"|None}
connections: dict[str, list[dict]] = {}


def lan_addresses() -> list[str]:
    """IPv4 addresses this PC can be reached at on the local network."""
    found: list[str] = []
    try:
        # Connecting a UDP socket sends nothing; it just reveals the outgoing interface.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 80))
            found.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127.") and ip not in found:
                found.append(ip)
    except OSError:
        pass
    return found


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/info")
def info() -> dict:
    return {"lanIps": lan_addresses()}


@app.post("/api/review", response_model=ReviewResponse)
def review(req: ReviewRequest) -> ReviewResponse:
    return build_review(req)


@app.post("/api/rooms")
def create_room() -> dict:
    return {"id": rooms.create().id}


@app.get("/api/rooms/{room_id}")
def room_info(room_id: str) -> dict:
    room = rooms.get(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="No such room")
    return {"id": room.id, "status": room.status}


def _state_for(room: Room, seat: str | None) -> dict:
    state = room.state()
    state["you"] = seat or "spectator"
    state["spectators"] = sum(1 for c in connections.get(room.id, []) if c["seat"] is None)
    return state


async def _broadcast(room: Room) -> None:
    """Send each connected client the state from its own point of view."""
    for conn in list(connections.get(room.id, [])):
        try:
            await conn["ws"].send_text(json.dumps(_state_for(room, conn["seat"])))
        except Exception:
            connections[room.id].remove(conn)


@app.websocket("/api/ws/{room_id}")
async def room_socket(ws: WebSocket, room_id: str) -> None:
    room = rooms.get(room_id)
    if room is None:
        await ws.close(code=4404)
        return
    await ws.accept()

    conn: dict = {"ws": ws, "seat": None}
    try:
        # First message must be a join: {"type":"join","token":..., "seat":"w"|"b"|"random"|"spectator"}
        first = json.loads(await ws.receive_text())
        if first.get("type") != "join":
            await ws.send_text(json.dumps({"type": "error", "message": "Send a join message first."}))
            await ws.close()
            return
        token, seat = room.join(first.get("token"), str(first.get("seat", "random")))
        conn["seat"] = seat
        connections.setdefault(room_id, []).append(conn)
        await ws.send_text(json.dumps({"type": "welcome", "you": seat or "spectator", "token": token}))
        await _broadcast(room)

        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "move":
                if conn["seat"] is None:
                    error = "Spectators cannot move."
                else:
                    error = room.apply_move(conn["seat"], str(msg.get("uci", "")))
            elif kind == "resign":
                error = "Spectators cannot resign." if conn["seat"] is None else room.resign(conn["seat"])
            else:
                error = f"Unknown message type: {kind}"

            if error:
                await ws.send_text(json.dumps({"type": "error", "message": error}))
            else:
                await _broadcast(room)
    except WebSocketDisconnect:
        pass
    except (json.JSONDecodeError, KeyError, TypeError):
        pass  # malformed client message: drop the connection, keep the room
    finally:
        if conn in connections.get(room_id, []):
            connections[room_id].remove(conn)
        # The seat stays reserved for the token, so a refresh can take it back.
        await asyncio.sleep(0)
        await _broadcast(room)
