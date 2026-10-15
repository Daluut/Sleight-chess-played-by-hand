// App entry: wires the 3D board, input, game controller, UI, engine, coach and
// multiplayer together. Screens are: title -> setup -> game -> game over -> review,
// plus multiplayer rooms at /room/<id>.
import './ui/style.css';
import { Chess, type Color } from 'chess.js';
import { BoardView, PALETTES } from './scene/board';
import { GameController, type GameResult } from './game/controller';
import { StockfishEngine } from './game/engine';
import { LEVELS, type Level } from './game/levels';
import { loadSettings, saveSettings, type Settings, type ThemeName } from './settings';
import { MouseInput } from './input/mouse';
import { startHandInput, type HandHandle } from './input/hand';
import type { InputEvent } from './input/types';
import { UI } from './ui/ui';
import * as sfx from './ui/sound';
import { speak, stopSpeaking } from './ui/voice';
import { analyzeGame, type GameAnalysis, type HistoryEntry } from './review/analyze';
import { buildReview, sanOf, type ReviewReport } from './review/review';
import {
  createRoom,
  lanAddresses,
  RoomClient,
  savedToken,
  type RoomState,
  type SeatChoice,
  type Welcome,
} from './net/room';
import type { Square } from 'chess.js';

const TUTORIAL_KEY = 'sleight.tutorialDone';
const START_FEN = new Chess().fen();

// ---------- app state ----------
const settings = loadSettings();
const board = new BoardView(document.getElementById('board')!);
board.setTheme(settings.theme);
applyThemeCss(settings.theme);
board.start();
board.setAutoRotate(true);

let engine: StockfishEngine | null = null;
const getEngine = (): StockfishEngine => (engine ??= new StockfishEngine());

let mouse: MouseInput | null = null;
let hand: HandHandle | null = null;
let handStatus = '';
let cameraAvailable = true;
let gameActive = false;
let setupColor: 'w' | 'b' | 'random' = 'w';
let setupLevel = 'knight';
let tutorialStep = -1; // -1 = not running
let review: { analysis: GameAnalysis; report: ReviewReport; index: number } | null = null;

let room: RoomClient | null = null;
let roomId: string | null = null;
let roomState: RoomState | null = null;
let you: Color | 'spectator' | null = null;
let roomLink: string | null = null;

// ---------- controller and UI ----------
const controller = new GameController(board, {
  onChange: () => renderHud(),
  onGameOver: (result) => onGameOver(result),
  onThinking: () => renderHud(),
  onMove: (entry, sound) => {
    sfx.play(sound);
    if (controller.mode === 'local' && settings.flipBoard && !controller.over) board.setView(controller.turn);
    if (tutorialStep >= 0) tutorialMoved(entry);
  },
  engineMove: (fen, level) => getEngine().bestMove(fen, level),
  sendMove: (uci) => room?.move(uci),
  sendResign: () => room?.resign(),
});

const ui = new UI(onAction, onSetting);
sfx.setSoundEnabled(settings.sound);

// Keyboard review navigation (arrow keys), in addition to swipes.
window.addEventListener('keydown', (e) => {
  if (!review) return;
  if (e.key === 'ArrowRight') reviewStep(1);
  if (e.key === 'ArrowLeft') reviewStep(-1);
});

// ---------- input ----------
function dispatch(e: InputEvent): void {
  if (!gameActive) return;
  if (review && e.type === 'swipe') {
    reviewStep(e.dir === 'left' ? 1 : -1);
    return;
  }
  controller.handleInput(e);
  if (tutorialStep >= 0) tutorialInput(e);
}

async function startInput(): Promise<void> {
  if (mouse || hand) return;
  if (settings.inputMode === 'hand' && cameraAvailable) {
    try {
      const cam = document.getElementById('cam') as HTMLVideoElement;
      const canvas = document.getElementById('landmarks') as HTMLCanvasElement;
      hand = await startHandInput(board, settings, dispatch, { video: cam, canvas }, (text) => {
        handStatus = text;
        renderHud();
      });
      hand.setPreview(settings.showPreview);
      ui.showPreview(settings.showPreview);
      return;
    } catch {
      cameraAvailable = false;
      ui.toast('No camera or permission denied: using the mouse instead.', 5000);
    }
  }
  ui.showPreview(false);
  mouse = new MouseInput(board, dispatch);
}

function stopInput(): void {
  mouse?.stop();
  mouse = null;
  hand?.stop();
  hand = null;
  handStatus = '';
}

// ---------- screens ----------
function goTitle(): void {
  stopInput();
  gameActive = false;
  review = null;
  tutorialStep = -1;
  room?.close();
  room = null;
  roomState = null;
  you = null;
  roomId = null;
  stopSpeaking();
  ui.setHud(null);
  ui.setTutorial(null);
  board.clearArrows();
  board.setPosition(START_FEN);
  board.setView('w', false);
  board.setAutoRotate(true);
  ui.setMenu(ui.title());
}

