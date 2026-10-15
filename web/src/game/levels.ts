// Named difficulty levels mapped to Stockfish's skill level (0-20) and think time.
export interface Level {
  id: string;
  name: string;
  blurb: string;
  skill: number;
  moveTimeMs: number;
}

export const LEVELS: Level[] = [
  { id: 'pawn', name: 'Pawn', blurb: 'Beginner', skill: 1, moveTimeMs: 200 },
  { id: 'knight', name: 'Knight', blurb: 'Casual', skill: 5, moveTimeMs: 400 },
  { id: 'bishop', name: 'Bishop', blurb: 'Club player', skill: 10, moveTimeMs: 700 },
  { id: 'rook', name: 'Rook', blurb: 'Strong', skill: 15, moveTimeMs: 1000 },
  { id: 'queen', name: 'Queen', blurb: 'Strongest', skill: 20, moveTimeMs: 1500 },
];
