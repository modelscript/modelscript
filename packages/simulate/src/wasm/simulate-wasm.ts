// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TypeScript Bridge & Loader for `@modelscript/simulate`'s standalone AssemblyScript WASM kernel (`simulate.wasm`).
 *
 * Provides zero-overhead linear-memory access to:
 *  - Volumetric tetrahedral meshing, ray-cast surface voxelization, and tet4 quality metrics
 *  - One-sided Jacobi SVD, RBF/Kriging Gram matrix assembly, Cholesky solve, and SINDy STLSQ
 *  - Gillespie Direct Method SSA, Poisson Tau-Leaping, and Radau IIA coupled stage LU solver
 *  - Power Grid Y-bus assembly, AC Powerflow Newton-Raphson, and DC PTDF/LODF sensitivity matrices
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SimulateWasmExports {
  memory: WebAssembly.Memory;
  alloc(bytes: number): number;
  free(ptr: number): void;

  // Meshing
  mesh_createBoxCoords(
    nx: number,
    ny: number,
    nz: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    outCoordsPtr: number,
  ): void;
  mesh_createBoxTets(nx: number, ny: number, nz: number, outElemsPtr: number): number;
  mesh_voxelizeSurface(
    vertsPtr: number,
    indicesPtr: number,
    numTris: number,
    nx: number,
    ny: number,
    nz: number,
    minX: number,
    minY: number,
    minZ: number,
    dx: number,
    outGridPtr: number,
  ): number;
  mesh_tet4QualityMetrics(
    coordsPtr: number,
    elemsPtr: number,
    numElems: number,
    outVolPtr: number,
    outAspectPtr: number,
  ): number;
  mesh_promoteTet4ToTet10(
    coordsPtr: number,
    numNodes: number,
    elemsPtr: number,
    numElems: number,
    outQuadElemsPtr: number,
    outMidCoordsPtr: number,
    outEdgePairsPtr: number,
  ): number;
  mesh_earClip2D(uvPtr: number, ptIdsPtr: number, nVerts: number, outTrisPtr: number): number;
  opf_evalAcBalanceAndJac(
    nBus: number,
    gPtr: number,
    bPtr: number,
    vmPtr: number,
    vaPtr: number,
    outPPtr: number,
    outQPtr: number,
    outDPdVaPtr: number,
    outDPdVmPtr: number,
    outDQdVaPtr: number,
    outDQdVmPtr: number,
  ): void;

  // ROM / Surrogate / SINDy Linear Algebra
  rom_jacobiSvd(
    aPtr: number,
    m: number,
    n: number,
    uPtr: number,
    sPtr: number,
    vtPtr: number,
    maxSweeps: number,
  ): number;
  rom_rbfGramMatrix(
    xPtr: number,
    nSamples: number,
    dim: number,
    kernelKind: number,
    eps: number,
    nugget: number,
    outKPtr: number,
  ): void;
  rom_choleskySolve(aPtr: number, bPtr: number, n: number, outXPtr: number): number;
  rom_stlsq(
    thetaPtr: number,
    targetPtr: number,
    nSamples: number,
    nFeatures: number,
    threshold: number,
    ridgeAlpha: number,
    maxIter: number,
    outXiPtr: number,
  ): number;

  // Integrators & Stochastic Jump Processes
  ssa_seed(seed: bigint): void;
  ssa_gillespieTrajectory(
    nSpecies: number,
    nReactions: number,
    initStatePtr: number,
    ratesPtr: number,
    reactRowPtr: number,
    reactSpeciesPtr: number,
    reactOrderPtr: number,
    stoichRowPtr: number,
    stoichSpeciesPtr: number,
    stoichDeltaPtr: number,
    t0: number,
    tEnd: number,
    numOutputs: number,
    maxSteps: number,
    seed: bigint,
    outTimesPtr: number,
    outStatesPtr: number,
  ): number;
  ssa_tauLeapTrajectory(
    nSpecies: number,
    nReactions: number,
    initStatePtr: number,
    ratesPtr: number,
    reactRowPtr: number,
    reactSpeciesPtr: number,
    reactOrderPtr: number,
    stoichRowPtr: number,
    stoichSpeciesPtr: number,
    stoichDeltaPtr: number,
    t0: number,
    tEnd: number,
    tau: number,
    numOutputs: number,
    seed: bigint,
    outTimesPtr: number,
    outStatesPtr: number,
  ): number;
  radau_assembleAndSolveStage(
    s: number,
    n: number,
    h: number,
    butcherAPtr: number,
    jacPtr: number,
    massPtr: number,
    rhsPtr: number,
    outDeltaZPtr: number,
  ): number;

  // Power Grid
  grid_assembleYbus(
    nBus: number,
    nBranch: number,
    fromPtr: number,
    toPtr: number,
    rPtr: number,
    xPtr: number,
    bShuntPtr: number,
    tapPtr: number,
    shiftPtr: number,
    busGShuntPtr: number,
    busBShuntPtr: number,
    outGPtr: number,
    outBPtr: number,
  ): void;
  grid_acPowerflowNR(
    nBus: number,
    busTypePtr: number,
    gPtr: number,
    bPtr: number,
    pSpecPtr: number,
    qSpecPtr: number,
    vmPtr: number,
    vaPtr: number,
    tol: number,
    maxIter: number,
  ): number;
  grid_computePtdfLodf(
    nBus: number,
    nBranch: number,
    slackBus: number,
    fromPtr: number,
    toPtr: number,
    xPtr: number,
    outPtdfPtr: number,
    outLodfPtr: number,
  ): number;

  // Control Synthesis & Bifurcation Continuation
  ctrl_lyapunovSolve(aPtr: number, qPtr: number, n: number, outXPtr: number): number;
  ctrl_careNewton(
    aPtr: number,
    bPtr: number,
    qPtr: number,
    rPtr: number,
    n: number,
    m: number,
    maxIter: number,
    tol: number,
    outPPtr: number,
    outKPtr: number,
  ): number;
  palc_borderedSolve(
    jacPtr: number,
    dfdLambdaPtr: number,
    txPtr: number,
    tLambda: number,
    resPtr: number,
    arcRes: number,
    n: number,
    outSolPtr: number,
  ): number;

  // Harmonics, QSS1 & SDE Ensemble
  grid_harmonicsSolveOrder(
    nBus: number,
    gPtr: number,
    bPtr: number,
    iRePtr: number,
    iImPtr: number,
    outVRePtr: number,
    outVImPtr: number,
  ): number;
  qss1_integrateLinear(
    n: number,
    aPtr: number,
    bPtr: number,
    x0Ptr: number,
    dqPtr: number,
    t0: number,
    tEnd: number,
    maxEvents: number,
    outXPtr: number,
  ): number;
  sde_gbmEnsemble(
    nPaths: number,
    nSteps: number,
    dt: number,
    x0: number,
    mu: number,
    sigma: number,
    seed: bigint,
    outMeanPtr: number,
    outVarPtr: number,
  ): void;
}

