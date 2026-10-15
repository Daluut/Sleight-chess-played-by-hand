# Sleight — chess played by hand

*Sleight of hand, meets chess.* A 3D chess game in the browser that you play by moving pieces in the air with your hand through a webcam, against Stockfish. When the game ends, an AI coach walks you through your biggest mistakes in plain English. You can also play a friend on the same Wi-Fi, from a link.

> Project brief and build plan: [CLAUDE.md](CLAUDE.md).

## Run it (Windows PC)

You need **Node.js 20+** and **Python 3.11+**.

**1. Coach and multiplayer server** (terminal 1)

```bat
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
rem open .env and paste your ANTHROPIC_API_KEY (optional: without it the coach uses template notes)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**2. Web app** (terminal 2)

```bat
cd web
npm install
npm run dev
```

The terminal prints a line such as `https://192.168.1.23:5173`. That is your PC's address on the Wi-Fi.

**3. Laptop (with the webcam)**

Open the printed `https://…:5173` address and accept the self-signed certificate warning once. Allow camera access when asked. If you refuse, or there is no camera, the game falls back to the mouse.

## Playing

| Mode | How |
|---|---|
| vs Stockfish | Play → pick colour and opponent level → Start |
| Local two-player | Multiplayer → Local two-player (hot-seat, same device) |
| Online on your Wi-Fi | Multiplayer → Create as White / Black / Random → send the link → the other person opens it and takes the other colour |

Hand controls: point with your index finger, pinch to grab, release to drop, open palm (held still) to put a piece back, swipe on the review screen to change mistake. Mouse and touch work the same way (click or drag). Settings (sensitivity, smoothing, preview, themes) are in Settings.

## Tests

```bat
cd web && npm test          rem gesture engine and move classification
cd server && .venv\Scripts\activate && pytest    rem rooms, coach grounding, API
```

## How it works

- **Hand tracking:** MediaPipe `HandLandmarker` runs in the browser. A gesture engine turns landmarks into pinch (with hysteresis), palm-cancel and swipe events. The index fingertip is mapped to a board point by raycasting from the camera.
- **Opponent:** Stockfish 19 (WebAssembly) in a Web Worker, spoken to over UCI. Difficulty sets the skill level and think time.
- **Coach:** after the game, Stockfish evaluates every position. Each move's loss is measured in centipawns, moves are classified (inaccuracy, mistake, blunder), and accuracy is computed. The server sends the costliest moves to an LLM, which only explains what Stockfish found. Explanations are checked against python-chess before they are shown.
- **Multiplayer:** a FastAPI WebSocket relay. The server validates every move with python-chess, so a client cannot play an illegal move. Seat tokens let a refreshed page take its seat back.

## Layout

```
web/      Vite + TypeScript + Three.js front end
server/   FastAPI: coach endpoint, room relay, python-chess rules
CLAUDE.md project brief and phases
```
