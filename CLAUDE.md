# Sleight — chess played by hand

*Sleight of hand, meets chess.* A 3D chess game in the browser that you play by moving pieces in the air with your hand through a webcam, against Stockfish. When the game ends, an AI coach walks you through your biggest mistakes in plain English.

This file is the project brief. Read it fully before making changes, and keep it updated if the plan changes.

---

## How we work (important)

This is a portfolio project for the developer's CV and GitHub. They must understand every part of it. After each feature, give a short plain-English explanation of what changed and why.

Build in small steps and commit after each working step, with clear messages (e.g. `Add pinch detection`, `Smooth cursor jitter`). Never one giant commit. **Ask before committing.**

Development happens on the PC; testing happens on a laptop (which has the webcam) over the same Wi-Fi. After each step, tell the developer exactly what to test on the laptop and what they should see.

Never commit secrets. The LLM API key lives in `server/.env`, which is in `.gitignore`. Provide `server/.env.example`.

Prefer simple, readable code over clever code. Add comments where the logic is non-obvious (gesture detection, coordinate mapping, evaluation maths).

---

## Tech stack

| Part | Choice |
|---|---|
| Front end | TypeScript + Vite |
| 3D | Three.js |
| Chess rules | chess.js |
| Opponent + analysis | Stockfish (WebAssembly build, run in a Web Worker) |
| Hand tracking | MediaPipe Tasks Vision — `HandLandmarker` (runs in the browser) |
| AI coach backend | Python + FastAPI |
| Coach LLM | An LLM API (e.g. Claude API), key in `server/.env` |
| Multiplayer relay | FastAPI WebSocket endpoint + `python-chess` for server-side move validation (see Multiplayer) |
| Voice (optional) | Browser Web Speech API (`speechSynthesis`) |
| Deployment (later) | Front end on Vercel/Netlify; backend on Render/Fly.io |

### Local network + HTTPS (required for the webcam)

Browsers only allow camera access on HTTPS or `localhost`. The laptop opens the PC's dev server over Wi-Fi, so:

- Vite runs with `server.host = true` and HTTPS via `@vitejs/plugin-basic-ssl`.
- Laptop opens `https://<PC-LAN-IP>:5173` and accepts the self-signed certificate warning once.
- Vite proxies `/api` → the FastAPI server on the PC (`http://localhost:8000`), so the laptop never needs a second certificate. WebSocket traffic under `/api` is proxied too (`ws: true`).
- On first run, print the PC's LAN IP clearly in the terminal so the developer knows what to type on the laptop.

---

## Architecture

```
Laptop browser                                   PC
┌──────────────────────────────────────────┐   ┌────────────────────┐
│ Webcam → HandLandmarker → GestureEngine  │   │ FastAPI coach      │
│                     ↓                    │   │  POST /api/review  │
│ InputController (hand OR mouse/touch)    │   │   → LLM API        │
│                     ↓                    │   └─────────▲──────────┘
│ GameController (chess.js) ↔ Stockfish    │             │
│                     ↓                    │  game PGN + │
│ Three.js scene (board, pieces, cursor)   │  analysis ──┘
│ UI layer (menus, HUD, review screen)     │
│                     ↕ WebSocket          │   ┌────────────────────┐
│ (online multiplayer only)                │◄──┤ FastAPI room relay │
└──────────────────────────────────────────┘   │  /api/ws/{room}    │
                                               └────────────────────┘
```

Suggested folder layout:

```
sleight/
├── CLAUDE.md
├── README.md
├── web/                     # Vite + TS front end
│   ├── src/
│   │   ├── main.ts
│   │   ├── scene/           # Three.js: board, pieces (LatheGeometry), lighting, camera, animations
│   │   ├── game/            # GameController, chess.js wrapper, Stockfish worker wrapper
│   │   ├── input/           # InputController, MouseInput, HandInput, GestureEngine, smoothing
│   │   ├── net/             # multiplayer room client (WebSocket)
│   │   ├── review/          # post-game analysis + review screen logic
│   │   ├── ui/              # menus, HUD, settings, tutorial (plain HTML/CSS overlays)
│   │   └── settings.ts      # persisted to localStorage
│   └── public/
└── server/                  # FastAPI coach + multiplayer relay
    ├── main.py
    ├── coach.py
    ├── rooms.py             # multiplayer rooms (seats, move list, validation)
    ├── requirements.txt
    └── .env.example
```

---

