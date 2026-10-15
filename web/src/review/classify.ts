// Pure maths for the post-game coach: evaluation loss, move categories, accuracy.
// Evaluations are in centipawns (100 cp = 1 pawn) from WHITE's point of view.

export type Category = 'good' | 'inaccuracy' | 'mistake' | 'blunder';

/** Score used for "mate in N": far bigger than any normal evaluation. */
export const MATE_CP = 10000;

export interface Score {
  type: 'cp' | 'mate';
  value: number;
}

/** Convert a UCI score (side-to-move point of view) to a white-POV number. */
export function toWhiteCp(score: Score, sideToMove: 'w' | 'b'): number {
  // A cp score is from the side to move's view. Mate scores are shrunk a little
  // per move so that a faster mate counts as better than a slower one.
  const raw =
    score.type === 'cp'
      ? score.value
      : (Math.sign(score.value) || -1) * (MATE_CP - Math.abs(score.value) * 10); // mate 0 = side to move is mated
  return sideToMove === 'w' ? raw : -raw;
}

/**
 * How much the mover lost, in centipawns (never negative).
 * before/after are white-POV evaluations of the position before and after the move.
 */
export function cpLoss(before: number, after: number, mover: 'w' | 'b'): number {
  const b = mover === 'w' ? before : -before;
  const a = mover === 'w' ? after : -after;
  return Math.max(0, b - a);
}

/** Standard cut-offs: 50 cp = inaccuracy, 100 = mistake, 200 = blunder. */
export function classify(loss: number): Category {
  if (loss >= 200) return 'blunder';
  if (loss >= 100) return 'mistake';
  if (loss >= 50) return 'inaccuracy';
  return 'good';
}

/**
 * Per-move accuracy from centipawn loss (0..100). This is a Lichess-style curve,
 * an approximation rather than the exact published formula.
 */
export function moveAccuracy(loss: number): number {
  const acc = 103.1668 * Math.exp(-0.04354 * loss) - 3.1669;
  return Math.min(100, Math.max(0, acc));
}

/** Overall accuracy for a list of losses: the average of per-move accuracies. */
export function gameAccuracy(losses: number[]): number {
  if (losses.length === 0) return 100;
  const sum = losses.reduce((total, loss) => total + moveAccuracy(loss), 0);
  return Math.round((sum / losses.length) * 10) / 10;
}

/** Pick the costliest moves to explain (most loss first, at least an inaccuracy). */
export function pickMistakes<T extends { cpLoss: number }>(moves: T[], max = 5): T[] {
  return moves
    .filter((m) => m.cpLoss >= 50)
    .sort((a, b) => b.cpLoss - a.cpLoss)
    .slice(0, max);
}
