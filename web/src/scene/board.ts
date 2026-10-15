// BoardView: everything you see in 3D. It owns the Three.js scene, the camera,
// the board and pieces, move animations, highlights and review arrows.
//
// Coordinates: a1 is at x = +3.5, z = -3.5 and h8 at x = -3.5, z = +3.5, so the
// White camera (at negative z) sees a1 bottom-left. Each square is 1 unit wide.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Chess, type Color, type Move, type PieceSymbol, type Square } from 'chess.js';
import { buildPiece, type PieceMaterials } from './pieces';
import type { Pointer } from '../input/types';
import type { ThemeName } from '../settings';

export interface Palette {
  light: string;
  dark: string;
  white: string;
  black: string;
  ground: string;
  bg: string;
}

export const PALETTES: Record<ThemeName, Palette> = {
  classic: { light: '#e8d5b0', dark: '#8b5a2b', white: '#f5f1e6', black: '#2b2b2b', ground: '#171a22', bg: '#0d0f14' },
  walnut: { light: '#d9b38c', dark: '#6b4226', white: '#efe6d8', black: '#1d1a17', ground: '#1d1611', bg: '#14100d' },
  midnight: { light: '#5b6b8c', dark: '#2a3347', white: '#dfe6f5', black: '#0e1220', ground: '#0a0d16', bg: '#05070d' },
};

export type OverlayKind = 'hover' | 'selected' | 'last' | 'check' | 'tutorial' | 'dot' | 'capture';

export const LIFT_HEIGHT = 0.9;

/** Square name to a 3D point on the board plane (or raised by `y`). */
export function squareToPos(sq: Square, y = 0): THREE.Vector3 {
  const file = sq.charCodeAt(0) - 97; // a = 0
  const rank = Number(sq[1]) - 1; // 1 = 0
  return new THREE.Vector3(3.5 - file, y, rank - 3.5);
}

/** 3D point on the board to a square name, or null when off the board. */
export function posToSquare(x: number, z: number): Square | null {
  const file = Math.floor(4 - x);
  const rank = Math.floor(z + 4);
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (String.fromCharCode(97 + file) + (rank + 1)) as Square;
}

interface Tween {
  start: number;
  dur: number;
  step: (t: number) => void; // t is eased 0..1
  done?: () => void;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class BoardView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private boardGroup = new THREE.Group();
  private pieceGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private arrowGroup = new THREE.Group();
  private pieces = new Map<Square, THREE.Group>();
  private squareMeshes: THREE.Mesh[] = [];
  private lightMat = new THREE.MeshStandardMaterial();
  private darkMat = new THREE.MeshStandardMaterial();
  private groundMat = new THREE.MeshStandardMaterial();
  private pieceMats: PieceMaterials = { w: new THREE.MeshStandardMaterial(), b: new THREE.MeshStandardMaterial() };
  private overlayMats = new Map<OverlayKind, THREE.MeshBasicMaterial>();
  private overlayKeys = new Map<OverlayKind, string>();
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private tweens: Tween[] = [];
  private heldSquare: Square | null = null;
  private lastFen = new Chess().fen();
  private onFrameCbs: ((now: number) => void)[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 9, -9.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 18;
    this.controls.maxPolarAngle = Math.PI * 0.42; // stop the camera going under the board

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#303048', 1.0));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(4, 10, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -7;
    sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    this.scene.add(sun);

    this.scene.add(this.boardGroup, this.pieceGroup, this.overlayGroup, this.arrowGroup);
    this.buildBoard();
    this.buildOverlayMaterials();
    this.setTheme('classic');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- setup ----------

  private buildBoard(): void {
    // Thin base slab under the squares, with a shadow-catching ground below it.
    const base = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.4, 9.2), new THREE.MeshStandardMaterial({ color: '#3a2a1c', roughness: 0.6 }));
    base.position.y = -0.2;
    base.receiveShadow = true;
    this.boardGroup.add(base);

