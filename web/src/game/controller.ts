// GameController: the rules and turn logic for one game. It reads InputEvents
// (mouse, touch or hand), decides what a grab/drop means, and asks the board to
// animate. It knows nothing about DOM or hand tracking.
//
// Modes:
//   computer: you vs Stockfish (playerColor is your side)
//   local:    two people on one device (both sides, playerColor null)
//   online:   you vs another person over the network; the server validates moves
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import type { BoardView } from '../scene/board';
import type { InputEvent } from '../input/types';
import type { HistoryEntry } from '../review/analyze';
import type { Level } from './levels';

export type Mode = 'computer' | 'local' | 'online';

export interface GameResult {
  reason: 'checkmate' | 'stalemate' | 'draw' | 'resign';
  winner: Color | null;
}

export interface ControllerHooks {
  onChange(): void;
  onGameOver(result: GameResult): void;
  onThinking(on: boolean): void;
  onMove(entry: HistoryEntry, sound: 'move' | 'capture' | 'check' | 'castle'): void;
  /** Stockfish's move for the position, as UCI. Only used in computer mode. */
  engineMove?(fen: string, level: Level): Promise<string | null>;
  /** Online mode: send your move to the server. The board updates when the server echoes it back. */
  sendMove?(uci: string): void;
  sendResign?(): void;
}

export interface StartOptions {
  mode: Mode;
  playerColor: Color | null;
  level?: Level;
  fen?: string;
}

export class GameController {
  private game = new Chess();
  history: HistoryEntry[] = [];
  mode: Mode = 'local';
  playerColor: Color | null = null;
  level: Level | null = null;
  over: GameResult | null = null;
  thinking = false;
  paused = false;
  /** Online: moves are blocked until both seats are filled. Set from the server state. */
  opponentReady = true;

  private selected: Square | null = null;
  private targets: Square[] = [];
  private held = false;
  private generation = 0; // bumped on each new game so stale engine replies are ignored

  constructor(
    private board: BoardView,
    private hooks: ControllerHooks,
  ) {}

  get turn(): Color {
    return this.game.turn();
  }

  get fen(): string {
    return this.game.fen();
  }

  get inCheck(): boolean {
    return this.game.inCheck();
  }

  get selectedSquare(): Square | null {
    return this.selected;
  }

  get legalTargets(): Square[] {
    return this.targets;
  }

  start(opts: StartOptions): void {
    this.generation++;
    this.mode = opts.mode;
    this.playerColor = opts.playerColor;
    this.level = opts.level ?? null;
    this.game = new Chess(opts.fen);
    this.history = [];
    this.over = null;
    this.thinking = false;
    this.paused = false;
    this.clearSelection();
    this.board.setPosition(this.game.fen());
    this.board.setOverlay('last', []);
    this.refreshOverlays();
    this.hooks.onChange();
    if (this.mode === 'computer') this.maybeEngineTurn();
  }

  /** Whether the human may grab a piece right now. */
  canInteract(): boolean {
    if (this.over || this.thinking || this.paused) return false;
    if (this.mode === 'local') return true;
    if (this.mode === 'online' && !this.opponentReady) return false;
    return this.playerColor !== null && this.game.turn() === this.playerColor;
  }

  /** Whether the piece on `sq` belongs to the person currently allowed to move it. */
  private ownPiece(sq: Square): boolean {
    const piece = this.game.get(sq);
    if (!piece) return false;
    if (this.mode === 'local') return piece.color === this.game.turn();
    return this.playerColor !== null && piece.color === this.playerColor && this.game.turn() === this.playerColor;
  }

  /** Feed an input event (mouse, touch or hand) into the game. */
  handleInput(e: InputEvent): void {
    switch (e.type) {
      case 'hover':
        this.board.setOverlay('hover', e.pointer.square ? [e.pointer.square] : []);
        if (this.held) this.board.followHeld(e.pointer.point);
        break;
      case 'grab':
        this.onGrab(e.pointer.square);
        break;
      case 'drop':
        this.onDrop(e.pointer.square);
        break;
      case 'cancel':
        if (this.selected) this.board.returnPiece(this.selected);
        this.held = false;
        this.clearSelection();
        break;
      case 'swipe':
        break; // only the review screen uses swipes
    }
  }

  private onGrab(sq: Square | null): void {
    if (!sq || !this.canInteract()) {
      this.clearSelection();
      return;
    }
    // Click-to-move: a grab on a highlighted target completes a move.
    if (this.selected && this.targets.includes(sq)) {
      this.tryMove(this.selected, sq);
      this.clearSelection();
      return;
    }
    if (this.ownPiece(sq)) {
      this.selected = sq;
      this.targets = this.legalFrom(sq);
      this.held = true;
      this.board.liftPiece(sq);
      this.refreshOverlays();
      return;
    }
    this.clearSelection();
  }

  private onDrop(sq: Square | null): void {
    if (!this.held || !this.selected) {
      this.held = false;
      return;
    }
    this.held = false;
    const from = this.selected;
    if (!sq) {
      this.board.returnPiece(from);
      this.clearSelection();
      return;
    }
    if (sq === from) {
      // Dropped where it started: stay selected so the next click can move it.
      this.board.returnPiece(from);
      this.refreshOverlays();
      return;
    }
    const moved = this.targets.includes(sq) && this.tryMove(from, sq);
    if (!moved) this.board.returnPiece(from);
    this.clearSelection();
  }

  private clearSelection(): void {
    this.selected = null;
    this.targets = [];
    this.held = false;
    this.refreshOverlays();
  }