let _cachedExports: SimulateWasmExports | null = null;
let _loadAttempted = false;

function resolveSimulateWasmPath(): string | null {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(dir, "simulate.wasm"),
      path.resolve(dir, "../../build/simulate.wasm"),
      path.resolve(dir, "../../dist/wasm/simulate.wasm"),
      path.resolve(dir, "../wasm/simulate.wasm"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } catch {
    // Browser environment
  }
  return null;
}

/**
 * Synchronously loads and caches `simulate.wasm` in Node environments.
 * Returns `null` if unavailable (e.g., browser before async init).
 */
export function getSimulateWasmSync(): SimulateWasmExports | null {
  if (_cachedExports) return _cachedExports;
  if (_loadAttempted) return null;
  _loadAttempted = true;

  const wasmPath = resolveSimulateWasmPath();
  if (!wasmPath) return null;

  try {
    const bytes = fs.readFileSync(wasmPath);
    const mod = new WebAssembly.Module(bytes);
    const inst = new WebAssembly.Instance(mod, {
      env: {
        abort: () => {
          throw new Error("[simulate.wasm] AssemblyScript abort");
        },
      },
    });
    _cachedExports = inst.exports as unknown as SimulateWasmExports;
    return _cachedExports;
  } catch {
    return null;
  }
}

