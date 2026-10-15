// GestureEngine: turns raw hand landmarks (21 points per hand from MediaPipe)
// into discrete events: grip start/end (fist closes / hand opens) and swipes.
//
// Landmark numbers used (MediaPipe hand model):
//   0 = wrist, 8 = index tip, 9 = middle-finger knuckle, 12 = middle tip,
//   16 = ring tip, 20 = pinky tip.
// Coordinates are normalised to the camera image (0..1).

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export type GestureEvent =
  | { type: 'gripStart' } // hand closed into a fist: pick up
  | { type: 'gripEnd' } // hand opened again: drop
  | { type: 'swipe'; dir: 'left' | 'right' }
  | { type: 'handLost' };

export interface GestureOptions {
  /** From settings: 0.6..1.4. Higher = a looser fist is enough to grab. */
  gripSensitivity: number;
  /** How long a dropped hand is tolerated before the grip is released. */
  lostGraceMs: number;
  /** Minimum horizontal travel (fraction of image width) for a swipe. */
  swipeDistance: number;
}

export const DEFAULT_GESTURE_OPTIONS: GestureOptions = {
  gripSensitivity: 1,
  lostGraceMs: 250,
  swipeDistance: 0.25,
};

// Openness = average fingertip-to-wrist distance divided by hand size.
// A fist curls the fingertips in close to the palm (about 0.3 to 0.8 here);
// an open hand stretches them out (about 1.8 to 2.4).
// Two thresholds (hysteresis): the grip starts when openness drops below
// CLOSE and ends only when it rises above CLOSE + GAP. The gap stops the
// state flickering when your hand sits near one value.
const FIST_CLOSE = 1.1;
const FIST_GAP = 0.4;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Hand size, used to normalise distances so they work at any camera distance. */
export function handSize(lm: Landmark[]): number {
  return dist(lm[0], lm[9]); // wrist to middle-finger knuckle
}

/** How spread out the fingers are. Small = fist, large = open hand. */
export function openness(lm: Landmark[]): number {
  const size = Math.max(handSize(lm), 1e-6);
  const tips = [8, 12, 16, 20];
  const total = tips.reduce((sum, tip) => sum + dist(lm[tip], lm[0]), 0);
  return total / tips.length / size;
}

export class GestureEngine {
  private gripping = false;
  private lastSeen = 0;
  private palmTrail: { t: number; x: number }[] = [];

  constructor(private opts: GestureOptions = DEFAULT_GESTURE_OPTIONS) {}

  get isGripping(): boolean {
    return this.gripping;
  }

  /** Call once per camera frame. `lm` is null when no hand is visible. */
  update(lm: Landmark[] | null, t: number): GestureEvent[] {
    const events: GestureEvent[] = [];

    if (!lm) {
      // Hand lost: keep the grip for a short grace period so a brief
      // tracking dropout does not drop the piece.
      if (this.gripping && t - this.lastSeen > this.opts.lostGraceMs) {
        this.gripping = false;
        events.push({ type: 'gripEnd' }, { type: 'handLost' });
      }
      this.palmTrail = [];
      return events;
    }
    this.lastSeen = t;

    // Fist with hysteresis. Sensitivity moves the closing threshold.
    const close = FIST_CLOSE * this.opts.gripSensitivity;
    const value = openness(lm);
    if (!this.gripping && value < close) {
      this.gripping = true;
      events.push({ type: 'gripStart' });
    } else if (this.gripping && value > close + FIST_GAP) {
      this.gripping = false;
      events.push({ type: 'gripEnd' });
    }

    // Swipe: a sideways flick of an open hand, seen over the last ~400 ms.
    if (!this.gripping && value > close + FIST_GAP) {
      this.palmTrail.push({ t, x: lm[9].x });
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
    } else {
      this.palmTrail = [];
    }

    return events;
  }
}
