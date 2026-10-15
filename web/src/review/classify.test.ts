import { describe, expect, it } from 'vitest';
import { classify, cpLoss, gameAccuracy, pickMistakes, toWhiteCp } from './classify';

describe('classify', () => {
  it('buckets evaluation loss into categories', () => {
    expect(classify(10)).toBe('good');
    expect(classify(50)).toBe('inaccuracy');
    expect(classify(120)).toBe('mistake');
    expect(classify(250)).toBe('blunder');
  });
});

describe('cpLoss', () => {
  it('measures loss from the mover point of view', () => {
    // White was +1.00, after a white move it is +0.20: white lost 80 cp.
    expect(cpLoss(100, 20, 'w')).toBe(80);
    // Black at white +1.00 (black is -1.00); after the move white is +0.20 (black -0.20): black lost 80.
    expect(cpLoss(100, 20, 'b')).toBe(0);
    expect(cpLoss(-100, -20, 'b')).toBe(80);
  });

  it('never returns a negative loss', () => {
    expect(cpLoss(0, 300, 'w')).toBe(0);
  });
});

describe('toWhiteCp', () => {
  it('flips the sign when black is to move', () => {
    expect(toWhiteCp({ type: 'cp', value: 50 }, 'w')).toBe(50);
    expect(toWhiteCp({ type: 'cp', value: 50 }, 'b')).toBe(-50);
  });

  it('treats mate as a very large score, faster mates scoring higher', () => {
    const fast = toWhiteCp({ type: 'mate', value: 2 }, 'w');
    const slow = toWhiteCp({ type: 'mate', value: 8 }, 'w');
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(5000);
    expect(toWhiteCp({ type: 'mate', value: -3 }, 'w')).toBeLessThan(-5000);
  });
});

describe('gameAccuracy', () => {
  it('is 100 with no losses and drops as losses grow', () => {
    expect(gameAccuracy([])).toBe(100);
    expect(gameAccuracy([0, 0, 0])).toBeCloseTo(100, 0);
    expect(gameAccuracy([300, 300])).toBeLessThan(gameAccuracy([10, 10]));
  });
});

describe('pickMistakes', () => {
  it('returns the costliest moves first and skips small losses', () => {
    const moves = [{ id: 1, cpLoss: 10 }, { id: 2, cpLoss: 300 }, { id: 3, cpLoss: 120 }];
    expect(pickMistakes(moves).map((m) => m.id)).toEqual([2, 3]);
  });
});
