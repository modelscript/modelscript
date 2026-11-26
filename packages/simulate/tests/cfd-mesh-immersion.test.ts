// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { LbmCellType, LbmVoxelizer, WebGPULbmRunner, type LbmGridConfig } from "../src/cfd/index.js";
import { healTriangleMesh } from "../src/cfd/lbm-voxelizer.js";

console.log("=== Testing Workstream 1: Direct CAD/STL Triangle-Mesh Immersion & Bouzidi Raycasting ===");

/** Generates a watertight triangulated UV sphere centered at (cx, cy, cz) with radius r. */
function createSphereMesh(
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  latSteps = 16,
  lonSteps = 24,
): { vertices: Float32Array; indices: Uint32Array } {
  const verts: number[] = [];
  const inds: number[] = [];

  for (let i = 0; i <= latSteps; i++) {
    const theta = (i * Math.PI) / latSteps;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let j = 0; j <= lonSteps; j++) {
      const phi = (j * 2 * Math.PI) / lonSteps;
      verts.push(cx + rx * sinT * Math.cos(phi), cy + ry * cosT, cz + rz * sinT * Math.sin(phi));
    }
  }

  const stride = lonSteps + 1;
  for (let i = 0; i < latSteps; i++) {
    for (let j = 0; j < lonSteps; j++) {
      const a = i * stride + j;
      const b = a + stride;
      inds.push(a, b, a + 1);
      inds.push(b, b + 1, a + 1);
    }
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

/** Generates a watertight extruded NACA 0012 wing section in normalized [0, 1]^3 coordinates. */
function createNaca0012WingMesh(
  xStart: number,
  chord: number,
  yCenter: number,
  zMin: number,
  zMax: number,
  nChord = 20,
): { vertices: Float32Array; indices: Uint32Array } {
  const profile: [number, number][] = [];
  // Upper surface from LE to TE
  for (let i = 0; i <= nChord; i++) {
    const xc = i / nChord;
    const yt =
      5 * 0.12 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1015 * xc ** 4);
    profile.push([xStart + xc * chord, yCenter + yt * chord]);
  }
  // Lower surface from TE-1 back to LE+1
  for (let i = nChord - 1; i >= 1; i--) {
    const xc = i / nChord;
    const yt =
      5 * 0.12 * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1015 * xc ** 4);
    profile.push([xStart + xc * chord, yCenter - yt * chord]);
  }

  const m = profile.length;
  const verts: number[] = [];
  for (const [px, py] of profile) verts.push(px, py, zMin);
  for (const [px, py] of profile) verts.push(px, py, zMax);
  // Center vertices for caps
  const capMinCenter = verts.length / 3;
  verts.push(xStart + 0.35 * chord, yCenter, zMin);
  const capMaxCenter = verts.length / 3;
  verts.push(xStart + 0.35 * chord, yCenter, zMax);

  const inds: number[] = [];
  for (let i = 0; i < m; i++) {
    const next = (i + 1) % m;
    // Side quad -> 2 triangles
    inds.push(i, next, m + next);
    inds.push(i, m + next, m + i);
    // Caps
    inds.push(capMinCenter, next, i);
    inds.push(capMaxCenter, m + i, m + next);
  }

  return { vertices: new Float32Array(verts), indices: new Uint32Array(inds) };
}

// 1. Sphere voxelization volume accuracy + Bouzidi deltaWall check
{
  const config: LbmGridConfig = {
    nx: 32,
    ny: 32,
    nz: 32,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [4.0, 0.0, 0.0],
    curvedBoundary: true,
  };

  const rNorm = 0.2;
  const sphere = createSphereMesh(0.5, 0.5, 0.5, rNorm, rNorm, rNorm);
  const grid = LbmVoxelizer.voxelize(config, { meshes: [sphere] });

  let solidCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === LbmCellType.ObstacleSolid) solidCount++;
  }

  const rCells = rNorm * 32;
  const expectedVolCells = (4 / 3) * Math.PI * rCells ** 3;
  const relErr = Math.abs(solidCount - expectedVolCells) / expectedVolCells;
  console.log(
    `  Sphere voxelized: ${solidCount} cells (analytical: ${expectedVolCells.toFixed(1)}, relErr=${(relErr * 100).toFixed(2)}%)`,
  );
  assert.ok(relErr < 0.08, `Sphere voxel volume error too large: ${(relErr * 100).toFixed(2)}%`);

  const deltaWall = LbmVoxelizer.computeWallDistances(config, { meshes: [sphere] }, grid);
  let curvedLinks = 0;
  for (let i = 0; i < deltaWall.length; i++) {
    const d = deltaWall[i]!;
    assert.ok(d >= 0.05 && d <= 0.95, `deltaWall out of bounds: ${d}`);
    if (Math.abs(d - 0.5) > 1e-3) curvedLinks++;
  }
  console.log(`  Sphere Bouzidi curved links computed: ${curvedLinks}`);
  assert.ok(curvedLinks > 100, `Expected >100 non-default curved Bouzidi links, got ${curvedLinks}`);
}

