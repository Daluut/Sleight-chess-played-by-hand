import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURE_OPTIONS, GestureEngine, type Landmark, openness } from './gesture';

// Builds 21 landmarks for a hand centred at (0.5, 0.5). The wrist is 0.3 below
// the middle knuckle (hand size 0.3), and the four fingertips sit `tipDist`
// above the wrist. Small tipDist = fingers curled (fist); large = open hand.
function hand(tipDist: number, cx = 0.5, cy = 0.5): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.3 }; // wrist
  lm[9] = { x: cx, y: cy }; // middle knuckle
  for (const tip of [8, 12, 16, 20]) lm[tip] = { x: cx, y: cy + 0.3 - tipDist };
  return lm;
}

const FIST = 0.1; // openness 0.33
const MIDDLE = 0.39; // openness 1.3: between the two thresholds
const OPEN = 0.55; // openness 1.83

describe('openness', () => {
  it('does not depend on how far the hand is from the camera', () => {
    const near = hand(OPEN);
    const far = hand(OPEN).map((p) => ({ x: 0.5 + (p.x - 0.5) / 2, y: 0.5 + (p.y - 0.5) / 2 }));
    expect(openness(far)).toBeCloseTo(openness(near), 2);
  });
});

describe('GestureEngine grip', () => {
  it('starts a grip when the hand closes into a fist', () => {
    const g = new GestureEngine();
    expect(g.update(hand(OPEN), 0)).toEqual([]);
    expect(g.update(hand(FIST), 16)).toEqual([{ type: 'gripStart' }]);
    expect(g.isGripping).toBe(true);
  });

  it('ends the grip when the hand opens again', () => {
    const g = new GestureEngine();
    g.update(hand(FIST), 0);
    expect(g.update(hand(OPEN), 16)).toEqual([{ type: 'gripEnd' }]);
    expect(g.isGripping).toBe(false);
  });

  it('uses hysteresis: a half-open hand does not toggle the state', () => {
    const g = new GestureEngine();
    g.update(hand(FIST), 0); // gripping
    expect(g.update(hand(MIDDLE), 16)).toEqual([]);
    expect(g.isGripping).toBe(true);

    const h = new GestureEngine();
    expect(h.update(hand(MIDDLE), 0)).toEqual([]); // never closed: stays open
    expect(h.isGripping).toBe(false);
  });

  it('higher grip sensitivity makes a looser fist count', () => {
    const loose = new GestureEngine({ ...DEFAULT_GESTURE_OPTIONS, gripSensitivity: 1.3 });
    expect(loose.update(hand(MIDDLE), 0)).toEqual([{ type: 'gripStart' }]); // openness 1.3 < 1.1 * 1.3
  });
});

describe('GestureEngine hand loss', () => {
  it('keeps the grip through a short dropout', () => {
    const g = new GestureEngine();
    g.update(hand(FIST), 0);
    expect(g.update(null, 100)).toEqual([]);
    expect(g.isGripping).toBe(true);
  });

  it('releases the grip after the grace period', () => {
    const g = new GestureEngine();
    g.update(hand(FIST), 0);
    expect(g.update(null, 400)).toEqual([{ type: 'gripEnd' }, { type: 'handLost' }]);
    expect(g.isGripping).toBe(false);
  });
});
