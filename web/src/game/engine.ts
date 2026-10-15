// Stockfish in a Web Worker, spoken to over UCI (the plain-text protocol chess
// engines use). Commands go out as strings and replies come back as lines.
// Only one command runs at a time: a promise queue keeps the replies in order.
import type { Score } from '../review/classify';
import type { Level } from './levels';

export interface Evaluation {
  score: Score;
  best: string | null; // UCI move, e.g. "e2e4"
}

export class StockfishEngine {
  private worker: Worker;
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  private ready: Promise<void>;

  constructor() {
    this.worker = new Worker('/engine/stockfish-19-lite-single.js');
    this.worker.onmessage = (e: MessageEvent) => {
      this.listener?.(String(e.data));
    };
    this.ready = this.run(async () => {
      await this.expect('uciok', 'uci');
      await this.expect('readyok', 'isready');
      this.send('setoption name Threads value 1'); // single thread: no special browser headers needed
      this.send('setoption name Hash value 32');
    });
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  /** Send a command and resolve on the first reply line that starts with `token`. */
  private expect(token: string, cmd: string): Promise<void> {
    return new Promise((resolve) => {
      this.listener = (line) => {
        if (line.startsWith(token)) {
          this.listener = null;
          resolve();
        }
      };
      this.send(cmd);
    });
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined); // a failed task must not block the queue
    return result;
  }

  /** The engine's move for the given level (what it plays against you). */
  bestMove(fen: string, level: Level): Promise<string | null> {
    return this.run(async () => {
      await this.ready;
      this.send(`setoption name Skill Level value ${level.skill}`);
      this.send(`position fen ${fen}`);
      return new Promise<string | null>((resolve) => {
        this.listener = (line) => {
          if (line.startsWith('bestmove')) {
            this.listener = null;
            const move = line.split(' ')[1];
            resolve(move && move !== '(none)' ? move : null);
          }
        };
        this.send(`go movetime ${level.moveTimeMs}`);
      });
    });
  }

  /** Full-strength evaluation at a fixed depth, used by the post-game coach. */
  analyze(fen: string, depth: number): Promise<Evaluation> {
    return this.run(async () => {
      await this.ready;
      this.send('setoption name Skill Level value 20');
      this.send(`position fen ${fen}`);
      let score: Score = { type: 'cp', value: 0 };
      let bestDepth = -1;
      return new Promise<Evaluation>((resolve) => {
        this.listener = (line) => {
          if (line.startsWith('info ')) {
            // Keep the score from the deepest search seen so far.
            const d = /\bdepth (\d+)/.exec(line);
            const s = /\bscore (cp|mate) (-?\d+)/.exec(line);
            if (d && s && Number(d[1]) >= bestDepth) {
              bestDepth = Number(d[1]);
              score = { type: s[1] as 'cp' | 'mate', value: Number(s[2]) };
            }
          } else if (line.startsWith('bestmove')) {
            this.listener = null;
            const move = line.split(' ')[1];
            resolve({ score, best: move && move !== '(none)' ? move : null });
          }
        };
        this.send(`go depth ${depth}`);
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
  }
}
