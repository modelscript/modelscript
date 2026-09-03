/**
 * Procedural drone chassis geometry generator.
 *
 * Produces a realistic quadcopter frame with:
 *   - Central body plate (octagonal)
 *   - Four diagonal arms
 *   - Motor mounts (cylinders) at arm tips
 *   - Propeller guard rings
 *   - Landing skids
 *   - Battery bay underneath
 *   - Camera/gimbal mount on front
 *
 * All geometry is returned as flat arrays suitable for Three.js BufferGeometry.
 */

// ── helpers ──────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

interface GeometryArrays {
  vertices: number[];
  normals: number[];
  indices: number[];
}

function create(): GeometryArrays {
  return { vertices: [], normals: [], indices: [] };
}

function vertexCount(g: GeometryArrays): number {
  return g.vertices.length / 3;
}

/** Push a single vertex + normal pair. Returns the vertex index. */
function pushVert(g: GeometryArrays, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
  const idx = vertexCount(g);
  g.vertices.push(x, y, z);
  g.normals.push(nx, ny, nz);
  return idx;
}

/** Push a triangle by vertex indices. */
function pushTri(g: GeometryArrays, a: number, b: number, c: number): void {
  g.indices.push(a, b, c);
}

/** Push a quad (two triangles). */
function pushQuad(g: GeometryArrays, a: number, b: number, c: number, d: number): void {
  pushTri(g, a, b, c);
  pushTri(g, a, c, d);
}

// ── primitive builders ───────────────────────────────────────────────────

/**
 * Add a box with per-face normals.
 */
function addBox(g: GeometryArrays, cx: number, cy: number, cz: number, hw: number, hh: number, hd: number): void {
  const base = vertexCount(g);

  // 6 faces × 4 verts = 24 verts
  // Front (+Z)
  pushVert(g, cx - hw, cy - hh, cz + hd, 0, 0, 1);
  pushVert(g, cx + hw, cy - hh, cz + hd, 0, 0, 1);
  pushVert(g, cx + hw, cy + hh, cz + hd, 0, 0, 1);
  pushVert(g, cx - hw, cy + hh, cz + hd, 0, 0, 1);
  // Back (-Z)
  pushVert(g, cx + hw, cy - hh, cz - hd, 0, 0, -1);
  pushVert(g, cx - hw, cy - hh, cz - hd, 0, 0, -1);
  pushVert(g, cx - hw, cy + hh, cz - hd, 0, 0, -1);
  pushVert(g, cx + hw, cy + hh, cz - hd, 0, 0, -1);
  // Top (+Y)
  pushVert(g, cx - hw, cy + hh, cz + hd, 0, 1, 0);
  pushVert(g, cx + hw, cy + hh, cz + hd, 0, 1, 0);
  pushVert(g, cx + hw, cy + hh, cz - hd, 0, 1, 0);
  pushVert(g, cx - hw, cy + hh, cz - hd, 0, 1, 0);
  // Bottom (-Y)
  pushVert(g, cx - hw, cy - hh, cz - hd, 0, -1, 0);
  pushVert(g, cx + hw, cy - hh, cz - hd, 0, -1, 0);
  pushVert(g, cx + hw, cy - hh, cz + hd, 0, -1, 0);
  pushVert(g, cx - hw, cy - hh, cz + hd, 0, -1, 0);
  // Right (+X)
  pushVert(g, cx + hw, cy - hh, cz + hd, 1, 0, 0);
  pushVert(g, cx + hw, cy - hh, cz - hd, 1, 0, 0);
  pushVert(g, cx + hw, cy + hh, cz - hd, 1, 0, 0);
  pushVert(g, cx + hw, cy + hh, cz + hd, 1, 0, 0);
  // Left (-X)
  pushVert(g, cx - hw, cy - hh, cz - hd, -1, 0, 0);
  pushVert(g, cx - hw, cy - hh, cz + hd, -1, 0, 0);
  pushVert(g, cx - hw, cy + hh, cz + hd, -1, 0, 0);
  pushVert(g, cx - hw, cy + hh, cz - hd, -1, 0, 0);

  for (let f = 0; f < 6; f++) {
    const i = base + f * 4;
    pushQuad(g, i, i + 1, i + 2, i + 3);
  }
}