## Features

### 1. Menus and screens

- **Title screen:** "Sleight" logo, a slowly rotating 3D board in the background. Buttons: Play, Multiplayer, How to play, Settings.
- **New game setup (vs computer):** choose colour (white / black / random) and difficulty — named levels, not numbers: Pawn (beginner), Knight, Bishop, Rook, Queen (strongest). Map to Stockfish skill level + think time.
- **Input mode:** Hand or Mouse/Touch. If no camera is found or permission is denied, fall back to mouse automatically and show a friendly message.
- **Settings:** input mode, pinch sensitivity, cursor smoothing, show/hide webcam preview, sound on/off, voice for the coach on/off, board theme (2–3 colour themes).
- **In-game HUD:** whose turn, move list, captured pieces, small webcam preview with hand landmarks drawn on it (toggleable), buttons for Resign and Pause.
- **Game over screen:** result (checkmate / stalemate / resignation), then Review my game and New game. (Multiplayer games: no computer review; show result and Rematch / Leave.)
- **Tutorial (first launch, and from "How to play"):** 30-second guided steps — point at a glowing square → pinch → carry → release. Each step completes only when the gesture is detected.

### 2. 3D board

- Pieces built procedurally with `THREE.LatheGeometry` from 2D profiles (no external models). Knight needs a simple custom shape (extruded silhouette is fine).
- Soft lighting with shadows; orbit-able camera with sensible limits; camera positioned from the player's side.
- Animations: picked-up piece lifts and follows the cursor; dropped piece settles; opponent moves glide; captured pieces fade and move to the side.
- Highlights: hovered square, grabbable pieces glow, legal destination dots while holding, last move highlighted, check highlighted in red.

### 3. Hand controls

Index fingertip (landmark 8) drives a glowing ring cursor projected onto the board (raycast from the camera through the mapped screen point).

| Gesture | Action |
|---|---|
| Point (index finger) | Move the cursor |
| Make a fist (fingertips curled in) | Grab the piece under the cursor |
| Move while pinching | Carry the piece |
| Open your hand | Drop on the highlighted square (illegal → slides back) |
| Swipe left / right | Previous / next mistake on the review screen |

Implementation notes:
- Normalise pinch distance by hand size (e.g. wrist-to-middle-knuckle distance) so it works at any distance from the camera.
- Use hysteresis for the fist (different thresholds to start and end a grip) to avoid flicker. Fist = average fingertip-to-wrist distance over hand size.
- Smooth the cursor (One Euro filter or exponential smoothing — make it configurable).
- Mirror the webcam horizontally so moving your hand right moves the cursor right.
- If the hand is lost for a few frames, hold the last state briefly rather than dropping the piece.
- Mouse/touch input must use the same `InputController` interface, so the game logic doesn't care which input is used.

### 4. Opponent

- Stockfish in a Web Worker, communicating over UCI.
- Difficulty levels set skill level and move time.
- Small delay before the engine's move animates, so it feels natural.

### 5. Post-game coach (no comments during the game)

After the game ends:

