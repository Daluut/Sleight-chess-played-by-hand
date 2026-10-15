// Procedural chess pieces. Round pieces are THREE.LatheGeometry: a 2D profile
// (radius, height) pairs spun around the vertical axis. The knight is an
// extruded silhouette because a lathe cannot make a horse head.
import * as THREE from 'three';
import type { Color, PieceSymbol } from 'chess.js';

export type PieceMaterials = Record<Color, THREE.Material>;

// Profiles are [radius, height] pairs, bottom to top. Ends on the axis (radius 0).
const PROFILES: Record<'p' | 'r' | 'b' | 'q' | 'k', [number, number][]> = {
  p: [[0, 0], [0.36, 0], [0.36, 0.07], [0.22, 0.14], [0.12, 0.3], [0.19, 0.44], [0.24, 0.5], [0.2, 0.56], [0, 0.6]],
  r: [[0, 0], [0.38, 0], [0.38, 0.08], [0.28, 0.14], [0.27, 0.6], [0.34, 0.66], [0.34, 0.76], [0, 0.76]],
  b: [[0, 0], [0.36, 0], [0.36, 0.08], [0.2, 0.16], [0.13, 0.34], [0.25, 0.5], [0.22, 0.62], [0.12, 0.78], [0.14, 0.84], [0, 0.88]],
  q: [[0, 0], [0.4, 0], [0.4, 0.08], [0.24, 0.16], [0.14, 0.5], [0.3, 0.66], [0.26, 0.76], [0.14, 0.88], [0, 0.9]],
  k: [[0, 0], [0.4, 0], [0.4, 0.08], [0.24, 0.16], [0.14, 0.5], [0.28, 0.66], [0.24, 0.78], [0.12, 0.86], [0, 0.88]],
};

function lathe(profile: [number, number][]): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 40);
}

// Knight silhouette in the XY plane, about 0.9 units tall, then extruded for depth.
function knightGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.3, 0);
  s.lineTo(0.3, 0);
  s.lineTo(0.3, 0.1);
  s.quadraticCurveTo(0.22, 0.25, 0.25, 0.45); // front of the neck
  s.lineTo(0.36, 0.6); // muzzle
  s.quadraticCurveTo(0.42, 0.8, 0.1, 0.86); // top of the head
  s.lineTo(-0.08, 0.92); // ear
  s.lineTo(-0.1, 0.78);
  s.quadraticCurveTo(-0.32, 0.6, -0.22, 0.25); // back of the neck
  s.lineTo(-0.3, 0);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSize: 0.03,
    bevelThickness: 0.03,
    bevelSegments: 2,
  });
  geo.translate(0, 0, -0.1); // centre the thickness on z = 0
  return geo;
}

/** Builds one piece as a Group whose base sits at y = 0 and centre at x = z = 0. */
export function buildPiece(type: PieceSymbol, color: Color, mats: PieceMaterials): THREE.Group {
  const group = new THREE.Group();
  const mat = mats[color];
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  if (type === 'n') {
    add(knightGeometry());
    return group;
  }

  add(lathe(PROFILES[type]));

  if (type === 'r') {
    // Four battlements around the top rim.
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      add(new THREE.BoxGeometry(0.14, 0.16, 0.14), Math.cos(a) * 0.27, 0.84, Math.sin(a) * 0.27);
    }
  }
  if (type === 'b') add(new THREE.SphereGeometry(0.07, 16, 12), 0, 0.95, 0);
  if (type === 'q') add(new THREE.SphereGeometry(0.09, 16, 12), 0, 0.98, 0);
  if (type === 'k') {
    add(new THREE.BoxGeometry(0.07, 0.3, 0.07), 0, 1.03, 0); // cross upright
    add(new THREE.BoxGeometry(0.22, 0.07, 0.07), 0, 1.1, 0); // cross bar
  }
  return group;
}