/**
 * Add a cylinder with top/bottom caps and smooth side normals.
 */
function addCylinder(
  g: GeometryArrays,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  halfHeight: number,
  segments: number,
): void {
  // Top cap
  const topCenter = pushVert(g, cx, cy + halfHeight, cz, 0, 1, 0);
  const topRing: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    topRing.push(pushVert(g, cx + radius * Math.cos(a), cy + halfHeight, cz + radius * Math.sin(a), 0, 1, 0));
  }
  for (let i = 0; i < segments; i++) {
    pushTri(g, topCenter, topRing[i], topRing[(i + 1) % segments]);
  }

  // Bottom cap
  const botCenter = pushVert(g, cx, cy - halfHeight, cz, 0, -1, 0);
  const botRing: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    botRing.push(pushVert(g, cx + radius * Math.cos(a), cy - halfHeight, cz + radius * Math.sin(a), 0, -1, 0));
  }
  for (let i = 0; i < segments; i++) {
    pushTri(g, botCenter, botRing[(i + 1) % segments], botRing[i]);
  }

  // Side wall
  const sideTop: number[] = [];
  const sideBot: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * TAU;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    sideTop.push(pushVert(g, cx + radius * nx, cy + halfHeight, cz + radius * nz, nx, 0, nz));
    sideBot.push(pushVert(g, cx + radius * nx, cy - halfHeight, cz + radius * nz, nx, 0, nz));
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    pushQuad(g, sideTop[i], sideBot[i], sideBot[next], sideTop[next]);
  }
}

/**
 * Add a torus (ring) aligned on the Y axis.
 */
function addTorus(
  g: GeometryArrays,
  cx: number,
  cy: number,
  cz: number,
  majorRadius: number,
  minorRadius: number,
  majorSegments: number,
  minorSegments: number,
): void {
  // Build vertex grid
  const grid: number[][] = [];
  for (let i = 0; i <= majorSegments; i++) {
    const row: number[] = [];
    const u = (i / majorSegments) * TAU;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= minorSegments; j++) {
      const v = (j / minorSegments) * TAU;
      const cv = Math.cos(v);
      const sv = Math.sin(v);

      const x = cx + (majorRadius + minorRadius * cv) * cu;
      const y = cy + minorRadius * sv;
      const z = cz + (majorRadius + minorRadius * cv) * su;

      const nx2 = cv * cu;
      const ny2 = sv;
      const nz2 = cv * su;

      row.push(pushVert(g, x, y, z, nx2, ny2, nz2));
    }
    grid.push(row);
  }

  for (let i = 0; i < majorSegments; i++) {
    for (let j = 0; j < minorSegments; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      pushQuad(g, a, b, c, d);
    }
  }
}

/**
 * Add a tapered arm (truncated pyramid) from (x0,y0,z0) to (x1,y1,z1).
 * The arm's cross-section shrinks from (w0,h0) at the start to (w1,h1) at the end.
 */