/**
 * Asynchronously loads and caches `simulate.wasm` (works in both Node and browser).
 */
export async function initSimulateWasm(wasmBytes?: ArrayBuffer | Uint8Array): Promise<SimulateWasmExports | null> {
  if (_cachedExports) return _cachedExports;
  if (wasmBytes) {
    const res = await WebAssembly.instantiate(wasmBytes as BufferSource, {
      env: {
        abort: () => {
          throw new Error("[simulate.wasm] AssemblyScript abort");
        },
      },
    });
    const inst = "instance" in res ? res.instance : res;
    _cachedExports = inst.exports as unknown as SimulateWasmExports;
    _loadAttempted = true;
    return _cachedExports;
  }
  return getSimulateWasmSync();
}

// ─────────────────────────────────────────────────────────────────────────────
// High-Level Typed Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function wasmVoxelizeSurface(
  vertices: Float32Array,
  indices: Uint32Array,
  nx: number,
  ny: number,
  nz: number,
  minX: number,
  minY: number,
  minZ: number,
  dx: number,
): { grid: Uint8Array; solidCount: number } | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const numTris = Math.floor(indices.length / 3);
  const totalVoxels = nx * ny * nz;
  const vPtr = w.alloc(vertices.byteLength);
  const iPtr = w.alloc(indices.byteLength);
  const gPtr = w.alloc(totalVoxels);

  try {
    new Float32Array(w.memory.buffer, vPtr, vertices.length).set(vertices);
    new Uint32Array(w.memory.buffer, iPtr, indices.length).set(indices);
    const solidCount = w.mesh_voxelizeSurface(vPtr, iPtr, numTris, nx, ny, nz, minX, minY, minZ, dx, gPtr);
    const grid = new Uint8Array(totalVoxels);
    grid.set(new Uint8Array(w.memory.buffer, gPtr, totalVoxels));
    return { grid, solidCount };
  } finally {
    w.free(vPtr);
    w.free(iPtr);
    w.free(gPtr);
  }
}

export function wasmTet4QualityMetrics(
  coords: Float32Array,
  elements: Uint32Array,
): { volumes: Float64Array; aspectRatios: Float64Array; invertedCount: number } | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const numElems = Math.floor(elements.length / 4);
  const cPtr = w.alloc(coords.byteLength);
  const ePtr = w.alloc(elements.byteLength);
  const vPtr = w.alloc(numElems * 8);
  const aPtr = w.alloc(numElems * 8);

  try {
    new Float32Array(w.memory.buffer, cPtr, coords.length).set(coords);
    new Uint32Array(w.memory.buffer, ePtr, elements.length).set(elements);
    const invertedCount = w.mesh_tet4QualityMetrics(cPtr, ePtr, numElems, vPtr, aPtr);
    const volumes = new Float64Array(numElems);
    const aspectRatios = new Float64Array(numElems);
    volumes.set(new Float64Array(w.memory.buffer, vPtr, numElems));
    aspectRatios.set(new Float64Array(w.memory.buffer, aPtr, numElems));
    return { volumes, aspectRatios, invertedCount };
  } finally {
    w.free(cPtr);
    w.free(ePtr);
    w.free(vPtr);
    w.free(aPtr);
  }
}

