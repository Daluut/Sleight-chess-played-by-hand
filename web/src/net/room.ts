// Multiplayer client: one WebSocket per room, with automatic reconnect.
// The server is the source of truth. We send moves and render the state it sends back.
import type { Color } from 'chess.js';

export interface RoomState {
  fen: string;
  moves: string[];
  status: 'waiting' | 'playing' | 'over';
  result: { reason: 'checkmate' | 'stalemate' | 'draw' | 'resign'; winner: Color | null } | null;
  seats: { w: boolean; b: boolean };
  spectators: number;
  turn: Color;
}

export interface Welcome {
  you: Color | 'spectator';
  token: string | null;
}

export interface RoomHandlers {
  onWelcome(w: Welcome): void;
  onState(s: RoomState): void;
  onError(message: string): void;
  onConnection(connected: boolean): void;
}

export type SeatChoice = 'w' | 'b' | 'random' | 'spectator';

const TOKEN_KEY = (id: string) => `sleight.room.${id}`;

/** A saved seat token lets a refreshed page take the same seat back. */
export function savedToken(roomId: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY(roomId));
  } catch {
    return null;
  }
}

function saveToken(roomId: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY(roomId), token);
  } catch {
    // Storage blocked: a refresh will need to pick a seat again.
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch('/api/rooms', { method: 'POST' });
  if (!res.ok) throw new Error(`Could not create a room (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

/** The PC's LAN addresses, so the host can share a link the laptop can open. */
export async function lanAddresses(): Promise<string[]> {
  try {
    const res = await fetch('/api/info');
    return ((await res.json()) as { lanIps: string[] }).lanIps;
  } catch {
    return [];
  }
}

export class RoomClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private join: { token: string | null; seat: SeatChoice } = { token: null, seat: 'random' };
  private retryTimer: number | null = null;

  constructor(
    readonly roomId: string,
    private handlers: RoomHandlers,
  ) {}

  connect(seat: SeatChoice): void {
    this.closed = false;
    this.join = { token: savedToken(this.roomId), seat };
    this.open();
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws/${this.roomId}`);
    this.ws = ws;
    ws.onopen = () => {
      this.handlers.onConnection(true);
      ws.send(JSON.stringify({ type: 'join', token: this.join.token, seat: this.join.seat }));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.type === 'welcome') {
        if (msg.token) {
          saveToken(this.roomId, msg.token);
          this.join.token = msg.token;
        }
        this.handlers.onWelcome({ you: msg.you, token: msg.token });
      } else if (msg.type === 'state') {
        this.handlers.onState(msg as RoomState);
      } else if (msg.type === 'error') {
        this.handlers.onError(msg.message);
      }
    };
    ws.onclose = () => {
      this.handlers.onConnection(false);
      if (!this.closed) {
        // Reconnect with the saved token so we get our seat back.
        this.retryTimer = window.setTimeout(() => this.open(), 1500);
      }
    };
  }

  move(uci: string): void {
    this.ws?.send(JSON.stringify({ type: 'move', uci }));
  }

  resign(): void {
    this.ws?.send(JSON.stringify({ type: 'resign' }));
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}
