import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURE_OPTIONS, GestureEngine, type Landmark, pinchRatio } from './gesture';

// Builds 21 landmarks for an upright open hand centred at (0.5, 0.5).
// `thumbGap` sets the thumb-to-index distance; the hand size is 0.3.
function hand(thumbGap: number, cx = 0.5, cy = 0.5): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy }));
  lm[0] = { x: cx, y: cy + 0.3 }; // wrist
  lm[9] = { x: cx, y: cy }; // middle knuckle
  for (const tip of [8, 12, 16, 20]) lm[tip] = { x: cx, y: cy - 0.25 };
  lm[4] = { x: cx + thumbGap, y: cy - 0.25 }; // thumb tip, `thumbGap` away from index tip
  return lm;
}

describe('pinchRatio', () => {
  it('is independent of how far the hand is from the camera', () => {
    const near = hand(0.06);
    const far = hand(0.06).map((p) => ({ x: 0.5 + (p.x - 0.5) / 2, y: 0.5 + (p.y - 0.5) / 2 }));
    expect(pinchRatio(far)).toBeCloseTo(pinchRatio(near), 2);
  });
});

describe('GestureEngine pinch', () => {
  it('starts a pinch when fingers come together', () => {
    const g = new GestureEngine();
    expect(g.update(hand(0.06), 0)).toEqual([{ type: 'pinchStart' }]);
    expect(g.isPinching).toBe(true);
  });

  it('uses hysteresis: a ratio between the two thresholds does not toggle state', () => {
    const g = new GestureEngine();
    g.update(hand(0.06), 0); // start pinch (ratio 0.2)
    // Ratio 0.4 is between PINCH_START (0.3) and PINCH_END (0.5): still pinching.
    expect(g.update(hand(0.12), 16)).toEqual([]);
    expect(g.isPinching).toBe(true);
    // Ratio 0.67 is above PINCH_END: pinch ends.
    expect(g.update(hand(0.2), 32)).toEqual([{ type: 'pinchEnd' }]);
  });

  it('does not start a pinch at a ratio in the dead zone', () => {
    const g = new GestureEngine();
    expect(g.update(hand(0.12), 0)).toEqual([]);
    expect(g.isPinching).toBe(false);
  });

  it('higher sensitivity makes the pinch trigger at a wider gap', () => {
    const easy = new GestureEngine({ ...DEFAULT_GESTURE_OPTIONS, pinchSensitivity: 1.5 });
    expect(easy.update(hand(0.12), 0)).toEqual([{ type: 'pinchStart' }]); // ratio 0.4 < 0.3 * 1.5
  });
});

describe('GestureEngine hand loss', () => {
  it('keeps the pinch through a short dropout', () => {
    const g = new GestureEngine();
    g.update(hand(0.06), 0);
    expect(g.update(null, 100)).toEqual([]);
    expect(g.isPinching).toBe(true);
  });

  it('releases the pinch after the grace period', () => {
    const g = new GestureEngine();
    g.update(hand(0.06), 0);
    expect(g.update(null, 400)).toEqual([{ type: 'pinchEnd' }, { type: 'handLost' }]);
    expect(g.isPinching).toBe(false);
  });
});

describe('GestureEngine open palm', () => {
  it('cancels after the palm is held still', () => {
    const g = new GestureEngine();
    const open = hand(0.3); // thumb far away: no pinch
    expect(g.update(open, 0)).toEqual([]);
    expect(g.update(open, 600)).toEqual([]);
    expect(g.update(open, 1100)).toEqual([{ type: 'palmCancel' }]);
    // It only fires once until the palm moves or leaves the frame.
    expect(g.update(open, 1500)).toEqual([]);
  });
});