// 2. NACA 0012 extruded wing mesh immersion + LBM flow step
{
  const config: LbmGridConfig = {
    nx: 40,
    ny: 24,
    nz: 16,
    dx: 0.005,
    dt: 1e-4,
    tau: 0.6,
    density: 1.225,
    inletVelocity: [6.0, 0.0, 0.0],
    turbulenceModel: "smagorinsky_les",
    curvedBoundary: true,
  };

  const wing = createNaca0012WingMesh(0.25, 0.35, 0.5, 0.15, 0.85);
  const grid = LbmVoxelizer.voxelize(config, { meshes: [wing] });
  config.deltaWall = LbmVoxelizer.computeWallDistances(config, { meshes: [wing] }, grid);

  let wingCells = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === LbmCellType.ObstacleSolid) wingCells++;
  }
  assert.ok(wingCells > 30, `Expected NACA 0012 wing to occupy >30 cells, got ${wingCells}`);

  const runner = new WebGPULbmRunner(config, grid);
  const res = runner.step(15);
  assert.ok(Number.isFinite(res.aerodynamicForceN[0]), "Wing drag force must be finite");
  assert.ok(res.maxVelocity > 0 && res.maxVelocity < 30.0, `Wing maxVelocity unbounded: ${res.maxVelocity}`);
  console.log(
    `  ✓ NACA 0012 mesh (${wingCells} cells) immersed & simulated: Fx=${res.aerodynamicForceN[0].toFixed(4)}N, maxVel=${res.maxVelocity.toFixed(2)} m/s`,
  );
}

// 3. Mesh healing on dirty unwelded STL-style soup with degenerate zero-area triangles
{
  const config: LbmGridConfig = {
    nx: 32,
    ny: 32,
    nz: 32,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [4.0, 0.0, 0.0],
    curvedBoundary: true,
  };

  const rNorm = 0.2;
  const cleanSphere = createSphereMesh(0.5, 0.5, 0.5, rNorm, rNorm, rNorm);

  // Convert to an unwelded triangle soup (every triangle duplicates its 3 vertices with tiny <1e-7 jitter)
  const dirtyVerts: number[] = [];
  const dirtyInds: number[] = [];
  const numTris = cleanSphere.indices.length / 3;
  for (let t = 0; t < numTris; t++) {
    const baseVert = dirtyVerts.length / 3;
    for (let k = 0; k < 3; k++) {
      const vi = cleanSphere.indices[t * 3 + k]! * 3;
      const jitter = ((t + k) % 3 === 0 ? 1 : -1) * 1e-7;
      dirtyVerts.push(
        cleanSphere.vertices[vi]! + jitter,
        cleanSphere.vertices[vi + 1]! - jitter,
        cleanSphere.vertices[vi + 2]! + jitter,
      );
      dirtyInds.push(baseVert + k);
    }
  }

  // Inject degenerate zero-area triangles:
  // (a) collapsed triangle with coincident vertices
  const degBase1 = dirtyVerts.length / 3;
  dirtyVerts.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.5, 0.5);
  dirtyInds.push(degBase1, degBase1 + 1, degBase1 + 2);
  // (b) collinear zero-area triangle with distinct vertices
  const degBase2 = dirtyVerts.length / 3;
  dirtyVerts.push(0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.6, 0.5, 0.5);
  dirtyInds.push(degBase2, degBase2 + 1, degBase2 + 2);

  const dirtyMesh = {
    vertices: new Float32Array(dirtyVerts),
    indices: new Uint32Array(dirtyInds),
  };

  const healed = healTriangleMesh(dirtyMesh);
  console.log(
    `  Dirty mesh healed: weldedVertices=${healed.stats.weldedVertices}, removedDegenerateTris=${healed.stats.removedDegenerateTris}, boundaryEdges=${healed.stats.boundaryEdges}, isWatertight=${healed.stats.isWatertight}`,
  );
  assert.ok(healed.stats.weldedVertices > 0, `Expected weldedVertices > 0, got ${healed.stats.weldedVertices}`);
  assert.ok(
    healed.stats.removedDegenerateTris >= 2,
    `Expected removedDegenerateTris >= 2, got ${healed.stats.removedDegenerateTris}`,
  );
  assert.strictEqual(healed.stats.boundaryEdges, 0, `Expected 0 boundaryEdges, got ${healed.stats.boundaryEdges}`);
  assert.strictEqual(healed.stats.isWatertight, true, "Expected healed dirty sphere to be watertight");

  // Verify automatic healing inside LbmVoxelizer yields accurate voxelization & Bouzidi deltaWall
  const dirtyGrid = LbmVoxelizer.voxelize(config, { meshes: [dirtyMesh] });
  const cleanGrid = LbmVoxelizer.voxelize(config, { meshes: [cleanSphere] });

  let dirtySolid = 0;
  let cleanSolid = 0;
  for (let i = 0; i < dirtyGrid.length; i++) {
    if (dirtyGrid[i] === LbmCellType.ObstacleSolid) dirtySolid++;
    if (cleanGrid[i] === LbmCellType.ObstacleSolid) cleanSolid++;
  }
  const rCells = rNorm * 32;
  const expectedVolCells = (4 / 3) * Math.PI * rCells ** 3;
  const relErr = Math.abs(dirtySolid - expectedVolCells) / expectedVolCells;
  console.log(
    `  Dirty mesh voxelized: ${dirtySolid} cells (clean: ${cleanSolid}, analytical: ${expectedVolCells.toFixed(1)}, relErr=${(relErr * 100).toFixed(2)}%)`,
  );
  assert.ok(relErr < 0.08, `Dirty healed sphere voxel volume error too large: ${(relErr * 100).toFixed(2)}%`);
  assert.ok(
    Math.abs(dirtySolid - cleanSolid) <= 4,
    `Dirty healed sphere solid count (${dirtySolid}) diverged from clean sphere (${cleanSolid})`,
  );

  const deltaWall = LbmVoxelizer.computeWallDistances(config, { meshes: [dirtyMesh] }, dirtyGrid);
  let curvedLinks = 0;
  for (let i = 0; i < deltaWall.length; i++) {
    const d = deltaWall[i]!;
    assert.ok(d >= 0.05 && d <= 0.95, `Dirty mesh deltaWall out of bounds: ${d}`);
    if (Math.abs(d - 0.5) > 1e-3) curvedLinks++;
  }
  console.log(`  ✓ Dirty mesh Bouzidi curved links computed: ${curvedLinks}`);
  assert.ok(curvedLinks > 100, `Expected >100 curved Bouzidi links on healed dirty mesh, got ${curvedLinks}`);
}

