// The one interface every input method speaks. Game logic only ever sees these
// events, so mouse, touch and hand tracking are interchangeable.
import type { Vector3 } from 'three';
import type { Square } from 'chess.js';

/** What the pointer (mouse or fingertip) is over right now. */
export interface Pointer {
  /** The square under the pointer, or null if it is off the board. */
  square: Square | null;
  /** The 3D point on the board plane under the pointer, or null. */
  point: Vector3 | null;
}

export type InputEvent =
  | { type: 'hover'; pointer: Pointer }
  | { type: 'grab'; pointer: Pointer }
  | { type: 'drop'; pointer: Pointer }
  | { type: 'cancel' }
  | { type: 'swipe'; dir: 'left' | 'right' };

export type InputListener = (event: InputEvent) => void;
