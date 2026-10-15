// Runs Stockfish over every position of a game and works out how much each
// move cost. Evaluations are stored from White's point of view; they are
// flipped to the mover's point of view when judging a move.
import { Chess, type Color } from 'chess.js';
import { type Category, cpLoss, classify, gameAccuracy, moveAccuracy, toWhiteCp } from './classify';
import type { Evaluation } from '../game/engine';

export interface HistoryEntry {
  san: string;
  uci: string;
  color: Color;
  fenBefore: string;
  fenAfter: string;
}

export interface AnalyzedMove {
  index: number; // position in the game, 0-based (ply)
  moveNumber: number;
  color: Color;
  san: string;
  uci: string;
  fenBefore: string;
  cpBefore: number; // mover's point of view, before the move
  cpAfter: number; // mover's point of view, after the move
  cpLoss: number;
  category: Category;
  bestUci: string | null;
  accuracy: number;
}

export interface GameAnalysis {
  moves: AnalyzedMove[];
  accuracy: Record<Color, number>;
}

export async function analyzeGame(
  history: HistoryEntry[],
  evaluate: (fen: string, depth: number) => Promise<Evaluation>,
  depth: number,
  onProgress: (done: number, total: number) => void,
): Promise<GameAnalysis> {
  // One evaluation per position: the start, plus the position after each move.
  const fens = [history[0]?.fenBefore ?? new Chess().fen(), ...history.map((h) => h.fenAfter)];
  const evals: { cpWhite: number; best: string | null }[] = [];

  for (let i = 0; i < fens.length; i++) {
    const fen = fens[i];
    const game = new Chess(fen);
    if (game.isGameOver()) {
      // Stockfish has nothing to search in a finished game, so score it directly.
      const cp = game.isCheckmate() ? toWhiteCp({ type: 'mate', value: 0 }, game.turn()) : 0;
      evals.push({ cpWhite: cp, best: null });
    } else {
      const ev = await evaluate(fen, depth);
      evals.push({ cpWhite: toWhiteCp(ev.score, game.turn()), best: ev.best });
    }
    onProgress(i + 1, fens.length);
  }

  const moves: AnalyzedMove[] = history.map((h, i) => {
    const loss = cpLoss(evals[i].cpWhite, evals[i + 1].cpWhite, h.color);
    const sign = h.color === 'w' ? 1 : -1;
    return {
      index: i,
      moveNumber: Math.floor(i / 2) + 1,
      color: h.color,
      san: h.san,
      uci: h.uci,
      fenBefore: h.fenBefore,
      cpBefore: sign * evals[i].cpWhite,
      cpAfter: sign * evals[i + 1].cpWhite,
      cpLoss: loss,
      category: classify(loss),
      bestUci: evals[i].best,
      accuracy: moveAccuracy(loss),
    };
  });

  const accuracy = {
    w: gameAccuracy(moves.filter((m) => m.color === 'w').map((m) => m.cpLoss)),
    b: gameAccuracy(moves.filter((m) => m.color === 'b').map((m) => m.cpLoss)),
  };
  return { moves, accuracy };
}