  private legalFrom(sq: Square): Square[] {
    return [...new Set(this.game.moves({ square: sq, verbose: true }).map((m) => m.to))];
  }

  /** Try a move. In online mode it is sent to the server and applied when the server replies. */
  private tryMove(from: Square, to: Square): boolean {
    const candidates = this.game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (candidates.length === 0) return false;
    // Promotion: auto-queen for now (underpromotion can come later).
    const move = candidates.find((m) => m.promotion === 'q') ?? candidates[0];
    const uci = move.from + move.to + (move.promotion ?? '');
    if (this.mode === 'online') {
      this.hooks.sendMove?.(uci);
      return true;
    }
    return this.applyUci(uci, 'player');
  }

  /**
   * Apply a move in UCI form ("e2e4", "e7e8q"): validate, update chess.js,
   * animate, record history, then check for game over or the engine's turn.
   */
  applyUci(uci: string, _by: 'player' | 'engine' | 'remote'): boolean {
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promotion = (uci[4] as PieceSymbol | undefined) ?? undefined;
    const fenBefore = this.game.fen();
    let move: Move;
    try {
      move = this.game.move({ from, to, promotion });
    } catch {
      return false; // illegal in this position
    }
    const entry: HistoryEntry = {
      san: move.san,
      uci: move.lan,
      color: move.color,
      fenBefore,
      fenAfter: this.game.fen(),
    };
    this.history.push(entry);
    this.board.animateMove(move);
    this.board.setOverlay('last', [from, to]);
    this.refreshOverlays();

    const sound = move.flags.includes('k') || move.flags.includes('q') ? 'castle' : move.captured ? 'capture' : this.game.inCheck() ? 'check' : 'move';
    this.hooks.onMove(entry, sound);
    this.hooks.onChange();

    if (this.game.isGameOver()) {
      this.finish(this.gameResultFromBoard());
    } else {
      this.maybeEngineTurn();
    }
    return true;
  }

  /** Online: replace local state with the server's move list (animating new moves). */
  syncFromServer(moves: string[], result: GameResult | null): void {
    const local = this.history.map((h) => h.uci);
    const isPrefix = moves.length >= local.length && local.every((u, i) => u === moves[i]);
    if (isPrefix) {
      for (const uci of moves.slice(local.length)) this.applyUci(uci, 'remote');
    } else {
      // Out of step (e.g. a reconnect): rebuild the game silently from the move list.
      this.generation++;
      this.game = new Chess();
      this.history = [];
      for (const uci of moves) {
        const fenBefore = this.game.fen();
        const m = this.game.move({ from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square, promotion: (uci[4] as PieceSymbol) || undefined });
        this.history.push({ san: m.san, uci: m.lan, color: m.color, fenBefore, fenAfter: this.game.fen() });
      }
      this.board.setPosition(this.game.fen());
      this.clearSelection();
      this.board.setOverlay('last', this.history.length ? [this.history.at(-1)!.uci.slice(0, 2) as Square, this.history.at(-1)!.uci.slice(2, 4) as Square] : []);
    }
    this.refreshOverlays();
    this.hooks.onChange();
    if (!this.over && result) this.finish(result); // resignation or other server-side ending
    else if (!this.over && this.game.isGameOver()) this.finish(this.gameResultFromBoard());
  }

  resign(): void {
    if (this.over) return;
    if (this.mode === 'online') {
      this.hooks.sendResign?.();
      return;
    }
    const loser = this.mode === 'computer' ? this.playerColor : this.game.turn();
    const winner = loser === 'w' ? 'b' : 'w';
    this.finish({ reason: 'resign', winner });
  }

  /** Computer mode: let Stockfish answer after a short pause so it feels natural. */
  private maybeEngineTurn(): void {
    if (this.mode !== 'computer' || this.over || !this.level || !this.hooks.engineMove) return;
    if (this.game.turn() === this.playerColor) return;
    this.thinking = true;
    this.hooks.onThinking(true);
    const gen = this.generation;
    const fen = this.game.fen();
    const level = this.level;
    const wait = new Promise((r) => setTimeout(r, 350));
    Promise.all([this.hooks.engineMove(fen, level), wait]).then(([uci]) => {
      if (gen !== this.generation) return; // a new game started meanwhile
      this.thinking = false;
      this.hooks.onThinking(false);
      if (uci) this.applyUci(uci, 'engine');
    });
  }

  private gameResultFromBoard(): GameResult {
    if (this.game.isCheckmate()) {
      return { reason: 'checkmate', winner: this.game.turn() === 'w' ? 'b' : 'w' };
    }
    return { reason: this.game.isStalemate() ? 'stalemate' : 'draw', winner: null };
  }

  private finish(result: GameResult): void {
    this.over = result;
    this.clearSelection();
    this.hooks.onGameOver(result);
    this.hooks.onChange();
  }

  /** Recompute highlights for the selection, legal targets and check. */
  private refreshOverlays(): void {
    this.board.setOverlay('selected', this.selected ? [this.selected] : []);
    const captures = this.targets.filter((sq) => this.game.get(sq) !== null);
    const dots = this.targets.filter((sq) => !captures.includes(sq));
    this.board.setOverlay('dot', dots);
    this.board.setOverlay('capture', captures);

    let checkSq: Square[] = [];
    if (this.game.inCheck()) {
      for (const row of this.game.board()) {
        for (const cell of row) {
          if (cell && cell.type === 'k' && cell.color === this.game.turn()) checkSq = [cell.square];
        }
      }
    }
    this.board.setOverlay('check', checkSq);
  }
}