export function wasmJacobiSvd(
  a: Float64Array,
  m: number,
  n: number,
  maxSweeps = 40,
): { U: Float64Array; S: Float64Array; Vt: Float64Array; sweeps: number } | null {
  const w = getSimulateWasmSync();
  if (!w || m < n || m <= 0 || n <= 0) return null;

  const aPtr = w.alloc(m * n * 8);
  const uPtr = w.alloc(m * n * 8);
  const sPtr = w.alloc(n * 8);
  const vtPtr = w.alloc(n * n * 8);

  try {
    new Float64Array(w.memory.buffer, aPtr, m * n).set(a);
    const sweeps = w.rom_jacobiSvd(aPtr, m, n, uPtr, sPtr, vtPtr, maxSweeps);
    const U = new Float64Array(m * n);
    const S = new Float64Array(n);
    const Vt = new Float64Array(n * n);
    U.set(new Float64Array(w.memory.buffer, uPtr, m * n));
    S.set(new Float64Array(w.memory.buffer, sPtr, n));
    Vt.set(new Float64Array(w.memory.buffer, vtPtr, n * n));
    return { U, S, Vt, sweeps };
  } finally {
    w.free(aPtr);
    w.free(uPtr);
    w.free(sPtr);
    w.free(vtPtr);
  }
}

export function wasmStlsq(
  theta: Float64Array,
  target: Float64Array,
  nSamples: number,
  nFeatures: number,
  threshold: number,
  ridgeAlpha = 1e-6,
  maxIter = 20,
): Float64Array | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const tPtr = w.alloc(nSamples * nFeatures * 8);
  const yPtr = w.alloc(nSamples * 8);
  const xiPtr = w.alloc(nFeatures * 8);

  try {
    new Float64Array(w.memory.buffer, tPtr, nSamples * nFeatures).set(theta);
    new Float64Array(w.memory.buffer, yPtr, nSamples).set(target);
    w.rom_stlsq(tPtr, yPtr, nSamples, nFeatures, threshold, ridgeAlpha, maxIter, xiPtr);
    const xi = new Float64Array(nFeatures);
    xi.set(new Float64Array(w.memory.buffer, xiPtr, nFeatures));
    return xi;
  } finally {
    w.free(tPtr);
    w.free(yPtr);
    w.free(xiPtr);
  }
}

export function wasmRadauStageSolve(
  s: number,
  n: number,
  h: number,
  butcherA: Float64Array,
  jac: Float64Array,
  rhs: Float64Array,
  mass?: Float64Array | null,
): Float64Array | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const sn = s * n;
  const aPtr = w.alloc(s * s * 8);
  const jPtr = w.alloc(n * n * 8);
  const mPtr = mass ? w.alloc(n * n * 8) : 0;
  const rPtr = w.alloc(sn * 8);
  const outPtr = w.alloc(sn * 8);

  try {
    new Float64Array(w.memory.buffer, aPtr, s * s).set(butcherA);
    new Float64Array(w.memory.buffer, jPtr, n * n).set(jac);
    if (mass && mPtr) new Float64Array(w.memory.buffer, mPtr, n * n).set(mass);
    new Float64Array(w.memory.buffer, rPtr, sn).set(rhs);
    const ok = w.radau_assembleAndSolveStage(s, n, h, aPtr, jPtr, mPtr, rPtr, outPtr);
    if (!ok) return null;
    const out = new Float64Array(sn);
    out.set(new Float64Array(w.memory.buffer, outPtr, sn));
    return out;
  } finally {
    w.free(aPtr);
    w.free(jPtr);
    if (mPtr) w.free(mPtr);
    w.free(rPtr);
    w.free(outPtr);
  }
}

