// The DOM layer: menus, HUD, tutorial prompts and toasts, as plain HTML strings.
// Buttons carry data-action; one delegated listener routes clicks to main.ts.
import type { Color, PieceSymbol } from 'chess.js';
import { LEVELS } from '../game/levels';
import type { Settings } from '../settings';
import type { GameResult } from '../game/controller';
import type { ReviewItem, ReviewReport } from '../review/review';
import type { RoomState } from '../net/room';

export type Action = string;
export type ActionHandler = (action: Action, el: HTMLElement) => void;
export type SettingHandler = (key: keyof Settings, value: string | boolean) => void;

const PIECE_GLYPH: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class UI {
  private els = {
    menu: document.getElementById('menu')!,
    hud: document.getElementById('hud')!,
    tutorial: document.getElementById('tutorial')!,
    toast: document.getElementById('toast')!,
    preview: document.getElementById('preview')!,
  };
  private toastTimer: number | null = null;

  constructor(
    onAction: ActionHandler,
    onSetting: SettingHandler,
  ) {
    document.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (el && !(el as HTMLButtonElement).disabled) onAction(el.dataset.action!, el);
    });
    document.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      if (!el.dataset.setting) return;
      const value = el.type === 'checkbox' ? el.checked : el.value;
      onSetting(el.dataset.setting as keyof Settings, value);
    });
    document.addEventListener('input', (e) => {
      // Live update for sliders.
      const el = e.target as HTMLInputElement;
      if (el.type === 'range' && el.dataset.setting) onSetting(el.dataset.setting as keyof Settings, el.value);
    });
  }

  get previewEl(): HTMLElement {
    return this.els.preview;
  }

  setMenu(html: string | null): void {
    this.els.menu.innerHTML = html ?? '';
    this.els.menu.classList.toggle('hidden', html === null);
  }

  setHud(html: string | null): void {
    this.els.hud.innerHTML = html ?? '';
    this.els.hud.classList.toggle('hidden', html === null);
  }

  setTutorial(html: string | null): void {
    this.els.tutorial.innerHTML = html ?? '';
    this.els.tutorial.classList.toggle('hidden', html === null);
  }

  showPreview(visible: boolean): void {
    this.els.preview.classList.toggle('hidden', !visible);
  }

  toast(text: string, ms = 3500): void {
    this.els.toast.textContent = text;
    this.els.toast.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.els.toast.classList.add('hidden'), ms);
  }

  // ---------- screens ----------

  title(): string {
    return `
      <section class="card title">
        <h1 class="logo">Sleight</h1>
        <p class="tag">Chess, played by hand.</p>
        <div class="stack">
          <button data-action="play" class="primary">Play vs computer</button>
          <button data-action="multiplayer">Multiplayer</button>
          <button data-action="howto">How to play</button>
          <button data-action="settings">Settings</button>
        </div>
      </section>`;
  }

  setup(color: 'w' | 'b' | 'random', levelId: string, handMode: boolean): string {
    const pick = (value: string, current: string, label: string, attr: string) =>
      `<button data-action="${attr}" data-value="${value}" class="${value === current ? 'selected' : ''}">${label}</button>`;
    return `
      <section class="card">
        <h2>New game</h2>
        <p class="label">You play</p>
        <div class="row">
          ${pick('w', color, 'White', 'pickColor')}${pick('b', color, 'Black', 'pickColor')}${pick('random', color, 'Random', 'pickColor')}
        </div>
        <p class="label">Opponent</p>
        <div class="levels">
          ${LEVELS.map((l) => `<button data-action="pickLevel" data-value="${l.id}" class="${l.id === levelId ? 'selected' : ''}"><b>${l.name}</b><small>${l.blurb}</small></button>`).join('')}
        </div>
        <p class="hint">Input: ${handMode ? 'hand (webcam)' : 'mouse / touch'} — change in Settings.</p>
        <div class="stack">
          <button data-action="startComputer" class="primary">Start game</button>
          <button data-action="title">Back</button>
        </div>
      </section>`;
  }

  multiplayer(): string {
    return `
      <section class="card">
        <h2>Multiplayer</h2>
        <p class="label">Two people on this device</p>
        <button data-action="localGame" class="primary">Local two-player</button>
        <p class="label">Online on your Wi-Fi</p>
        <p class="hint">Create a room, then send the link to the other device. Pick the colour you want to play.</p>
        <div class="row">
          <button data-action="createRoom" data-value="w">Create as White</button>
          <button data-action="createRoom" data-value="b">Create as Black</button>
          <button data-action="createRoom" data-value="random">Random</button>
        </div>
        <p class="label">Or paste a room link</p>
        <input id="join-link" type="text" placeholder="https://…/room/abc123" />
        <div class="stack"><button data-action="joinLink">Join</button><button data-action="title">Back</button></div>
      </section>`;
  }

  joinChooser(state: RoomState | null): string {
    const taken = (c: 'w' | 'b') => (state?.seats[c] ? ' (taken)' : '');
    return `
      <section class="card">
        <h2>Join room</h2>
        <p class="hint">Pick a side. If it's taken, you'll get the other one.</p>
        <div class="row">
          <button data-action="joinRoom" data-value="w" ${state?.seats.w ? 'disabled' : ''}>White${taken('w')}</button>
          <button data-action="joinRoom" data-value="b" ${state?.seats.b ? 'disabled' : ''}>Black${taken('b')}</button>
          <button data-action="joinRoom" data-value="random">Random</button>
        </div>
        <button data-action="joinRoom" data-value="spectator">Watch only</button>
        <div class="stack"><button data-action="title">Leave</button></div>
      </section>`;
  }

  howTo(): string {
    return `
      <section class="card">
        <h2>How to play</h2>
        <ul class="steps">
          <li><b>Point</b> with your index finger (or move the mouse) to aim the glowing cursor.</li>
          <li><b>Make a fist</b> to pick up the piece under the cursor.</li>
          <li><b>Carry</b> it with your fist closed. Dots show legal squares.</li>
          <li><b>Open your hand</b> to drop it. Illegal moves slide back.</li>
          <li><b>Swipe</b> an open hand left or right on the review screen to change mistake.</li>
        </ul>
        <div class="stack">
          <button data-action="tutorial" class="primary">Practice (30-second tutorial)</button>
          <button data-action="title">Back</button>
        </div>
      </section>`;
  }

  settings(s: Settings): string {
    const check = (key: keyof Settings, label: string) =>
      `<label class="toggle"><input type="checkbox" data-setting="${key}" ${s[key] ? 'checked' : ''}/> ${label}</label>`;
    const range = (key: keyof Settings, label: string, min: number, max: number, step: number) =>
      `<label class="slider">${label}<input type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"/></label>`;
    return `
      <section class="card">
        <h2>Settings</h2>
        <p class="label">Input</p>
        <div class="row">
          <label class="radio"><input type="radio" name="input" data-setting="inputMode" value="hand" ${s.inputMode === 'hand' ? 'checked' : ''}/> Hand (webcam)</label>
          <label class="radio"><input type="radio" name="input" data-setting="inputMode" value="mouse" ${s.inputMode === 'mouse' ? 'checked' : ''}/> Mouse / touch</label>
        </div>
        ${range('gripSensitivity', 'Fist sensitivity', 0.6, 1.4, 0.05)}
        ${range('smoothing', 'Cursor smoothing', 0, 1, 0.05)}
        ${check('showPreview', 'Show webcam preview')}
        <p class="label">Sound & coach</p>
        ${check('sound', 'Sound effects')}
        ${check('voice', 'Read coach notes aloud')}
        ${check('flipBoard', 'Flip board for hot-seat play')}
        <p class="label">Board theme</p>
        <div class="row">
          ${(['classic', 'walnut', 'midnight'] as const).map((t) => `<label class="radio"><input type="radio" name="theme" data-setting="theme" value="${t}" ${s.theme === t ? 'checked' : ''}/> ${t}</label>`).join('')}
        </div>
        <p class="hint">Hand settings apply the next time you start a game.</p>
        <div class="stack"><button data-action="title">Back</button></div>
      </section>`;
  }

  pause(): string {
    return `
      <section class="card">
        <h2>Paused</h2>
        <div class="stack">
          <button data-action="resume" class="primary">Resume</button>
          <button data-action="leave">Leave game</button>
        </div>
      </section>`;
  }

  gameOver(result: GameResult, playerColor: Color | null, canReview: boolean, online: boolean): string {
    const who = result.winner === null ? 'Draw' : playerColor === null ? `${result.winner === 'w' ? 'White' : 'Black'} wins` : result.winner === playerColor ? 'You win!' : 'You lose';
    const why = { checkmate: 'by checkmate', stalemate: 'by stalemate', draw: 'by agreement or rule', resign: 'by resignation' }[result.reason];
    return `
      <section class="card">
        <h2>${who}</h2>
        <p class="hint">${result.winner === null ? 'The game is drawn' : `Won ${why}`}</p>
        <div class="stack">
          ${canReview ? '<button data-action="review" class="primary">Review my game</button>' : ''}
          ${online ? '<button data-action="leave" class="primary">Leave room</button>' : '<button data-action="newGame" class="primary">New game</button>'}
          <button data-action="title">Main menu</button>
        </div>
      </section>`;
  }

  reviewLoading(text: string): string {
    return `<section class="card"><h2>Analysing your game</h2><p class="hint" id="review-progress">${esc(text)}</p></section>`;
  }

  reviewProgress(text: string): void {
    const el = document.getElementById('review-progress');
    if (el) el.textContent = text;
  }

  reviewItem(item: ReviewItem, i: number, total: number, voice: boolean): string {
    return `
      <section class="card review" data-review-card>
        <div class="review-head">
          <span class="badge ${item.category}">${item.category}</span>
          <span>Move ${item.moveNumber}: <b>${esc(item.san)}</b></span>
          <span class="count">${i + 1} / ${total}</span>
        </div>
        <p class="explain">${esc(item.explanation)}</p>
        <p class="legend"><span class="red">■</span> your move &nbsp; <span class="green">■</span> better move${item.bestSan ? `: <b>${esc(item.bestSan)}</b>` : ''}</p>
        <div class="row">
          <button data-action="prevMove" ${i === 0 ? 'disabled' : ''}>← Prev</button>
          <button data-action="nextMove">${i === total - 1 ? 'Finish' : 'Next →'}</button>
        </div>
        ${voice ? '<p class="hint">Reading aloud…</p>' : ''}
        <p class="hint">Swipe left / right on the webcam, or use the arrow keys.</p>
      </section>`;
  }

  reviewSummary(report: ReviewReport): string {
    const note = report.source === 'offline' ? '<p class="hint">Coach server unreachable: notes come from the engine only.</p>' : '';
    return `
      <section class="card">
        <h2>Your accuracy: ${report.accuracy.toFixed(1)}%</h2>
        <p>${esc(report.summary)}</p>
        <p><b>Habit to work on:</b> ${esc(report.habit)}</p>
        ${note}
        <div class="stack">
          <button data-action="reviewAgain">Back to mistakes</button>
          <button data-action="title">Main menu</button>
        </div>
      </section>`;
  }

  /** The HUD: status bar, move list, captured pieces and buttons. */
  hud(opts: {
    modeLabel: string;
    status: string;
    online: boolean;
    link?: string;
    moves: string[];
    captured: { w: string[]; b: string[] };
    showPreviewToggle: boolean;
    previewOn: boolean;
    handStatus: string;
  }): string {
    const pairs: string[] = [];
    for (let i = 0; i < opts.moves.length; i += 2) {
      pairs.push(`<li><span class="num">${i / 2 + 1}.</span> ${esc(opts.moves[i])} ${opts.moves[i + 1] ? esc(opts.moves[i + 1]) : ''}</li>`);
    }
    const shareBox = opts.link
      ? `<div class="share"><span>Share:</span><code>${esc(opts.link)}</code><button data-action="copyLink">Copy</button></div>`
      : '';
    return `
      <div class="topbar">
        <span class="mode">${esc(opts.modeLabel)}</span>
        <span class="status">${esc(opts.status)}</span>
        <div class="actions">
          ${opts.showPreviewToggle ? `<button data-action="togglePreview">${opts.previewOn ? 'Hide cam' : 'Show cam'}</button>` : ''}
          <button data-action="pause">Pause</button>
          <button data-action="resign">Resign</button>
        </div>
      </div>
      ${shareBox}
      <aside class="side">
        <h3>Moves</h3>
        <ol class="moves">${pairs.join('') || '<li class="empty">No moves yet</li>'}</ol>
        <div class="captured">
          <div>White took: ${opts.captured.b.map((p) => `<span>${p}</span>`).join('') || '—'}</div>
          <div>Black took: ${opts.captured.w.map((p) => `<span>${p}</span>`).join('') || '—'}</div>
        </div>
        ${opts.handStatus ? `<p class="hint">${esc(opts.handStatus)}</p>` : ''}
      </aside>`;
  }

  /** Glyph for a captured piece, for the captured list. */
  glyph(color: Color, type: PieceSymbol): string {
    return PIECE_GLYPH[color][type];
  }

  roomStatus(state: RoomState | null, you: Color | 'spectator' | null, online: boolean): string {
    if (!online) return '';
    if (!state) return 'Connecting…';
    if (state.status === 'waiting') return 'Waiting for your opponent. Send them the link.';
    if (state.status === 'over') return 'Game over';
    const turn = state.turn === 'w' ? 'White' : 'Black';
    if (you === 'spectator') return `${turn} to move (watching)`;
    return state.turn === you ? 'Your move' : `${turn} to move`;
  }

  tutorialStep(text: string, step: number, total: number): string {
    return `<div class="tutorial-card"><span class="count">Step ${step} / ${total}</span><p>${esc(text)}</p><button data-action="skipTutorial">Skip</button></div>`;
  }
}
