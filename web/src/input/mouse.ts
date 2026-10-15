// Mouse and touch input. Pointer events are turned into the same InputEvents the
// hand tracker produces, so the game does not care which one is in use.
import type { BoardView } from '../scene/board';
import type { InputListener } from './types';

export class MouseInput {
  private onMove: (e: PointerEvent) => void;
  private onDown: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;
  private onContext: (e: Event) => void;
  private onKey: (e: KeyboardEvent) => void;

  constructor(
    private board: BoardView,
    private emit: InputListener,
  ) {
    const canvas = board.renderer.domElement;
    this.onMove = (e) => this.emit({ type: 'hover', pointer: board.pickClient(e.clientX, e.clientY) });
    this.onDown = (e) => {
      if (e.button !== 0) return; // left button or primary touch only
      this.emit({ type: 'grab', pointer: board.pickClient(e.clientX, e.clientY) });
    };
    this.onUp = (e) => {
      if (e.button !== 0) return;
      this.emit({ type: 'drop', pointer: board.pickClient(e.clientX, e.clientY) });
    };
    this.onContext = (e) => {
      e.preventDefault(); // right click cancels instead of opening the menu
      this.emit({ type: 'cancel' });
    };
    this.onKey = (e) => {
      if (e.key === 'Escape') this.emit({ type: 'cancel' });
    };
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('contextmenu', this.onContext);
    window.addEventListener('keydown', this.onKey);
  }

  stop(): void {
    const canvas = this.board.renderer.domElement;
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('keydown', this.onKey);
  }
}