function beginGame(opts: { mode: 'computer' | 'local'; playerColor: Color | null; level?: Level }): void {
  ui.setMenu(null);
  ui.setTutorial(null);
  board.setAutoRotate(false);
  board.clearArrows();
  gameActive = true;
  controller.start({ ...opts, fen: undefined });
  board.setView(opts.playerColor ?? 'w', false);
  void startInput();
  renderHud();
}

function startComputer(): void {
  const color: Color = setupColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : setupColor;
  const level = LEVELS.find((l) => l.id === setupLevel) ?? LEVELS[1];
  beginGame({ mode: 'computer', playerColor: color, level });
}

function startLocal(): void {
  beginGame({ mode: 'local', playerColor: null });
}

// ---------- actions ----------
function onAction(action: string, el: HTMLElement): void {
  switch (action) {
    case 'title':
      goTitle();
      break;
    case 'play':
      ui.setMenu(ui.setup(setupColor, setupLevel, settings.inputMode === 'hand'));
      break;
    case 'pickColor':
      setupColor = el.dataset.value as 'w' | 'b' | 'random';
      ui.setMenu(ui.setup(setupColor, setupLevel, settings.inputMode === 'hand'));
      break;
    case 'pickLevel':
      setupLevel = el.dataset.value!;
      ui.setMenu(ui.setup(setupColor, setupLevel, settings.inputMode === 'hand'));
      break;
    case 'startComputer':
    case 'newGame':
      startComputer();
      break;
    case 'multiplayer':
      ui.setMenu(ui.multiplayer());
      break;
    case 'localGame':
      startLocal();
      break;
    case 'createRoom':
      void createRoomFlow(el.dataset.value as SeatChoice);
      break;
    case 'joinLink':
      joinLinkFlow();
      break;
    case 'joinRoom':
      ui.setMenu(null);
      connectRoom(el.dataset.value as SeatChoice);
      break;
    case 'howto':
      ui.setMenu(ui.howTo());
      break;
    case 'settings':
      ui.setMenu(ui.settings(settings));
      break;
    case 'tutorial':
      startTutorial();
      break;
    case 'skipTutorial':
    case 'tutorialDone':
      endTutorial();
      break;
    case 'pause':
      controller.paused = true;
      ui.setMenu(ui.pause());
      break;
    case 'resume':
      controller.paused = false;
      ui.setMenu(null);
      break;
    case 'resign':
      if (window.confirm('Resign this game?')) controller.resign();
      break;
    case 'leave':
      leaveGame();
      break;
    case 'review':
      void startReview();
      break;
    case 'prevMove':
      reviewStep(-1);
      break;
    case 'nextMove':
      reviewStep(1);
      break;
    case 'reviewAgain':
      if (review) showReviewItem(0);
      break;
    case 'togglePreview':
      settings.showPreview = !settings.showPreview;
      saveSettings(settings);
      hand?.setPreview(settings.showPreview);
      ui.showPreview(settings.showPreview);
      renderHud();
      break;
    case 'copyLink':
      if (roomLink) void navigator.clipboard?.writeText(roomLink).then(
        () => ui.toast('Link copied'),
        () => ui.toast(roomLink!, 6000),
      );
      break;
  }
}

function onSetting(key: keyof Settings, raw: string | boolean): void {
  switch (key) {
    case 'theme': {
      const name = raw as ThemeName;
      settings.theme = name;
      board.setTheme(name);
      applyThemeCss(name);
      break;
    }
    case 'gripSensitivity':
    case 'smoothing':
      (settings as unknown as Record<string, number>)[key] = Number(raw);
      break;
    case 'inputMode':
      settings.inputMode = raw as Settings['inputMode'];
      cameraAvailable = true; // retry the camera if the user switches back to hand
      break;
    case 'sound':
      settings.sound = raw as boolean;
      sfx.setSoundEnabled(settings.sound);
      break;
    case 'showPreview':
      settings.showPreview = raw as boolean;
      hand?.setPreview(settings.showPreview);
      ui.showPreview(settings.showPreview && !!hand);
      break;
    default:
      (settings as unknown as Record<string, boolean | string>)[key] = raw;
  }
  saveSettings(settings);
}

function applyThemeCss(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  document.body.style.background = PALETTES[name].bg;
}

// ---------- HUD ----------
function resultText(r: GameResult): string {
  const winner = r.winner === 'w' ? 'White' : r.winner === 'b' ? 'Black' : null;
  if (r.reason === 'checkmate') return `Checkmate: ${winner} wins`;
  if (r.reason === 'resign') return `${winner} wins by resignation`;
  return r.reason === 'stalemate' ? 'Stalemate: draw' : 'Draw';
}

