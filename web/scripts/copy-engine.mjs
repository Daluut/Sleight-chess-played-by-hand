// Copies the Stockfish WebAssembly build and the MediaPipe runtime into public/
// so the browser can load them from this same server (no internet needed on the LAN).
import { cpSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('public/engine', { recursive: true });
for (const f of ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']) {
  cpSync(`node_modules/stockfish/bin/${f}`, `public/engine/${f}`);
}
if (existsSync('node_modules/@mediapipe/tasks-vision/wasm')) {
  mkdirSync('public/mediapipe', { recursive: true });
  cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true });
}
console.log('Engine files copied to public/');
