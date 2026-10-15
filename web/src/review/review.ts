// Post-game review: asks the server's coach for explanations, and falls back to
// plain template sentences if the server cannot be reached. Either way the text
// is built only from Stockfish's numbers, never from invented analysis.
import { Chess, type Color } from 'chess.js';
import { pickMistakes, type Category } from './classify';
import type { AnalyzedMove, GameAnalysis, HistoryEntry } from './analyze';

export interface ReviewItem {
  index: number;
  moveNumber: number;
  san: string;
  playedUci: string;
  bestUci: string | null;
  bestSan: string | null;
  fenBefore: string;
  cpLoss: number;
  category: Category;
  explanation: string;
}

export interface ReviewReport {
  items: ReviewItem[];
  summary: string;
  habit: string;
  accuracy: number;
  source: 'llm' | 'template' | 'offline';
}

/** The text of a best move, e.g. "Nf3", computed by chess.js from the position. */
export function sanOf(fen: string, uci: string | null): string | null {
  if (!uci) return null;
  try {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m.san;
  } catch {
    return null;
  }
}

export function templateExplanation(item: Pick<ReviewItem, 'san' | 'cpLoss' | 'bestSan' | 'category'>): string {
  const pawns = (item.cpLoss / 100).toFixed(1);
  const better = item.bestSan ? `${item.bestSan} was the stronger choice.` : 'There was a stronger option.';
  return `You played ${item.san}, which lost about ${pawns} pawns of advantage (${item.category}). ${better}`;
}

export function toPgn(history: HistoryEntry[]): string {
  return history
    .map((h, i) => (i % 2 === 0 ? `${Math.floor(i / 2) + 1}. ${h.san}` : h.san))
    .join(' ');
}

export async function buildReview(
  analysis: GameAnalysis,
  history: HistoryEntry[],
  playerColor: Color,
  result: string,
): Promise<ReviewReport> {
  const mine = analysis.moves.filter((m) => m.color === playerColor);
  const picked = pickMistakes(mine, 5);
  const items: ReviewItem[] = picked.map((m: AnalyzedMove) => {
    const bestSan = sanOf(m.fenBefore, m.bestUci);
    return {
      index: m.index,
      moveNumber: m.moveNumber,
      san: m.san,
      playedUci: m.uci,
      bestUci: m.bestUci,
      bestSan,
      fenBefore: m.fenBefore,
      cpLoss: m.cpLoss,
      category: m.category,
      explanation: templateExplanation({ san: m.san, cpLoss: m.cpLoss, bestSan, category: m.category }),
    };
  });
  const accuracy = analysis.accuracy[playerColor];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        playerColor,
        result,
        accuracy,
        pgn: toPgn(history),
        mistakes: items.map((i) => ({
          index: i.index,
          moveNumber: i.moveNumber,
          san: i.san,
          playedUci: i.playedUci,
          fenBefore: i.fenBefore,
          cpLoss: i.cpLoss,
          category: i.category,
          bestUci: i.bestUci,
        })),
      }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`review ${res.status}`);
    const data = (await res.json()) as {
      source: 'llm' | 'template';
      summary: string;
      habit: string;
      explanations: { index: number; text: string }[];
    };
    const byIndex = new Map(data.explanations.map((e) => [e.index, e.text]));
    for (const item of items) item.explanation = byIndex.get(item.index) ?? item.explanation;
    return { items, summary: data.summary, habit: data.habit, accuracy, source: data.source };
  } catch {
    return {
      items,
      accuracy,
      source: 'offline',
      summary: `Your accuracy was ${accuracy.toFixed(1)}%. The coach server is not reachable, so these notes come straight from the engine.`,
      habit: 'Before each move, ask what your opponent can do next.',
    };
  }
}