export function wasmAcPowerflowNR(
  nBus: number,
  busTypes: Uint8Array,
  G: Float64Array,
  B: Float64Array,
  pSpec: Float64Array,
  qSpec: Float64Array,
  vmInit: Float64Array,
  vaInit: Float64Array,
  tol = 1e-8,
  maxIter = 30,
): { converged: boolean; iterations: number; vm: Float64Array; va: Float64Array } | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const nn = nBus * nBus;
  const btPtr = w.alloc(nBus);
  const gPtr = w.alloc(nn * 8);
  const bPtr = w.alloc(nn * 8);
  const pPtr = w.alloc(nBus * 8);
  const qPtr = w.alloc(nBus * 8);
  const vmPtr = w.alloc(nBus * 8);
  const vaPtr = w.alloc(nBus * 8);

  try {
    new Uint8Array(w.memory.buffer, btPtr, nBus).set(busTypes);
    new Float64Array(w.memory.buffer, gPtr, nn).set(G);
    new Float64Array(w.memory.buffer, bPtr, nn).set(B);
    new Float64Array(w.memory.buffer, pPtr, nBus).set(pSpec);
    new Float64Array(w.memory.buffer, qPtr, nBus).set(qSpec);
    new Float64Array(w.memory.buffer, vmPtr, nBus).set(vmInit);
    new Float64Array(w.memory.buffer, vaPtr, nBus).set(vaInit);

    const iters = w.grid_acPowerflowNR(nBus, btPtr, gPtr, bPtr, pPtr, qPtr, vmPtr, vaPtr, tol, maxIter);
    const vm = new Float64Array(nBus);
    const va = new Float64Array(nBus);
    vm.set(new Float64Array(w.memory.buffer, vmPtr, nBus));
    va.set(new Float64Array(w.memory.buffer, vaPtr, nBus));
    return { converged: iters > 0, iterations: iters > 0 ? iters : maxIter, vm, va };
  } finally {
    w.free(btPtr);
    w.free(gPtr);
    w.free(bPtr);
    w.free(pPtr);
    w.free(qPtr);
    w.free(vmPtr);
    w.free(vaPtr);
  }
}

export function wasmComputePtdfLodf(
  nBus: number,
  slackBus: number,
  fromBus: Int32Array,
  toBus: Int32Array,
  xBranch: Float64Array,
): { ptdf: Float64Array; lodf: Float64Array } | null {
  const w = getSimulateWasmSync();
  if (!w) return null;

  const nBranch = fromBus.length;
  const fPtr = w.alloc(nBranch * 4);
  const tPtr = w.alloc(nBranch * 4);
  const xPtr = w.alloc(nBranch * 8);
  const ptdfPtr = w.alloc(nBranch * nBus * 8);
  const lodfPtr = w.alloc(nBranch * nBranch * 8);

  try {
    new Int32Array(w.memory.buffer, fPtr, nBranch).set(fromBus);
    new Int32Array(w.memory.buffer, tPtr, nBranch).set(toBus);
    new Float64Array(w.memory.buffer, xPtr, nBranch).set(xBranch);
    const ok = w.grid_computePtdfLodf(nBus, nBranch, slackBus, fPtr, tPtr, xPtr, ptdfPtr, lodfPtr);
    if (!ok) return null;
    const ptdf = new Float64Array(nBranch * nBus);
    const lodf = new Float64Array(nBranch * nBranch);
    ptdf.set(new Float64Array(w.memory.buffer, ptdfPtr, nBranch * nBus));
    lodf.set(new Float64Array(w.memory.buffer, lodfPtr, nBranch * nBranch));
    return { ptdf, lodf };
  } finally {
    w.free(fPtr);
    w.free(tPtr);
    w.free(xPtr);
    w.free(ptdfPtr);
    w.free(lodfPtr);
  }
}

export function wasmRbfGramMatrix(
  X: Float64Array,
  nSamples: number,
  dim: number,
  kernelKind: number,
  eps: number,
  nugget = 1e-8,
): Float64Array | null {
  const w = getSimulateWasmSync();
  if (!w || nSamples <= 0 || dim <= 0) return null;

  const xPtr = w.alloc(nSamples * dim * 8);
  const kPtr = w.alloc(nSamples * nSamples * 8);
  try {
    new Float64Array(w.memory.buffer, xPtr, nSamples * dim).set(X);
    w.rom_rbfGramMatrix(xPtr, nSamples, dim, kernelKind, eps, nugget, kPtr);
    const K = new Float64Array(nSamples * nSamples);
    K.set(new Float64Array(w.memory.buffer, kPtr, nSamples * nSamples));
    return K;
  } finally {
    w.free(xPtr);
    w.free(kPtr);
  }
}

