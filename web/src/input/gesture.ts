// GestureEngine: turns raw hand landmarks (21 points per hand from MediaPipe)
// into discrete events: pinch start/end, open-palm cancel, and swipes.
//
// Landmark numbers used (MediaPipe hand model):
//   0 = wrist, 4 = thumb tip, 8 = index tip, 9 = middle-finger knuckle,
//   12 = middle tip, 16 = ring tip, 20 = pinky tip.
// Coordinates are normalised to the camera image (0..1).

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export type GestureEvent =
  | { type: 'pinchStart' }
  | { type: 'pinchEnd' }
  | { type: 'palmCancel' }
  | { type: 'swipe'; dir: 'left' | 'right' }
  | { type: 'handLost' };

export interface GestureOptions {
  /** From settings: 0.5..1.5. Higher = pinch triggers more easily. */
  pinchSensitivity: number;
  /** How long an open palm must stay still before it cancels. */
  palmHoldMs: number;
  /** How long a dropped hand is tolerated before the pinch is released. */
  lostGraceMs: number;
  /** Minimum horizontal travel (fraction of image width) for a swipe. */
  swipeDistance: number;
}

export const DEFAULT_GESTURE_OPTIONS: GestureOptions = {
  pinchSensitivity: 1,
  palmHoldMs: 1000,
  lostGraceMs: 250,
  swipeDistance: 0.25,
};

// Pinch thresholds are a ratio of thumb-to-index distance over hand size.
// Two thresholds (hysteresis): the pinch starts when the ratio drops below
// START and ends only when it rises above END. The gap stops flicker when
// the fingers hover near one fixed value.
const PINCH_START = 0.3;
const PINCH_END = 0.5;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Hand size, used to normalise distances so they work at any camera distance. */
export function handSize(lm: Landmark[]): number {
  return dist(lm[0], lm[9]); // wrist to middle-finger knuckle
}

/** Thumb-to-index distance divided by hand size. Small = pinched. */
export function pinchRatio(lm: Landmark[]): number {
  return dist(lm[4], lm[8]) / Math.max(handSize(lm), 1e-6);
}

/** True when index, middle, ring and pinky are all clearly extended. */
export function isOpenPalm(lm: Landmark[]): boolean {
  const size = Math.max(handSize(lm), 1e-6);
  return [8, 12, 16, 20].every((tip) => dist(lm[tip], lm[0]) / size > 1.5);
}

export class GestureEngine {
  private pinching = false;
  private lastSeen = 0;
  private palmAnchor: { x: number; y: number } | null = null;
  private palmSince = 0;
  private palmFired = false;
  private palmTrail: { t: number; x: number }[] = [];

  constructor(private opts: GestureOptions = DEFAULT_GESTURE_OPTIONS) {}

  get isPinching(): boolean {
    return this.pinching;
  }

  /** Call once per camera frame. `lm` is null when no hand is visible. */
  update(lm: Landmark[] | null, t: number): GestureEvent[] {
    const events: GestureEvent[] = [];

    if (!lm) {
      // Hand lost: keep the current state for a short grace period so a
      // brief tracking dropout does not drop the piece.
      if (this.pinching && t - this.lastSeen > this.opts.lostGraceMs) {
        this.pinching = false;
        events.push({ type: 'pinchEnd' }, { type: 'handLost' });
      }
      this.palmAnchor = null;
      this.palmTrail = [];
      return events;
    }
    this.lastSeen = t;

    // Pinch with hysteresis. Sensitivity scales both thresholds.
    const s = this.opts.pinchSensitivity;
    const ratio = pinchRatio(lm);
    if (!this.pinching && ratio < PINCH_START * s) {
      this.pinching = true;
      events.push({ type: 'pinchStart' });
    } else if (this.pinching && ratio > PINCH_END * s) {
      this.pinching = false;
      events.push({ type: 'pinchEnd' });
    }

    // Open palm: cancel when held still, swipe when moved sideways.
    if (isOpenPalm(lm)) {
      const cx = lm[9].x;
      const cy = lm[9].y;
      // Trail for swipe detection: keep the last ~400 ms.
      this.palmTrail.push({ t, x: cx });
      this.palmTrail = this.palmTrail.filter((p) => t - p.t <= 400);
      if (this.palmTrail.length > 1) {
        const dx = this.palmTrail[this.palmTrail.length - 1].x - this.palmTrail[0].x;
        if (Math.abs(dx) > this.opts.swipeDistance) {
          // The image is mirrored on screen, so moving the hand right means
          // image x decreases. Report the direction the hand moved on screen.
          events.push({ type: 'swipe', dir: dx < 0 ? 'right' : 'left' });
          this.palmTrail = [];
        }
      }

      // Stillness check for the cancel gesture.
      if (!this.palmAnchor || Math.hypot(cx - this.palmAnchor.x, cy - this.palmAnchor.y) > 0.03) {
        this.palmAnchor = { x: cx, y: cy };
        this.palmSince = t;
        this.palmFired = false;
      } else if (!this.palmFired && t - this.palmSince >= this.opts.palmHoldMs) {
        this.palmFired = true;
        events.push({ type: 'palmCancel' });
      }
    } else {
      this.palmAnchor = null;
      this.palmFired = false;
      this.palmTrail = [];
    }

    return events;
  }
}