/** Pieces each side has lost so far, from the move history. */
function capturedPieces(history: HistoryEntry[]): { w: string[]; b: string[] } {
  const out = { w: [] as string[], b: [] as string[] };
  for (const h of history) {
    if (!h.san.includes('x')) continue;
    const to = h.uci.slice(2, 4) as Square;
    const before = new Chess(h.fenBefore);
    const victim = before.get(to) ?? { type: 'p' as const, color: h.color === 'w' ? 'b' : 'w' };
    out[victim.color].push(ui.glyph(victim.color, victim.type));
  }
  return out;
}

function renderHud(): void {
  if (!gameActive) {
    ui.setHud(null);
    return;
  }
  const c = controller;
  const online = c.mode === 'online';
  const level = c.level?.name ?? '';
  const modeLabel =
    c.mode === 'computer'
      ? `vs Stockfish (${level}) · you are ${c.playerColor === 'w' ? 'White' : 'Black'}`
      : c.mode === 'local'
        ? 'Local two-player'
        : `Room ${roomId}`;
  let status: string;
  if (c.over) status = resultText(c.over);
  else if (c.thinking) status = 'Stockfish is thinking…';
  else if (online) status = ui.roomStatus(roomState, you, true);
  else status = `${c.turn === 'w' ? 'White' : 'Black'} to move${c.inCheck ? ' · check!' : ''}`;

  ui.setHud(
    ui.hud({
      modeLabel,
      status,
      online,
      link: online ? (roomLink ?? undefined) : undefined,
      moves: c.history.map((h) => h.san),
      captured: capturedPieces(c.history),
      showPreviewToggle: !!hand,
      previewOn: settings.showPreview,
      handStatus,
    }),
  );
}

function onGameOver(result: GameResult): void {
  sfx.play('end');
  const canReview = controller.mode === 'computer' && controller.playerColor !== null;
  ui.setMenu(ui.gameOver(result, controller.playerColor, canReview, controller.mode === 'online'));
  renderHud();
}

function leaveGame(): void {
  if (room) {
    // Leaving a room: go back to the front page so the socket closes cleanly.
    location.href = '/';
    return;
  }
  goTitle();
}

// ---------- post-game review ----------
async function startReview(): Promise<void> {
  if (controller.mode !== 'computer' || !controller.over || controller.playerColor === null) return;
  const history = controller.history;
  ui.setMenu(ui.reviewLoading('Starting the engine…'));
  const eng = getEngine();
  const analysis = await analyzeGame(
    history,
    (fen, depth) => eng.analyze(fen, depth),
    10,
    (done, total) => ui.reviewProgress(`Position ${done} of ${total}`),
  );
  ui.reviewProgress('Asking the coach…');
  const report = await buildReview(analysis, history, controller.playerColor, controller.over.reason);
  review = { analysis, report, index: 0 };
  if (report.items.length === 0) {
    ui.setMenu(ui.reviewSummary(report));
    return;
  }
  showReviewItem(0);
}

function showReviewItem(i: number): void {
  if (!review) return;
  const { report } = review;
  if (i >= report.items.length) {
    board.clearArrows();
    ui.setMenu(ui.reviewSummary(report));
    return;
  }
  review.index = Math.max(0, i);
  const item = report.items[review.index];
  board.setPosition(item.fenBefore);
  board.setView(controller.playerColor ?? 'w', false);
  board.setOverlay('last', []);
  const played = [item.playedUci.slice(0, 2), item.playedUci.slice(2, 4)] as Square[];
  const arrows = [{ from: played[0], to: played[1], color: 0xff5555 }];
  if (item.bestUci && item.bestUci !== item.playedUci) {
    arrows.push({ from: item.bestUci.slice(0, 2) as Square, to: item.bestUci.slice(2, 4) as Square, color: 0x55ff88 });
  }
  board.showArrows(arrows);
  ui.setMenu(ui.reviewItem(item, review.index, report.items.length, settings.voice));
  if (settings.voice) speak(item.explanation);
}

function reviewStep(delta: number): void {
  if (!review) return;
  const next = review.index + delta;
  if (next < 0) return;
  if (next >= review.report.items.length) {
    showReviewItem(next);
    return;
  }
  showReviewItem(next);
}

// ---------- tutorial ----------
const TUTORIAL_TEXT = (hand: boolean) => [
  hand ? 'Point your index finger at the glowing e2 pawn.' : 'Move the mouse over the glowing e2 pawn.',
  hand ? 'Make a fist to grab it.' : 'Press and hold the left button on it.',
  hand ? 'Carry it to the glowing e4 square and open your hand.' : 'Drag it to the glowing e4 square and release.',
];