function addTaperedArm(
  g: GeometryArrays,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  w0: number,
  h0: number,
  w1: number,
  h1: number,
): void {
  // Direction vector
  const dx = x1 - x0,
    dy = y1 - y0,
    dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const fwd = [dx / len, dy / len, dz / len];

  // Choose an up vector that isn't parallel to fwd
  let up = [0, 1, 0];
  if (Math.abs(fwd[1]) > 0.99) up = [1, 0, 0];

  // right = fwd × up
  const right = [fwd[1] * up[2] - fwd[2] * up[1], fwd[2] * up[0] - fwd[0] * up[2], fwd[0] * up[1] - fwd[1] * up[0]];
  const rLen = Math.sqrt(right[0] * right[0] + right[1] * right[1] + right[2] * right[2]);
  right[0] /= rLen;
  right[1] /= rLen;
  right[2] /= rLen;

  // recalc up = right × fwd
  up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];

  // 4 corners at start
  const corners0 = [
    [-w0, -h0],
    [w0, -h0],
    [w0, h0],
    [-w0, h0],
  ].map(([r, u]) => [x0 + right[0] * r + up[0] * u, y0 + right[1] * r + up[1] * u, z0 + right[2] * r + up[2] * u]);

  // 4 corners at end
  const corners1 = [
    [-w1, -h1],
    [w1, -h1],
    [w1, h1],
    [-w1, h1],
  ].map(([r, u]) => [x1 + right[0] * r + up[0] * u, y1 + right[1] * r + up[1] * u, z1 + right[2] * r + up[2] * u]);

  // 4 side faces
  const faceNormals = [
    [0, -1, 0], // bottom
    [1, 0, 0], // right
    [0, 1, 0], // top
    [-1, 0, 0], // left
  ].map(([r, u]) => [right[0] * r + up[0] * u, right[1] * r + up[1] * u, right[2] * r + up[2] * u]);

  for (let face = 0; face < 4; face++) {
    const next = (face + 1) % 4;
    const n = faceNormals[face];
    const a = pushVert(g, corners0[face][0], corners0[face][1], corners0[face][2], n[0], n[1], n[2]);
    const b = pushVert(g, corners0[next][0], corners0[next][1], corners0[next][2], n[0], n[1], n[2]);
    const c = pushVert(g, corners1[next][0], corners1[next][1], corners1[next][2], n[0], n[1], n[2]);
    const d = pushVert(g, corners1[face][0], corners1[face][1], corners1[face][2], n[0], n[1], n[2]);
    pushQuad(g, a, b, c, d);
  }

  // Start cap (normal = -fwd)
  {
    const n = [-fwd[0], -fwd[1], -fwd[2]];
    const vs = corners0.map((c) => pushVert(g, c[0], c[1], c[2], n[0], n[1], n[2]));
    pushQuad(g, vs[3], vs[2], vs[1], vs[0]);
  }
  // End cap (normal = +fwd)
  {
    const n = fwd;
    const vs = corners1.map((c) => pushVert(g, c[0], c[1], c[2], n[0], n[1], n[2]));
    pushQuad(g, vs[0], vs[1], vs[2], vs[3]);
  }
}

/**
 * Add an octagonal prism (flat plate with 8-sided outline).
 */
function addOctagonalPlate(
  g: GeometryArrays,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  halfHeight: number,
): void {
  const sides = 8;
  const topCenter = pushVert(g, cx, cy + halfHeight, cz, 0, 1, 0);
  const botCenter = pushVert(g, cx, cy - halfHeight, cz, 0, -1, 0);

  const topVerts: number[] = [];
  const botVerts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + TAU / 16; // offset by half-segment for flat bottom
    const x = cx + radius * Math.cos(a);
    const z = cz + radius * Math.sin(a);
    topVerts.push(pushVert(g, x, cy + halfHeight, z, 0, 1, 0));
    botVerts.push(pushVert(g, x, cy - halfHeight, z, 0, -1, 0));
  }

  // Top and bottom faces
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    pushTri(g, topCenter, topVerts[i], topVerts[next]);
    pushTri(g, botCenter, botVerts[next], botVerts[i]);
  }

  // Side faces
  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides;
    const midA = ((i + 0.5) / sides) * TAU + TAU / 16;
    const nx = Math.cos(midA);
    const nz = Math.sin(midA);

    const aI = (i / sides) * TAU + TAU / 16;
    const bI = (next / sides) * TAU + TAU / 16;

    const v0 = pushVert(g, cx + radius * Math.cos(aI), cy + halfHeight, cz + radius * Math.sin(aI), nx, 0, nz);
    const v1 = pushVert(g, cx + radius * Math.cos(bI), cy + halfHeight, cz + radius * Math.sin(bI), nx, 0, nz);
    const v2 = pushVert(g, cx + radius * Math.cos(bI), cy - halfHeight, cz + radius * Math.sin(bI), nx, 0, nz);
    const v3 = pushVert(g, cx + radius * Math.cos(aI), cy - halfHeight, cz + radius * Math.sin(aI), nx, 0, nz);
    pushQuad(g, v0, v1, v2, v3);
  }
}