    const squareGeo = new THREE.PlaneGeometry(1, 1);
    squareGeo.rotateX(-Math.PI / 2);
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const sq = (String.fromCharCode(97 + f) + (r + 1)) as Square;
        const isLight = (f + r) % 2 === 1; // a1 is dark
        const mesh = new THREE.Mesh(squareGeo, isLight ? this.lightMat : this.darkMat);
        mesh.position.copy(squareToPos(sq, 0.001));
        mesh.receiveShadow = true;
        mesh.userData.square = sq;
        this.squareMeshes.push(mesh);
        this.boardGroup.add(mesh);
      }
    }

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.41;
    ground.receiveShadow = true;
    this.boardGroup.add(ground);
  }

  private buildOverlayMaterials(): void {
    const make = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.overlayMats.set('hover', make('#ffffff', 0.22));
    this.overlayMats.set('selected', make('#f5d142', 0.45));
    this.overlayMats.set('last', make('#7fd3ff', 0.3));
    this.overlayMats.set('check', make('#ff3b3b', 0.55));
    this.overlayMats.set('tutorial', make('#4ade80', 0.5));
    this.overlayMats.set('dot', make('#101010', 0.35));
    this.overlayMats.set('capture', make('#101010', 0.4));
  }

  /** Switch palette: recolours squares, pieces and the background without rebuilding anything. */
  setTheme(name: ThemeName): void {
    const p = PALETTES[name];
    this.lightMat.color.set(p.light);
    this.darkMat.color.set(p.dark);
    this.groundMat.color.set(p.ground);
    this.lightMat.roughness = this.darkMat.roughness = 0.55;
    this.pieceMats.w = new THREE.MeshStandardMaterial({ color: p.white, roughness: 0.35, metalness: 0.05 });
    this.pieceMats.b = new THREE.MeshStandardMaterial({ color: p.black, roughness: 0.35, metalness: 0.05 });
    this.renderer.setClearColor(p.bg);
    this.setPosition(this.lastFen);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Portrait screens need the camera further back to fit the whole board.
    this.camera.fov = w / h < 0.8 ? 55 : 40;
    this.camera.updateProjectionMatrix();
  }

  // ---------- position ----------

  /** Rebuild every piece from a FEN. Used at the start and to resync after a mismatch. */
  setPosition(fen: string): void {
    this.lastFen = fen;
    for (const obj of this.pieces.values()) this.pieceGroup.remove(obj);
    this.pieces.clear();
    this.heldSquare = null;
    this.controls.enabled = true;
    this.tweens = [];
    const board = new Chess(fen).board();
    for (const row of board) {
      for (const cell of row) {
        if (cell) this.addPiece(cell.square, cell.type, cell.color);
      }
    }
  }

  private addPiece(sq: Square, type: PieceSymbol, color: Color, y = 0): THREE.Group {
    const obj = buildPiece(type, color, this.pieceMats);
    obj.position.copy(squareToPos(sq, y));
    obj.userData = { type, color };
    this.pieces.set(sq, obj);
    this.pieceGroup.add(obj);
    return obj;
  }

  /**
   * Animate a move that has already been made in chess.js: the piece glides,
   * captures fade, castling moves the rook, promotions swap the piece at the end.
   */
  animateMove(move: Move): void {
    const piece = this.pieces.get(move.from);
    if (!piece) return;

    // Remove whatever is captured. En passant captures a pawn beside the target.
    const capSq = move.flags.includes('e') ? ((move.to[0] + move.from[1]) as Square) : move.to;
    const captured = this.pieces.get(capSq);
    if (captured && capSq !== move.from) {
      this.pieces.delete(capSq);
      const start = performance.now();
      this.tweens.push({
        start,
        dur: 280,
        step: (t) => captured.scale.setScalar(Math.max(0.001, 1 - t)),
        done: () => this.pieceGroup.remove(captured),
      });
    }

    // Castling: the rook moves too.
    if (move.flags.includes('k') || move.flags.includes('q')) {
      const rank = move.to[1];
      const [rookFrom, rookTo] = move.flags.includes('k') ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
      const rook = this.pieces.get(rookFrom as Square);
      if (rook) {
        this.pieces.delete(rookFrom as Square);
        this.pieces.set(rookTo as Square, rook);
        this.glide(rook, squareToPos(rookTo as Square), 0.45, 0.2);
      }
    }

    this.pieces.delete(move.from);
    this.pieces.set(move.to, piece);
    const promotion = move.promotion;
    this.glide(piece, squareToPos(move.to), 0.45, 0.5, () => {
      if (promotion) {
        this.pieceGroup.remove(piece);
        this.addPiece(move.to, promotion, move.color);
      }
    });
    if (this.heldSquare === move.from) this.heldSquare = null;
    this.controls.enabled = true;
  }

  /** Move an object to a point with a small hop. `done` runs when it lands. */
  private glide(obj: THREE.Object3D, to: THREE.Vector3, sec: number, arc: number, done?: () => void): void {
    const from = obj.position.clone();
    this.tweens.push({
      start: performance.now(),
      dur: sec * 1000,
      step: (t) => {
        obj.position.lerpVectors(from, to, t);
        obj.position.y = from.y + (to.y - from.y) * t + Math.sin(Math.PI * t) * arc;
      },
      done,
    });
  }

  // ---------- holding a piece (drag / pinch) ----------

  liftPiece(sq: Square): void {
    const obj = this.pieces.get(sq);
    if (!obj) return;
    this.heldSquare = sq;
    // Orbit would rotate the camera on the same drag that moves the piece, so lock it.
    this.controls.enabled = false;
    this.glide(obj, squareToPos(sq, LIFT_HEIGHT), 0.15, 0);
  }

  /** Make the held piece follow a point on the board plane. */
  followHeld(point: THREE.Vector3 | null): void {
    if (!this.heldSquare || !point) return;
    const obj = this.pieces.get(this.heldSquare);
    if (!obj) return;
    obj.position.set(point.x, LIFT_HEIGHT, point.z);
  }

  /** Put a held piece back on its square (illegal drop, cancel, or dropped on itself). */
  returnPiece(sq: Square): void {
    const obj = this.pieces.get(sq);
    if (obj) this.glide(obj, squareToPos(sq), 0.25, 0.1);
    if (this.heldSquare === sq) this.heldSquare = null;
    this.controls.enabled = true;
  }

  // ---------- picking ----------

  /** Raycast from the camera through a point in normalised device coords (-1..1). */
  pickNdc(ndc: THREE.Vector2): Pointer {
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return { square: null, point: null };
    return { square: posToSquare(hit.x, hit.z), point: hit };
  }

  /** Same as pickNdc, but from a mouse or touch position in CSS pixels. */
  pickClient(clientX: number, clientY: number): Pointer {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.pickNdc(ndc);
  }

  // ---------- highlights ----------

  /**
   * Show a highlight on a list of squares. Passing the same squares again is
   * cheap: the meshes are only rebuilt when the list changes.
   */
  setOverlay(kind: OverlayKind, squares: Square[]): void {
    const key = squares.join(',');
    if (this.overlayKeys.get(kind) === key) return;
    this.overlayKeys.set(kind, key);

    const existing = this.overlayGroup.getObjectByName(kind);
    if (existing) this.overlayGroup.remove(existing);
    if (squares.length === 0) return;

    const group = new THREE.Group();
    group.name = kind;
    const isDot = kind === 'dot';
    const isRing = kind === 'capture';
    const geo = isDot
      ? new THREE.CircleGeometry(0.16, 24)
      : isRing
        ? new THREE.RingGeometry(0.36, 0.46, 32)
        : new THREE.PlaneGeometry(0.98, 0.98);
    geo.rotateX(-Math.PI / 2);
    const mat = this.overlayMats.get(kind)!;
    for (const sq of squares) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(squareToPos(sq, 0.01));
      group.add(mesh);
    }
    this.overlayGroup.add(group);
  }

  /** Coloured arrows between squares, used by the review screen. */
  showArrows(arrows: { from: Square; to: Square; color: number }[]): void {
    this.arrowGroup.clear();
    for (const a of arrows) {
      const from = squareToPos(a.from, 0.25);
      const to = squareToPos(a.to, 0.25);
      const dir = to.clone().sub(from);
      const len = dir.length();
      const arrow = new THREE.ArrowHelper(dir.normalize(), from, len - 0.2, a.color, 0.35, 0.22);
      this.arrowGroup.add(arrow);
    }
  }

  clearArrows(): void {
    this.arrowGroup.clear();
  }

  /** Turn the camera to face White (from the negative z side) or Black. */
  setView(color: Color, animate = true): void {
    const target = color === 'w' ? new THREE.Vector3(0, 9, -9.5) : new THREE.Vector3(0, 9, 9.5);
    if (!animate) {
      this.camera.position.copy(target);
      this.controls.update();
      return;
    }
    const from = this.camera.position.clone();
    this.tweens.push({
      start: performance.now(),
      dur: 700,
      step: (t) => {
        this.camera.position.lerpVectors(from, target, t);
        this.controls.update();
      },
    });
  }

  /** Slowly orbit the board, used on the title screen. */
  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.6;
  }

  /** Extra per-frame callback, e.g. to pulse the tutorial highlight. */
  onFrame(cb: (now: number) => void): void {
    this.onFrameCbs.push(cb);
  }

  start(): void {
    this.renderer.setAnimationLoop((now: number) => {
      // Run finished tweens and drop them from the list.
      this.tweens = this.tweens.filter((tw) => {
        const t = Math.min(1, (now - tw.start) / tw.dur);
        tw.step(easeInOut(t));
        if (t >= 1) {
          tw.done?.();
          return false;
        }
        return true;
      });
      for (const cb of this.onFrameCbs) cb(now);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

}