export function wasmCholeskySolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const w = getSimulateWasmSync();
  if (!w || n <= 0) return null;

  const aPtr = w.alloc(n * n * 8);
  const bPtr = w.alloc(n * 8);
  const xPtr = w.alloc(n * 8);
  try {
    new Float64Array(w.memory.buffer, aPtr, n * n).set(A);
    new Float64Array(w.memory.buffer, bPtr, n).set(b);
    const ok = w.rom_choleskySolve(aPtr, bPtr, n, xPtr);
    if (!ok) return null;
    const x = new Float64Array(n);
    x.set(new Float64Array(w.memory.buffer, xPtr, n));
    return x;
  } finally {
    w.free(aPtr);
    w.free(bPtr);
    w.free(xPtr);
  }
}

export function wasmCareNewton(
  A: Float64Array,
  B: Float64Array,
  Q: Float64Array,
  R: Float64Array,
  n: number,
  m: number,
  K0: Float64Array,
  maxIter = 30,
  tol = 1e-9,
): { P: Float64Array; K: Float64Array; iterations: number } | null {
  const w = getSimulateWasmSync();
  if (!w || n <= 0 || m <= 0) return null;

  const aPtr = w.alloc(n * n * 8);
  const bPtr = w.alloc(n * m * 8);
  const qPtr = w.alloc(n * n * 8);
  const rPtr = w.alloc(m * m * 8);
  const pPtr = w.alloc(n * n * 8);
  const kPtr = w.alloc(m * n * 8);
  try {
    new Float64Array(w.memory.buffer, aPtr, n * n).set(A);
    new Float64Array(w.memory.buffer, bPtr, n * m).set(B);
    new Float64Array(w.memory.buffer, qPtr, n * n).set(Q);
    new Float64Array(w.memory.buffer, rPtr, m * m).set(R);
    new Float64Array(w.memory.buffer, kPtr, m * n).set(K0);
    const iters = w.ctrl_careNewton(aPtr, bPtr, qPtr, rPtr, n, m, maxIter, tol, pPtr, kPtr);
    if (iters <= 0) return null;
    const P = new Float64Array(n * n);
    const K = new Float64Array(m * n);
    P.set(new Float64Array(w.memory.buffer, pPtr, n * n));
    K.set(new Float64Array(w.memory.buffer, kPtr, m * n));
    return { P, K, iterations: iters };
  } finally {
    w.free(aPtr);
    w.free(bPtr);
    w.free(qPtr);
    w.free(rPtr);
    w.free(pPtr);
    w.free(kPtr);
  }
}

export function wasmPalcBorderedSolve(
  jac: Float64Array,
  dfdLambda: Float64Array,
  tx: Float64Array,
  tLambda: number,
  res: Float64Array,
  arcRes: number,
  n: number,
): Float64Array | null {
  const w = getSimulateWasmSync();
  if (!w || n <= 0) return null;

  const jPtr = w.alloc(n * n * 8);
  const dlPtr = w.alloc(n * 8);
  const txPtr = w.alloc(n * 8);
  const rPtr = w.alloc(n * 8);
  const outPtr = w.alloc((n + 1) * 8);
  try {
    new Float64Array(w.memory.buffer, jPtr, n * n).set(jac);
    new Float64Array(w.memory.buffer, dlPtr, n).set(dfdLambda);
    new Float64Array(w.memory.buffer, txPtr, n).set(tx);
    new Float64Array(w.memory.buffer, rPtr, n).set(res);
    const ok = w.palc_borderedSolve(jPtr, dlPtr, txPtr, tLambda, rPtr, arcRes, n, outPtr);
    if (!ok) return null;
    const sol = new Float64Array(n + 1);
    sol.set(new Float64Array(w.memory.buffer, outPtr, n + 1));
    return sol;
  } finally {
    w.free(jPtr);
    w.free(dlPtr);
    w.free(txPtr);
    w.free(rPtr);
    w.free(outPtr);
  }
}