1. Stockfish analyses every position of the player's moves (fixed depth), recording the evaluation before and after each move and the best move.
2. Classify moves by evaluation loss (centipawns, from the player's perspective): inaccuracy, mistake, blunder. Compute an overall accuracy score.
3. Pick the 3–5 most costly moves.
4. Send the game (PGN), the selected moves, their FENs, evaluations and best moves to `POST /api/review`.
5. The server asks the LLM for: one short, specific explanation per mistake (what went wrong, what the better move achieves, in plain English, no jargon without explaining it), plus a 2–3 sentence summary with one habit to work on. Return structured JSON.
6. Review screen: the board jumps to each mistake's position; the player's move shown with a red arrow, the better move with a green arrow; explanation text beside it (and read aloud if voice is on). Navigate with swipe gestures or arrow buttons. Final card shows accuracy and the summary.

- The LLM must only explain what Stockfish found — never invent its own chess analysis. Ground every explanation in the supplied evaluations and best moves.
- If the server is unreachable, still show the review with Stockfish data and a simple template explanation.

### 6. Multiplayer (added to the plan)

Not in the original brief; added by the developer. Two ways to play a human opponent:

- **Local (hot-seat):** two people on the same device take turns. No server needed. Board can flip after each move so the player to move is at the bottom. Hand and mouse input both work.
- **Online over the LAN:** the host creates a room on the PC, picks a colour (white / black / random), and gets a link such as `https://<PC-LAN-IP>:5173/room/<id>`. The guest opens the link on another device on the same Wi-Fi and takes the other colour. Both players see the same board live.
  - Relay: a FastAPI WebSocket endpoint `/api/ws/{room}`. The server keeps each room's seats (white / black / spectators), the move list, and whose turn it is.
  - Validation: the server validates every move with `python-chess` and rejects illegal or out-of-turn moves, then broadcasts the new position. Clients render what the server accepts, so a client cannot play an illegal move.
  - Reconnect: each seat gets a random token stored in the browser's `localStorage`, so refreshing the page returns the player to their seat.
  - Rooms are in memory and disappear when the server restarts. That is fine for a local game.
  - Extra joiners open the link as spectators (read-only).
  - Stockfish is not used in multiplayer. Hand and mouse input work the same as in single player.
  - Multiplayer games do not get the Stockfish review. Phase 4's review applies only to games against the computer.

---

## Build phases (commit after each step)

**Phase 1 — Foundations**
1. Vite + TS project, HTTPS on LAN, prints LAN URL. Empty Three.js scene renders on the laptop.
2. 3D board + procedural pieces in the starting position.
3. Mouse input: click-drag to move pieces with chess.js legality checks and highlights.
4. Stockfish opponent with difficulty levels.

**Phase 2 — Menus**
5. Title screen, new game setup, HUD, game over screen, settings (persisted).

**Phase 3 — Hand control**
6. Webcam + HandLandmarker + preview with landmarks.
7. Cursor from index fingertip with smoothing and raycasting onto the board.
8. Pinch grab/carry/drop with hysteresis; open-palm cancel.
9. Tutorial flow.

**Phase 4 — Coach**
10. Post-game Stockfish analysis + accuracy score.
11. FastAPI `/api/review` + LLM prompt + JSON response.
12. Review screen with arrows, swipe navigation, optional voice.

**Phase 5 — Polish and ship**
13. Sounds, animations, board themes, error states.
14. README with demo GIF, architecture section, "how it works" section, setup instructions.
15. Deploy and add the live link to the README.

**Phase 6 — Multiplayer (added)**
16. Local hot-seat mode (two players, one device). Needs the Phase 2 game controller.
17. Room relay on the FastAPI server: create room, colour choice, seats, move validation with `python-chess`.
18. Browser multiplayer client: join by link, live board sync, reconnect via token, spectators.
19. Tests for room seat assignment and move rejection.

---

## Definition of done (for the CV)

- Live link anyone can try (mouse mode works without a camera).
- README with a demo GIF/video, architecture diagram, and a short "challenges I solved" section (e.g. jitter smoothing, pinch hysteresis, camera-to-board mapping).
- Clean, gradual commit history.
- At least a few unit tests for the gesture engine (pinch thresholds) and the move-classification logic.
- Multiplayer (local and LAN) works, tested with two devices.

---

## Status

Built so far (first full pass, not yet tested on the laptop with a real webcam):

- **Phase 1:** Vite + TS on LAN HTTPS, 3D board with procedural pieces, mouse drag with chess.js legality and highlights, Stockfish 19 with five difficulty levels.
- **Phase 2:** title, new game setup, HUD (moves, captures, status), pause, game over, settings saved to localStorage, three board themes.
- **Phase 3:** webcam with HandLandmarker and landmark preview, One Euro cursor smoothing, raycast onto the board, pinch grab/carry/drop with hysteresis, open-palm cancel, swipe, 30-second tutorial. Mouse falls back automatically if there is no camera.
- **Phase 4:** post-game analysis (every position at depth 10), move classification, accuracy, FastAPI `/api/review`. The LLM only explains supplied facts, and if the key or server is missing the review uses template text.
- **Phase 5 (partial):** synthesised sound effects, themes, error states (camera, server, connection).
- **Phase 6:** local hot-seat, online rooms with a shareable link, colour choice, spectators, seat reconnect, server-side move validation.

Known gaps and decisions:
- Promotion is always to a queen (underpromotion not yet offered).
- Hand tracking has been checked only with a headless browser (no camera). It needs a real pass on the laptop.
- Phase 5 polish is basic: no animation tuning, and one sound set.
- Rooms live in memory and are lost when the server restarts.
- Multiplayer games do not get the Stockfish review, as planned.
- Video, README GIF, and a live deployment (Phase 5 steps 14–15) are still to do.