function startTutorial(): void {
  tutorialStep = 0;
  review = null;
  beginGame({ mode: 'local', playerColor: null });
  board.setOverlay('tutorial', ['e2']);
  renderTutorial();
}

function renderTutorial(): void {
  const steps = TUTORIAL_TEXT(!!hand);
  if (tutorialStep < 0) return;
  if (tutorialStep >= steps.length) {
    ui.setTutorial(
      `<div class="tutorial-card"><p><b>Nice, that's the whole idea.</b> Now try a real game.</p>
       <button data-action="tutorialDone" class="primary">Done</button></div>`,
    );
    return;
  }
  ui.setTutorial(ui.tutorialStep(steps[tutorialStep], tutorialStep + 1, steps.length));
}

function tutorialInput(e: InputEvent): void {
  if (tutorialStep === 0 && e.type === 'hover' && e.pointer.square === 'e2') {
    tutorialStep = 1;
    board.setOverlay('tutorial', ['e4']);
    renderTutorial();
  } else if (tutorialStep === 1 && e.type === 'grab' && e.pointer.square === 'e2') {
    tutorialStep = 2;
    renderTutorial();
  }
}

function tutorialMoved(entry: HistoryEntry): void {
  if (tutorialStep === 2 && entry.uci === 'e2e4') {
    tutorialStep = 3;
    board.setOverlay('tutorial', []);
    renderTutorial();
  }
}

function endTutorial(): void {
  tutorialStep = -1;
  try {
    localStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // ignore
  }
  goTitle();
}

// ---------- multiplayer ----------
async function createRoomFlow(seat: SeatChoice): Promise<void> {
  try {
    const id = await createRoom();
    location.href = `/room/${id}?color=${seat}`;
  } catch (err) {
    ui.toast((err as Error).message);
  }
}

function joinLinkFlow(): void {
  const value = (document.getElementById('join-link') as HTMLInputElement | null)?.value ?? '';
  const match = /\/room\/([\w-]+)/.exec(value);
  if (!match) {
    ui.toast('That does not look like a room link.');
    return;
  }
  location.href = `/room/${match[1]}`;
}

function startRoomPage(id: string): void {
  roomId = id;
  gameActive = false;
  const seatParam = new URLSearchParams(location.search).get('color') as SeatChoice | null;
  // Creators arrive with ?color=, and returning players have a saved seat token.
  if (!savedToken(id) && !seatParam) {
    ui.setMenu(ui.joinChooser(null));
    return;
  }
  connectRoom(seatParam ?? 'random');
}

async function computeLink(id: string): Promise<string> {
  const { hostname, protocol, origin, port } = location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (!isLocal) return `${origin}/room/${id}`;
  const ips = await lanAddresses();
  return ips.length ? `${protocol}//${ips[0]}:${port}/room/${id}` : `${origin}/room/${id}`;
}

function connectRoom(seat: SeatChoice): void {
  if (!roomId) return;
  room?.close();
  gameActive = true;
  void computeLink(roomId).then((link) => {
    roomLink = link;
    renderHud();
  });
  void startInput();
  room = new RoomClient(roomId, {
    onWelcome: (w: Welcome) => onWelcome(w),
    onState: (s) => onRoomState(s),
    onError: (msg) => {
      ui.toast(msg);
      // The move never happened on the server: put the piece back where it was.
      board.setPosition(controller.fen);
    },
    onConnection: (ok) => {
      if (!ok) ui.toast('Connection lost. Reconnecting…', 2500);
    },
  });
  room.connect(seat);
}

function onWelcome(w: Welcome): void {
  you = w.you;
  roomState = null;
  ui.setMenu(null);
  controller.start({ mode: 'online', playerColor: w.you === 'spectator' ? null : w.you, fen: undefined });
  controller.opponentReady = false;
  board.setView(w.you === 'spectator' ? 'w' : w.you, false);
  renderHud();
}

function onRoomState(s: RoomState): void {
  const wasWaiting = roomState?.status === 'waiting';
  roomState = s;
  controller.opponentReady = s.status === 'playing';
  controller.syncFromServer(s.moves, s.result ?? null);
  if (wasWaiting && s.status === 'playing') ui.toast('Opponent joined. Good luck!');
  renderHud();
}

// ---------- boot ----------
function boot(): void {
  const roomMatch = /^\/room\/([\w-]+)\/?$/.exec(location.pathname);
  if (roomMatch) {
    startRoomPage(roomMatch[1]);
    return;
  }
  // First visit: take the tutorial. Afterwards go straight to the title.
  let done = false;
  try {
    done = localStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    done = true;
  }
  if (!done) startTutorial();
  else goTitle();
}

// Dev-only handle so browser tests can read the board and controller state.
if (import.meta.env.DEV) Object.assign(window, { sleight: { board, controller } });

boot();