export function wasmHarmonicsSolveOrder(
  nBus: number,
  G: Float64Array,
  B: Float64Array,
  iRe: Float64Array,
  iIm: Float64Array,
): { vRe: Float64Array; vIm: Float64Array } | null {
  const w = getSimulateWasmSync();
  if (!w || nBus <= 0) return null;

  const nn = nBus * nBus;
  const gPtr = w.alloc(nn * 8);
  const bPtr = w.alloc(nn * 8);
  const irPtr = w.alloc(nBus * 8);
  const iiPtr = w.alloc(nBus * 8);
  const vrPtr = w.alloc(nBus * 8);
  const viPtr = w.alloc(nBus * 8);
  try {
    new Float64Array(w.memory.buffer, gPtr, nn).set(G);
    new Float64Array(w.memory.buffer, bPtr, nn).set(B);
    new Float64Array(w.memory.buffer, irPtr, nBus).set(iRe);
    new Float64Array(w.memory.buffer, iiPtr, nBus).set(iIm);
    const ok = w.grid_harmonicsSolveOrder(nBus, gPtr, bPtr, irPtr, iiPtr, vrPtr, viPtr);
    if (!ok) return null;
    const vRe = new Float64Array(nBus);
    const vIm = new Float64Array(nBus);
    vRe.set(new Float64Array(w.memory.buffer, vrPtr, nBus));
    vIm.set(new Float64Array(w.memory.buffer, viPtr, nBus));
    return { vRe, vIm };
  } finally {
    w.free(gPtr);
    w.free(bPtr);
    w.free(irPtr);
    w.free(iiPtr);
    w.free(vrPtr);
    w.free(viPtr);
  }
}

export function wasmPromoteTet4ToTet10(
  nodeCoords: Float32Array,
  numNodes: number,
  elements: Uint32Array,
  numElements: number,
): { quadCoords: Float32Array; quadElements: Uint32Array; edgePairs: Uint32Array; midCount: number } | null {
  const w = getSimulateWasmSync();
  if (!w || numElements <= 0) return null;

  const maxEdges = numElements * 6;
  const cPtr = w.alloc(nodeCoords.byteLength);
  const ePtr = w.alloc(elements.byteLength);
  const qPtr = w.alloc(numElements * 10 * 4);
  const mPtr = w.alloc(maxEdges * 3 * 4);
  const pPtr = w.alloc(maxEdges * 2 * 4);

  try {
    new Float32Array(w.memory.buffer, cPtr, nodeCoords.length).set(nodeCoords);
    new Uint32Array(w.memory.buffer, ePtr, elements.length).set(elements);
    const midCount = w.mesh_promoteTet4ToTet10(cPtr, numNodes, ePtr, numElements, qPtr, mPtr, pPtr);

    const totalNodes = numNodes + midCount;
    const quadCoords = new Float32Array(totalNodes * 3);
    quadCoords.set(nodeCoords, 0);
    quadCoords.set(new Float32Array(w.memory.buffer, mPtr, midCount * 3), numNodes * 3);

    const quadElements = new Uint32Array(numElements * 10);
    quadElements.set(new Uint32Array(w.memory.buffer, qPtr, numElements * 10));

    const edgePairs = new Uint32Array(midCount * 2);
    edgePairs.set(new Uint32Array(w.memory.buffer, pPtr, midCount * 2));

    return { quadCoords, quadElements, edgePairs, midCount };
  } finally {
    w.free(cPtr);
    w.free(ePtr);
    w.free(qPtr);
    w.free(mPtr);
    w.free(pPtr);
  }
}