// 4. Non-watertight mesh graceful handling (5-ray voting without throwing)
{
  const config: LbmGridConfig = {
    nx: 24,
    ny: 24,
    nz: 24,
    dx: 0.01,
    dt: 1e-4,
    tau: 0.65,
    density: 1.225,
    inletVelocity: [4.0, 0.0, 0.0],
    curvedBoundary: true,
  };

  const sphere = createSphereMesh(0.5, 0.5, 0.5, 0.25, 0.25, 0.25);
  // Drop a middle non-degenerate triangle to create an open hole (boundaryEdges > 0)
  const midTri = Math.floor(sphere.indices.length / 6) * 3;
  const openInds = new Uint32Array(sphere.indices.length - 3);
  openInds.set(sphere.indices.subarray(0, midTri), 0);
  openInds.set(sphere.indices.subarray(midTri + 3), midTri);
  const openMesh = { vertices: sphere.vertices, indices: openInds };

  const healedOpen = healTriangleMesh(openMesh);
  assert.ok(healedOpen.stats.boundaryEdges > 0, "Expected open mesh to have boundaryEdges > 0");
  assert.strictEqual(healedOpen.stats.isWatertight, false, "Expected open mesh to report isWatertight === false");

  const openGrid = LbmVoxelizer.voxelize(config, { meshes: [openMesh] });
  let openSolid = 0;
  for (let i = 0; i < openGrid.length; i++) {
    if (openGrid[i] === LbmCellType.ObstacleSolid) openSolid++;
  }
  const rCells = 0.25 * 24;
  const expectedVol = (4 / 3) * Math.PI * rCells ** 3;
  const relErr = Math.abs(openSolid - expectedVol) / expectedVol;
  console.log(
    `  ✓ Non-watertight mesh (boundaryEdges=${healedOpen.stats.boundaryEdges}) voxelized gracefully: ${openSolid} cells (relErr=${(relErr * 100).toFixed(2)}%)`,
  );
  assert.ok(relErr < 0.12, `Non-watertight 5-ray voting volume error too large: ${(relErr * 100).toFixed(2)}%`);
}

console.log("All CAD/STL triangle-mesh immersion tests passed!");
