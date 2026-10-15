// Hand input: webcam -> MediaPipe HandLandmarker -> smoothed cursor + gestures.
//
// Cursor mapping: the index fingertip (landmark 8) is mirrored (so moving your hand
// right moves the cursor right) and the central 70% of the camera image is stretched
// to the whole screen, so you do not have to reach the edges of the frame.
import { FilesetResolver, HandLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import type { BoardView } from '../scene/board';
import { DEFAULT_GESTURE_OPTIONS, GestureEngine, type Landmark } from './gesture';
import { OneEuroFilter } from './oneEuro';
import type { InputListener, Pointer } from './types';
import type { Settings } from '../settings';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = '/mediapipe'; // copied from node_modules by scripts/copy-engine.mjs

const FRAME_MARGIN = 0.15; // ignore the outer 15% of the camera image

export interface HandHandle {
  stop(): void;
  setPreview(visible: boolean): void;
}

export async function startHandInput(
  board: BoardView,
  settings: Settings,
  emit: InputListener,
  preview: { video: HTMLVideoElement; canvas: HTMLCanvasElement },
  onStatus: (text: string) => void,
): Promise<HandHandle> {
  // 1. Camera. Throws if there is none or permission is refused: the caller falls back to mouse.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  preview.video.srcObject = stream;
  await preview.video.play();

  // 2. Hand model (runs in the browser; no server needed).
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = { modelAssetPath: MODEL_URL };
  let landmarker: HandLandmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { ...options, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 });
  } catch {
    // Some laptops have no usable GPU path for MediaPipe: fall back to the CPU.
    landmarker = await HandLandmarker.createFromOptions(vision, { baseOptions: { ...options, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1 });
  }

  const gestures = new GestureEngine({ ...DEFAULT_GESTURE_OPTIONS, gripSensitivity: settings.gripSensitivity });
  // Smoothing: settings.smoothing 0 (responsive) .. 1 (very smooth) maps to a
  // One Euro minimum cutoff of 1.4 Hz .. 0.2 Hz. Lower cutoff = smoother when still.
  const minCutoff = 1.4 - 1.2 * settings.smoothing;
  const fx = new OneEuroFilter(minCutoff, 0.02);
  const fy = new OneEuroFilter(minCutoff, 0.02);

  let lastSquare: string | null = null;
  let lastTime = performance.now();
  let lastFrame = -1;
  let showPreview = settings.showPreview;
  let running = true;
  let handVisible = false;
  const ctx = preview.canvas.getContext('2d');

  const drawPreview = (lm: NormalizedLandmark[] | null) => {
    if (!ctx) return;
    const { width, height } = preview.canvas;
    ctx.clearRect(0, 0, width, height);
    if (!lm) return;
    ctx.fillStyle = '#ffd166';
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc((1 - p.x) * width, p.y * height, 3, 0, Math.PI * 2); // mirrored, like the cursor
      ctx.fill();
    }
  };

  const frame = () => {
    if (!running) return;
    const now = performance.now();
    if (preview.video.readyState >= 2 && preview.video.currentTime !== lastFrame) {
      lastFrame = preview.video.currentTime;
      const dt = Math.max(0.001, (now - lastTime) / 1000);
      lastTime = now;
      const res = landmarker.detectForVideo(preview.video, now);
      const lm = res.landmarks[0] ?? null;

      if (showPreview) drawPreview(lm);

      if (lm && !handVisible) {
        handVisible = true;
        onStatus('');
      } else if (!lm && handVisible) {
        handVisible = false;
        onStatus('Hand lost, hold on…');
      }

      // Cursor: fingertip -> mirrored -> stretched -> NDC -> board point.
      let pointer: Pointer | null = null;
      if (lm) {
        const mirroredX = 1 - lm[8].x;
        const u = clamp01((mirroredX - FRAME_MARGIN) / (1 - 2 * FRAME_MARGIN));
        const v = clamp01((lm[8].y - FRAME_MARGIN) / (1 - 2 * FRAME_MARGIN));
        const sx = fx.filter(u, dt);
        const sy = fy.filter(v, dt);
        const ndc = new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1));
        pointer = board.pickNdc(ndc);
        const sq = pointer.square;
        if (sq !== lastSquare) {
          lastSquare = sq;
          emit({ type: 'hover', pointer });
        } else if (gestures.isGripping) {
          // Keep the carried piece following the hand even inside one square.
          emit({ type: 'hover', pointer });
        }
      } else {
        fx.reset();
        fy.reset();
      }

      for (const ev of gestures.update(lm as Landmark[] | null, now)) {
        if (ev.type === 'gripStart' && pointer) emit({ type: 'grab', pointer });
        if (ev.type === 'gripEnd') emit({ type: 'drop', pointer: pointer ?? { square: null, point: null } });
        if (ev.type === 'swipe') emit({ type: 'swipe', dir: ev.dir });
        if (ev.type === 'handLost') onStatus('Hand lost, piece released');
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      stream.getTracks().forEach((t) => t.stop());
      landmarker.close();
    },
    setPreview(visible: boolean) {
      showPreview = visible;
      preview.canvas.style.display = visible ? 'block' : 'none';
      preview.video.style.display = visible ? 'block' : 'none';
    },
  };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