// ── main generator ───────────────────────────────────────────────────────

/**
 * Generate a realistic drone chassis mesh.
 *
 * Returns flat arrays for position, normal, and index buffers.
 * Scale: roughly 200mm × 200mm (fits a 5″ racing quad).
 */
export function generateDroneChassisGeometry(): { vertices: number[]; normals: number[]; indices: number[] } {
  const g = create();

  // ── Central body ─────────────────────────────────────────────
  // Octagonal main plate
  addOctagonalPlate(g, 0, 0, 0, 5, 0.8);

  // Top cover plate (slightly smaller, raised)
  addOctagonalPlate(g, 0, 1.2, 0, 4.2, 0.3);

  // Bottom electronics bay
  addBox(g, 0, -1.4, 0, 3, 0.5, 3);

  // ── Four diagonal arms ───────────────────────────────────────
  const armLength = 12;
  const motorOffset = armLength * 0.707; // cos(45°) ≈ 0.707
  const armPositions: [number, number][] = [
    [1, 1], // front-right
    [-1, 1], // front-left
    [-1, -1], // rear-left
    [1, -1], // rear-right
  ];

  for (const [sx, sz] of armPositions) {
    const ex = sx * motorOffset;
    const ez = sz * motorOffset;

    // Tapered arm: wide at body, narrow at motor
    addTaperedArm(
      g,
      sx * 3.2,
      0,
      sz * 3.2, // start (at body edge)
      ex,
      0,
      ez, // end (at motor mount)
      1.0,
      0.5, // start cross-section
      0.6,
      0.4, // end cross-section
    );

    // Motor mount cylinder
    addCylinder(g, ex, 0.8, ez, 1.4, 0.6, 20);

    // Motor bell (smaller cylinder on top)
    addCylinder(g, ex, 1.8, ez, 0.9, 0.4, 16);

    // Motor shaft
    addCylinder(g, ex, 2.4, ez, 0.15, 0.3, 8);

    // Propeller guard ring
    addTorus(g, ex, 1.0, ez, 3.0, 0.15, 24, 8);
  }

  // ── Landing skids ────────────────────────────────────────────
  // Two parallel skid bars
  for (const sx of [-1, 1]) {
    // Vertical strut (front)
    addBox(g, sx * 3.5, -2.5, 3, 0.2, 1.0, 0.2);
    // Vertical strut (rear)
    addBox(g, sx * 3.5, -2.5, -3, 0.2, 1.0, 0.2);
    // Horizontal skid bar
    addBox(g, sx * 3.5, -3.6, 0, 0.25, 0.15, 4.5);
  }

  // ── Front camera/gimbal mount ────────────────────────────────
  // Camera arm extending forward
  addBox(g, 0, -0.8, 5.5, 0.8, 0.3, 1.2);
  // Camera housing
  addCylinder(g, 0, -1.4, 6.8, 0.7, 0.5, 12);
  // Lens
  addCylinder(g, 0, -1.4, 7.5, 0.35, 0.2, 12);

  // ── Battery strap mount points ───────────────────────────────
  addBox(g, -2.5, -1.0, 0, 0.15, 0.6, 2.0);
  addBox(g, 2.5, -1.0, 0, 0.15, 0.6, 2.0);

  // ── Antenna mount (rear) ─────────────────────────────────────
  addCylinder(g, 0, 2.0, -4.5, 0.12, 1.5, 8);
  // Antenna tip
  addCylinder(g, 0, 3.7, -4.5, 0.2, 0.15, 8);

  // ── LED strip slots on front arms ────────────────────────────
  addBox(g, 3.5, 0.7, 3.5, 0.8, 0.08, 0.15);
  addBox(g, -3.5, 0.7, 3.5, 0.8, 0.08, 0.15);

  return g;
}