export function wasmEarClip2D(uv: Float64Array, ptIds: Int32Array): Int32Array | null {
  const w = getSimulateWasmSync();
  const nVerts = ptIds.length;
  if (!w || nVerts < 3) return null;

  const uvPtr = w.alloc(nVerts * 2 * 8);
  const idPtr = w.alloc(nVerts * 4);
  const outPtr = w.alloc((nVerts - 2) * 3 * 4);
  try {
    new Float64Array(w.memory.buffer, uvPtr, nVerts * 2).set(uv);
    new Int32Array(w.memory.buffer, idPtr, nVerts).set(ptIds);
    const triCount = w.mesh_earClip2D(uvPtr, idPtr, nVerts, outPtr);
    const tris = new Int32Array(triCount * 3);
    if (triCount > 0) {
      tris.set(new Int32Array(w.memory.buffer, outPtr, triCount * 3));
    }
    return tris;
  } finally {
    w.free(uvPtr);
    w.free(idPtr);
    w.free(outPtr);
  }
}

export function wasmOpfEvalAcBalanceAndJac(
  nBus: number,
  G: Float64Array,
  B: Float64Array,
  vm: Float64Array,
  va: Float64Array,
): {
  P: Float64Array;
  Q: Float64Array;
  dPdVa: Float64Array;
  dPdVm: Float64Array;
  dQdVa: Float64Array;
  dQdVm: Float64Array;
} | null {
  const w = getSimulateWasmSync();
  if (!w || nBus <= 0) return null;

  const nn = nBus * nBus;
  const gPtr = w.alloc(nn * 8);
  const bPtr = w.alloc(nn * 8);
  const vmPtr = w.alloc(nBus * 8);
  const vaPtr = w.alloc(nBus * 8);
  const pPtr = w.alloc(nBus * 8);
  const qPtr = w.alloc(nBus * 8);
  const hPtr = w.alloc(nn * 8);
  const nPtr = w.alloc(nn * 8);
  const mPtr = w.alloc(nn * 8);
  const lPtr = w.alloc(nn * 8);

  try {
    new Float64Array(w.memory.buffer, gPtr, nn).set(G);
    new Float64Array(w.memory.buffer, bPtr, nn).set(B);
    new Float64Array(w.memory.buffer, vmPtr, nBus).set(vm);
    new Float64Array(w.memory.buffer, vaPtr, nBus).set(va);
    w.opf_evalAcBalanceAndJac(nBus, gPtr, bPtr, vmPtr, vaPtr, pPtr, qPtr, hPtr, nPtr, mPtr, lPtr);

    const P = new Float64Array(nBus);
    const Q = new Float64Array(nBus);
    const dPdVa = new Float64Array(nn);
    const dPdVm = new Float64Array(nn);
    const dQdVa = new Float64Array(nn);
    const dQdVm = new Float64Array(nn);
    P.set(new Float64Array(w.memory.buffer, pPtr, nBus));
    Q.set(new Float64Array(w.memory.buffer, qPtr, nBus));
    dPdVa.set(new Float64Array(w.memory.buffer, hPtr, nn));
    dPdVm.set(new Float64Array(w.memory.buffer, nPtr, nn));
    dQdVa.set(new Float64Array(w.memory.buffer, mPtr, nn));
    dQdVm.set(new Float64Array(w.memory.buffer, lPtr, nn));
    return { P, Q, dPdVa, dPdVm, dQdVa, dQdVm };
  } finally {
    w.free(gPtr);
    w.free(bPtr);
    w.free(vmPtr);
    w.free(vaPtr);
    w.free(pPtr);
    w.free(qPtr);
    w.free(hPtr);
    w.free(nPtr);
    w.free(mPtr);
    w.free(lPtr);
  }
}



