// SPDX-License-Identifier: AGPL-3.0-or-later

export interface HilC99BranchSpec {
  fromNode: number;
  toNode: number;
  r: number;
  l: number;
  c: number;
}

export interface HilC99SwitchSpec {
  name?: string;
  fromNode: number;
  toNode: number;
  rOn: number;
  rOff: number;
}

export interface HilC99SourceSpec {
  node: number;
  amplitude: number;
  freqHz: number;
  phaseRad: number;
  rInternal: number;
}

export interface HilC99NetworkSpec {
  modelName: string;
  nNodes: number;
  dt: number;
  branches: HilC99BranchSpec[];
  switches: HilC99SwitchSpec[];
  sources: HilC99SourceSpec[];
}

export interface HilC99CodegenResult {
  modelName: string;
  cSource: string;
  numSwitchCombinations: number;
  nNodes: number;
  /** Flattened [numCombinations][nNodes * nNodes] row-major inverse conductance matrices */
  gInvLut: Float64Array[];
  branchConductances: Float64Array;
  branchGL: Float64Array;
  branchGC: Float64Array;
  branchAlphaL: Float64Array;
}

function sanitizeCIdentifier(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[a-zA-Z_]/.test(cleaned) ? cleaned : `msx_${cleaned}`;
}

/**
 * Inverts an N x N dense matrix in-place via Gauss-Jordan elimination with partial pivoting.
 */
function invertDenseMatrix(mat: Float64Array, n: number): Float64Array {
  const a = new Float64Array(mat);
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    inv[i * n + i] = 1.0;
  }

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(a[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(a[i * n + k]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }

    if (maxVal < 1e-15) {
      // Regularize isolated node
      a[k * n + k] = 1e-9;
      maxRow = k;
    }

    if (maxRow !== k) {
      for (let j = 0; j < n; j++) {
        const tmpA = a[k * n + j]!;
        a[k * n + j] = a[maxRow * n + j]!;
        a[maxRow * n + j] = tmpA;

        const tmpI = inv[k * n + j]!;
        inv[k * n + j] = inv[maxRow * n + j]!;
        inv[maxRow * n + j] = tmpI;
      }
    }

    const pivot = a[k * n + k]!;
    for (let j = 0; j < n; j++) {
      a[k * n + j] = a[k * n + j]! / pivot;
      inv[k * n + j] = inv[k * n + j]! / pivot;
    }

    for (let i = 0; i < n; i++) {
      if (i === k) continue;
      const factor = a[i * n + k]!;
      if (factor === 0.0) continue;
      for (let j = 0; j < n; j++) {
        a[i * n + j] = a[i * n + j]! - factor * a[k * n + j]!;
        inv[i * n + j] = inv[i * n + j]! - factor * inv[k * n + j]!;
      }
    }
  }

  return inv;
}

function stampConductance(G: Float64Array, n: number, fromNode: number, toNode: number, g: number): void {
  if (fromNode >= 0 && fromNode < n) {
    G[fromNode * n + fromNode] = G[fromNode * n + fromNode]! + g;
  }
  if (toNode >= 0 && toNode < n) {
    G[toNode * n + toNode] = G[toNode * n + toNode]! + g;
  }
  if (fromNode >= 0 && fromNode < n && toNode >= 0 && toNode < n) {
    G[fromNode * n + toNode] = G[fromNode * n + toNode]! - g;
    G[toNode * n + fromNode] = G[toNode * n + fromNode]! - g;
  }
}

/**
 * Generates a strictly deterministic, zero-heap-allocation (`-fno-malloc`) C99 source file
 * for Hardware-in-the-Loop (HIL) targets (dSPACE SCALEXIO, Speedgoat, NI VeriStand, Zynq RFSoC).
 *
 * Pre-computes the exact inverse nodal conductance matrix $G^{-1}(m)$ for all $2^{N_{\text{sw}}}$
 * switch combinations so that each real-time step executes a constant-instruction-count
 * matrix-vector product with zero runtime matrix factorization or branching.
 */
export function generateDeterministicHilC99(spec: HilC99NetworkSpec): HilC99CodegenResult {
  const modelName = sanitizeCIdentifier(spec.modelName);
  const n = Math.max(1, Math.floor(spec.nNodes));
  const dt = spec.dt;
  const nSw = spec.switches.length;
  if (nSw > 10) {
    throw new Error(`Pre-factored HIL G_INV_LUT supports up to 10 switches per subnetwork (got ${nSw})`);
  }
  const numCombinations = 1 << nSw;
  const nBranches = spec.branches.length;
  const nSources = spec.sources.length;

  // Compute trapezoidal RLC companion parameters matching wasm_emt.ts
  const branchConductances = new Float64Array(nBranches);
  const branchGL = new Float64Array(nBranches);
  const branchGC = new Float64Array(nBranches);
  const branchAlphaL = new Float64Array(nBranches);

  for (let b = 0; b < nBranches; b++) {
    const br = spec.branches[b]!;
    const r = br.r;
    const l = br.l;
    const c = br.c;
    let gTotal = 0.0;
    let gL = 0.0;
    let gC = 0.0;
    let alphaL = 0.0;

    if (l > 0.0) {
      const denom = r + (2.0 * l) / dt;
      gL = 1.0 / denom;
      alphaL = ((2.0 * l) / dt - r) / denom;
      gTotal += gL;
    } else if (r > 0.0) {
      gTotal += 1.0 / r;
    }

    if (c > 0.0) {
      gC = (2.0 * c) / dt;
      gTotal += gC;
    }

    branchConductances[b] = gTotal;
    branchGL[b] = gL;
    branchGC[b] = gC;
    branchAlphaL[b] = alphaL;
  }

  // Base conductance matrix (passive branches + source Norton conductances + tiny diagonal regularization)
  const gBase = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    gBase[i * n + i] = 1e-12;
  }
  for (let b = 0; b < nBranches; b++) {
    const br = spec.branches[b]!;
    stampConductance(gBase, n, br.fromNode, br.toNode, branchConductances[b]!);
  }
  for (let s = 0; s < nSources; s++) {
    const src = spec.sources[s]!;
    const gSrc = 1.0 / Math.max(1e-6, src.rInternal);
    stampConductance(gBase, n, src.node, -1, gSrc);
  }

  // Pre-compute G_INV_LUT for all 2^N_sw switch combinations
  const gInvLut: Float64Array[] = [];
  for (let mask = 0; mask < numCombinations; mask++) {
    const gMat = new Float64Array(gBase);
    for (let sw = 0; sw < nSw; sw++) {
      const swSpec = spec.switches[sw]!;
      const isClosed = ((mask >>> sw) & 1) === 1;
      const gSw = 1.0 / Math.max(1e-9, isClosed ? swSpec.rOn : swSpec.rOff);
      stampConductance(gMat, n, swSpec.fromNode, swSpec.toNode, gSw);
    }
    gInvLut.push(invertDenseMatrix(gMat, n));
  }

  // Format LUT initializer
  const lutRows: string[] = [];
  for (let mask = 0; mask < numCombinations; mask++) {
    const inv = gInvLut[mask]!;
    const matRows: string[] = [];
    for (let i = 0; i < n; i++) {
      const rowVals: string[] = [];
      for (let j = 0; j < n; j++) {
        rowVals.push(inv[i * n + j]!.toExponential(16));
      }
      matRows.push(`    { ${rowVals.join(", ")} }`);
    }
    lutRows.push(`  /* switch_mask = 0x${mask.toString(16).padStart(2, "0")} */\n  {\n${matRows.join(",\n")}\n  }`);
  }

  const branchFromArr = spec.branches.map((b) => b.fromNode).join(", ") || "0";
  const branchToArr = spec.branches.map((b) => b.toNode).join(", ") || "0";
  const branchGLArr = Array.from(branchGL, (v) => v.toExponential(16)).join(", ") || "0.0";
  const branchGCArr = Array.from(branchGC, (v) => v.toExponential(16)).join(", ") || "0.0";
  const branchAlphaLArr = Array.from(branchAlphaL, (v) => v.toExponential(16)).join(", ") || "0.0";

  const srcNodeArr = spec.sources.map((s) => s.node).join(", ") || "0";
  const srcAmpArr = spec.sources.map((s) => s.amplitude.toExponential(16)).join(", ") || "0.0";
  const srcOmegaArr = spec.sources.map((s) => (2.0 * Math.PI * s.freqHz).toExponential(16)).join(", ") || "0.0";
  const srcPhaseArr = spec.sources.map((s) => s.phaseRad.toExponential(16)).join(", ") || "0.0";
  const srcGArr = spec.sources.map((s) => (1.0 / Math.max(1e-6, s.rInternal)).toExponential(16)).join(", ") || "0.0";

  const nBranchesMacro = Math.max(1, nBranches);
  const nSourcesMacro = Math.max(1, nSources);

  const cSource = `/*
 * Auto-generated by ModelScript Deterministic Real-Time HIL C99 Codegen
 * Target: dSPACE SCALEXIO / Speedgoat / NI VeriStand / Zynq UltraScale+ RFSoC
 * Memory Model: Strictly Static (-fno-malloc), Zero Dynamic Allocation
 */
#include <stdint.h>
#include <math.h>

#if defined(__GNUC__) || defined(__clang__)
#pragma GCC poison malloc calloc realloc free
#endif

#define ${modelName.toUpperCase()}_N_NODES ${n}
#define ${modelName.toUpperCase()}_N_BRANCHES ${nBranches}
#define ${modelName.toUpperCase()}_N_SOURCES ${nSources}
#define ${modelName.toUpperCase()}_N_SWITCH_STATES ${numCombinations}
#define ${modelName.toUpperCase()}_DT (${dt.toExponential(16)})

typedef struct {
  double v_nodes[${modelName.toUpperCase()}_N_NODES];
  double i_hist_l[${nBranchesMacro}];
  double i_hist_c[${nBranchesMacro}];
  double v_branch_prev[${nBranchesMacro}];
  uint32_t switch_mask;
  uint64_t step_count;
} ${modelName}_hil_state_t;

static const double G_INV_LUT[${numCombinations}][${n}][${n}] = {
${lutRows.join(",\n")}
};

static const int32_t BRANCH_FROM[${nBranchesMacro}] = { ${branchFromArr} };
static const int32_t BRANCH_TO[${nBranchesMacro}] = { ${branchToArr} };
static const double BRANCH_G_L[${nBranchesMacro}] = { ${branchGLArr} };
static const double BRANCH_G_C[${nBranchesMacro}] = { ${branchGCArr} };
static const double BRANCH_ALPHA_L[${nBranchesMacro}] = { ${branchAlphaLArr} };

static const int32_t SRC_NODE[${nSourcesMacro}] = { ${srcNodeArr} };
static const double SRC_AMP[${nSourcesMacro}] = { ${srcAmpArr} };
static const double SRC_OMEGA[${nSourcesMacro}] = { ${srcOmegaArr} };
static const double SRC_PHASE[${nSourcesMacro}] = { ${srcPhaseArr} };
static const double SRC_G[${nSourcesMacro}] = { ${srcGArr} };

void ${modelName}_hil_init(${modelName}_hil_state_t * restrict state) {
  for (int i = 0; i < ${modelName.toUpperCase()}_N_NODES; ++i) {
    state->v_nodes[i] = 0.0;
  }
  for (int b = 0; b < ${nBranchesMacro}; ++b) {
    state->i_hist_l[b] = 0.0;
    state->i_hist_c[b] = 0.0;
    state->v_branch_prev[b] = 0.0;
  }
  state->switch_mask = 0u;
  state->step_count = 0ull;
}

void ${modelName}_hil_step(
  ${modelName}_hil_state_t * restrict state,
  uint32_t switch_mask,
  const double * restrict ext_i_inj
) {
  double b_rhs[${modelName.toUpperCase()}_N_NODES];
  const double t = (double)state->step_count * ${modelName.toUpperCase()}_DT;
  const uint32_t safe_mask = switch_mask & (${numCombinations - 1}u);
  state->switch_mask = safe_mask;

  for (int i = 0; i < ${modelName.toUpperCase()}_N_NODES; ++i) {
    b_rhs[i] = (ext_i_inj != (const double *)0) ? ext_i_inj[i] : 0.0;
  }

  for (int s = 0; s < ${modelName.toUpperCase()}_N_SOURCES; ++s) {
    const int32_t node = SRC_NODE[s];
    if (node >= 0 && node < ${modelName.toUpperCase()}_N_NODES) {
      const double v_src = (SRC_OMEGA[s] > 0.0)
        ? SRC_AMP[s] * sin(SRC_OMEGA[s] * t + SRC_PHASE[s])
        : SRC_AMP[s];
      b_rhs[node] += SRC_G[s] * v_src;
    }
  }

  for (int b = 0; b < ${modelName.toUpperCase()}_N_BRANCHES; ++b) {
    const int32_t fn = BRANCH_FROM[b];
    const int32_t tn = BRANCH_TO[b];
    const double i_hist = state->i_hist_l[b] + state->i_hist_c[b];
    if (fn >= 0 && fn < ${modelName.toUpperCase()}_N_NODES) {
      b_rhs[fn] -= i_hist;
    }
    if (tn >= 0 && tn < ${modelName.toUpperCase()}_N_NODES) {
      b_rhs[tn] += i_hist;
    }
  }

  /* Deterministic O(N^2) matrix-vector product with pre-factored G_INV_LUT */
  for (int i = 0; i < ${modelName.toUpperCase()}_N_NODES; ++i) {
    double acc = 0.0;
    for (int j = 0; j < ${modelName.toUpperCase()}_N_NODES; ++j) {
      acc += G_INV_LUT[safe_mask][i][j] * b_rhs[j];
    }
    state->v_nodes[i] = acc;
  }

  /* Update trapezoidal RLC companion history currents */
  for (int b = 0; b < ${modelName.toUpperCase()}_N_BRANCHES; ++b) {
    const int32_t fn = BRANCH_FROM[b];
    const int32_t tn = BRANCH_TO[b];
    const double vf = (fn >= 0 && fn < ${modelName.toUpperCase()}_N_NODES) ? state->v_nodes[fn] : 0.0;
    const double vt = (tn >= 0 && tn < ${modelName.toUpperCase()}_N_NODES) ? state->v_nodes[tn] : 0.0;
    const double v_br = vf - vt;
    const double v_prev = state->v_branch_prev[b];

    if (BRANCH_G_L[b] > 0.0) {
      const double i_l = BRANCH_G_L[b] * (v_br + v_prev) + BRANCH_ALPHA_L[b] * state->i_hist_l[b];
      state->i_hist_l[b] = BRANCH_ALPHA_L[b] * i_l + BRANCH_G_L[b] * v_br;
    }
    if (BRANCH_G_C[b] > 0.0) {
      const double i_c = BRANCH_G_C[b] * v_br + state->i_hist_c[b];
      state->i_hist_c[b] = -i_c - BRANCH_G_C[b] * v_br;
    }
    state->v_branch_prev[b] = v_br;
  }

  state->step_count += 1ull;
}
`;

  return {
    modelName,
    cSource,
    numSwitchCombinations: numCombinations,
    nNodes: n,
    gInvLut,
    branchConductances,
    branchGL,
    branchGC,
    branchAlphaL,
  };
}

// ============================================================================
// IEC 61850-9-2LE Sampled Values (SV) & GOOSE Ethernet Frame Serializers
// ============================================================================

export interface Iec61850SvAsduSample {
  /** Sampled Value ID (ASCII, e.g. "MU01") */
  svID: string;
  /** Sample counter (0..3999 for 50Hz 80smp/cycle, or 0..4799 for 60Hz) */
  smpCnt: number;
  /** Configuration revision (default 1) */
  confRev?: number;
  /** Clock synchronization state: 0 = none, 1 = local, 2 = global */
  smpSynch?: number;
  /** 3-phase + neutral currents in Amperes [Ia, Ib, Ic, In] */
  currentsAmp: [number, number, number, number];
  /** 3-phase + neutral voltages in Volts [Va, Vb, Vc, Vn] */
  voltagesVolt: [number, number, number, number];
}

export interface Iec61850SvFrameInput {
  dstMac?: [number, number, number, number, number, number];
  srcMac?: [number, number, number, number, number, number];
  appId?: number;
  asdu: Iec61850SvAsduSample;
}

/**
 * Encodes an IEC 61850-9-2LE Sampled Values (SV) Ethernet frame (`EtherType 0x88BA`)
 * into a binary `Uint8Array`.
 *
 * Uses standard 9-2LE scaling:
 * - Currents: $1\text{ mA} / \text{LSB}$ (`int32` big-endian) + 4-byte `uint32` quality (`0x00000000` Good)
 * - Voltages: $10\text{ mV} / \text{LSB}$ (`int32` big-endian) + 4-byte `uint32` quality (`0x00000000` Good)
 */
export function encodeIec61850SvFrame(input: Iec61850SvFrameInput): Uint8Array {
  const dstMac = input.dstMac ?? [0x01, 0x0c, 0xcd, 0x04, 0x00, 0x01];
  const srcMac = input.srcMac ?? [0x02, 0x00, 0x00, 0x00, 0x00, 0x01];
  const appId = input.appId ?? 0x4000;
  const { asdu } = input;
  const svIdBytes = new TextEncoder().encode(asdu.svID || "MU01");
  const confRev = asdu.confRev ?? 1;
  const smpSynch = asdu.smpSynch ?? 1;

  // Build inner ASDU TLV payload:
  // [0x80 len svID] [0x82 0x02 smpCnt] [0x83 0x04 confRev] [0x85 0x01 smpSynch] [0x87 0x40 64-byte PhsMeas1]
  const asduBodyLen = 2 + svIdBytes.length + 4 + 6 + 3 + (2 + 64);
  const seqAsduLen = 2 + asduBodyLen;
  const savPduLen = 3 + (2 + seqAsduLen); // noASDU (3 bytes) + seqASDU TLV
  const apduLen = 2 + savPduLen;
  const svHeaderPlusApduLen = 8 + apduLen; // APPID(2) + Length(2) + Res1(2) + Res2(2) + APDU
  const totalFrameLen = 14 + svHeaderPlusApduLen; // 14-byte Ethernet header (DstMAC 6 + SrcMAC 6 + EtherType 2)

  const buf = new Uint8Array(totalFrameLen);
  const view = new DataView(buf.buffer);
  let offset = 0;

  // Ethernet header
  for (let i = 0; i < 6; i++) buf[offset++] = dstMac[i]!;
  for (let i = 0; i < 6; i++) buf[offset++] = srcMac[i]!;
  view.setUint16(offset, 0x88ba, false); // EtherType: IEC 61850 SV
  offset += 2;

  // SV Header
  view.setUint16(offset, appId, false);
  offset += 2;
  view.setUint16(offset, svHeaderPlusApduLen, false);
  offset += 2;
  view.setUint16(offset, 0x0000, false); // Reserved 1
  offset += 2;
  view.setUint16(offset, 0x0000, false); // Reserved 2
  offset += 2;

  // savPdu (tag 0x60)
  buf[offset++] = 0x60;
  buf[offset++] = savPduLen;

  // noASDU (tag 0x80, len 1, value 1)
  buf[offset++] = 0x80;
  buf[offset++] = 0x01;
  buf[offset++] = 0x01;

  // seqASDU (tag 0xA2)
  buf[offset++] = 0xa2;
  buf[offset++] = seqAsduLen;

  // ASDU (tag 0x30)
  buf[offset++] = 0x30;
  buf[offset++] = asduBodyLen;

  // svID (tag 0x80)
  buf[offset++] = 0x80;
  buf[offset++] = svIdBytes.length;
  buf.set(svIdBytes, offset);
  offset += svIdBytes.length;

  // smpCnt (tag 0x82, len 2)
  buf[offset++] = 0x82;
  buf[offset++] = 0x02;
  view.setUint16(offset, asdu.smpCnt & 0xffff, false);
  offset += 2;

  // confRev (tag 0x83, len 4)
  buf[offset++] = 0x83;
  buf[offset++] = 0x04;
  view.setUint32(offset, confRev >>> 0, false);
  offset += 4;

  // smpSynch (tag 0x85, len 1)
  buf[offset++] = 0x85;
  buf[offset++] = 0x01;
  buf[offset++] = smpSynch & 0xff;

  // seqData / PhsMeas1 (tag 0x87, len 64)
  buf[offset++] = 0x87;
  buf[offset++] = 64;

  // 4 currents: 1 mA / LSB -> multiply Amperes by 1000
  for (let k = 0; k < 4; k++) {
    const iMilliAmp = Math.round(asdu.currentsAmp[k]! * 1000.0);
    view.setInt32(offset, iMilliAmp, false);
    offset += 4;
    view.setUint32(offset, 0x00000000, false); // Quality: Good
    offset += 4;
  }

  // 4 voltages: 10 mV / LSB -> multiply Volts by 100
  for (let k = 0; k < 4; k++) {
    const vTenMilliVolt = Math.round(asdu.voltagesVolt[k]! * 100.0);
    view.setInt32(offset, vTenMilliVolt, false);
    offset += 4;
    view.setUint32(offset, 0x00000000, false); // Quality: Good
    offset += 4;
  }

  return buf;
}

export interface DecodedIec61850SvFrame {
  etherType: number;
  appId: number;
  svID: string;
  smpCnt: number;
  confRev: number;
  smpSynch: number;
  currentsAmp: [number, number, number, number];
  voltagesVolt: [number, number, number, number];
}

/**
 * Decodes an IEC 61850-9-2LE Sampled Values Ethernet frame (`EtherType 0x88BA`).
 */
export function decodeIec61850SvFrame(frame: Uint8Array): DecodedIec61850SvFrame {
  if (frame.byteLength < 30) {
    throw new Error("IEC 61850-9-2LE frame too short");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = 12;
  let etherType = view.getUint16(offset, false);
  offset += 2;

  // Optional 802.1Q VLAN tag (0x8100)
  if (etherType === 0x8100) {
    offset += 2;
    etherType = view.getUint16(offset, false);
    offset += 2;
  }
  if (etherType !== 0x88ba) {
    throw new Error(`Invalid IEC 61850 SV EtherType: 0x${etherType.toString(16)}`);
  }

  const appId = view.getUint16(offset, false);
  offset += 8; // Skip APPID(2), Length(2), Res1(2), Res2(2)

  if (frame[offset] !== 0x60) {
    throw new Error(`Expected savPdu tag 0x60 at offset ${offset}`);
  }
  offset += 2; // savPdu tag + len

  // Walk savPdu children
  let svID = "";
  let smpCnt = 0;
  let confRev = 1;
  let smpSynch = 0;
  const currentsAmp: [number, number, number, number] = [0, 0, 0, 0];
  const voltagesVolt: [number, number, number, number] = [0, 0, 0, 0];

  while (offset < frame.byteLength) {
    const tag = frame[offset++]!;
    const len = frame[offset++]!;
    if (tag === 0xa2 || tag === 0x30) {
      // Container tags (seqASDU / ASDU): step inside
      continue;
    }
    if (tag === 0x80 && len > 1 && svID === "") {
      svID = new TextDecoder().decode(frame.subarray(offset, offset + len));
    } else if (tag === 0x82 && len === 2) {
      smpCnt = view.getUint16(offset, false);
    } else if (tag === 0x83 && len === 4) {
      confRev = view.getUint32(offset, false);
    } else if (tag === 0x85 && len === 1) {
      smpSynch = frame[offset]!;
    } else if (tag === 0x87 && len === 64) {
      let dataOff = offset;
      for (let k = 0; k < 4; k++) {
        currentsAmp[k] = view.getInt32(dataOff, false) / 1000.0;
        dataOff += 8;
      }
      for (let k = 0; k < 4; k++) {
        voltagesVolt[k] = view.getInt32(dataOff, false) / 100.0;
        dataOff += 8;
      }
    }
    offset += len;
  }

  return {
    etherType,
    appId,
    svID,
    smpCnt,
    confRev,
    smpSynch,
    currentsAmp,
    voltagesVolt,
  };
}

export interface Iec61850GooseFrameInput {
  dstMac?: [number, number, number, number, number, number];
  srcMac?: [number, number, number, number, number, number];
  appId?: number;
  gocbRef: string;
  datSet: string;
  goID: string;
  stNum: number;
  sqNum: number;
  timeAllowedToLiveMs?: number;
  breakerTrips: boolean[];
}

export interface DecodedIec61850GooseFrame {
  etherType: number;
  appId: number;
  gocbRef: string;
  datSet: string;
  goID: string;
  stNum: number;
  sqNum: number;
  timeAllowedToLiveMs: number;
  breakerTrips: boolean[];
}

/**
 * Encodes an IEC 61850 GOOSE (Generic Object Oriented Substation Event) Ethernet frame
 * (`EtherType 0x88B8`) carrying protection relay trip/close commands.
 */
export function encodeIec61850GooseFrame(input: Iec61850GooseFrameInput): Uint8Array {
  const dstMac = input.dstMac ?? [0x01, 0x0c, 0xcd, 0x01, 0x00, 0x01];
  const srcMac = input.srcMac ?? [0x02, 0x00, 0x00, 0x00, 0x00, 0x02];
  const appId = input.appId ?? 0x0001;
  const ttl = input.timeAllowedToLiveMs ?? 2000;

  const gocbBytes = new TextEncoder().encode(input.gocbRef);
  const datSetBytes = new TextEncoder().encode(input.datSet);
  const goIdBytes = new TextEncoder().encode(input.goID);
  const numEntries = input.breakerTrips.length;

  const allDataLen = numEntries * 3; // Each boolean: [0x83, 0x01, 0x01/0x00]
  const goosePduLen =
    2 +
    gocbBytes.length +
    6 + // ttl (0x81, len 4)
    (2 + datSetBytes.length) +
    (2 + goIdBytes.length) +
    6 + // stNum (0x85, len 4)
    6 + // sqNum (0x86, len 4)
    6 + // numDatSetEntries (0x8A, len 4)
    (2 + allDataLen);

  const apduLen = 2 + goosePduLen;
  const gooseHdrPlusApdu = 8 + apduLen;
  const totalLen = 14 + gooseHdrPlusApdu;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let offset = 0;

  for (let i = 0; i < 6; i++) buf[offset++] = dstMac[i]!;
  for (let i = 0; i < 6; i++) buf[offset++] = srcMac[i]!;
  view.setUint16(offset, 0x88b8, false); // EtherType: IEC 61850 GOOSE
  offset += 2;

  view.setUint16(offset, appId, false);
  offset += 2;
  view.setUint16(offset, gooseHdrPlusApdu, false);
  offset += 2;
  view.setUint16(offset, 0x0000, false);
  offset += 2;
  view.setUint16(offset, 0x0000, false);
  offset += 2;

  // goosePdu (tag 0x61)
  buf[offset++] = 0x61;
  buf[offset++] = goosePduLen;

  // gocbRef (0x80)
  buf[offset++] = 0x80;
  buf[offset++] = gocbBytes.length;
  buf.set(gocbBytes, offset);
  offset += gocbBytes.length;

  // timeAllowedtoLive (0x81)
  buf[offset++] = 0x81;
  buf[offset++] = 4;
  view.setUint32(offset, ttl >>> 0, false);
  offset += 4;

  // datSet (0x82)
  buf[offset++] = 0x82;
  buf[offset++] = datSetBytes.length;
  buf.set(datSetBytes, offset);
  offset += datSetBytes.length;

  // goID (0x83)
  buf[offset++] = 0x83;
  buf[offset++] = goIdBytes.length;
  buf.set(goIdBytes, offset);
  offset += goIdBytes.length;

  // stNum (0x85)
  buf[offset++] = 0x85;
  buf[offset++] = 4;
  view.setUint32(offset, input.stNum >>> 0, false);
  offset += 4;

  // sqNum (0x86)
  buf[offset++] = 0x86;
  buf[offset++] = 4;
  view.setUint32(offset, input.sqNum >>> 0, false);
  offset += 4;

  // numDatSetEntries (0x8A)
  buf[offset++] = 0x8a;
  buf[offset++] = 4;
  view.setUint32(offset, numEntries >>> 0, false);
  offset += 4;

  // allData (0xAB)
  buf[offset++] = 0xab;
  buf[offset++] = allDataLen;
  for (let i = 0; i < numEntries; i++) {
    buf[offset++] = 0x83; // boolean context tag
    buf[offset++] = 0x01;
    buf[offset++] = input.breakerTrips[i] ? 0x01 : 0x00;
  }

  return buf;
}

/**
 * Decodes an IEC 61850 GOOSE Ethernet frame (`EtherType 0x88B8`).
 */
export function decodeIec61850GooseFrame(frame: Uint8Array): DecodedIec61850GooseFrame {
  if (frame.byteLength < 26) {
    throw new Error("IEC 61850 GOOSE frame too short");
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = 12;
  let etherType = view.getUint16(offset, false);
  offset += 2;
  if (etherType === 0x8100) {
    offset += 2;
    etherType = view.getUint16(offset, false);
    offset += 2;
  }
  if (etherType !== 0x88b8) {
    throw new Error(`Invalid IEC 61850 GOOSE EtherType: 0x${etherType.toString(16)}`);
  }

  const appId = view.getUint16(offset, false);
  offset += 8;

  if (frame[offset] !== 0x61) {
    throw new Error(`Expected goosePdu tag 0x61 at offset ${offset}`);
  }
  offset += 2;

  let gocbRef = "";
  let datSet = "";
  let goID = "";
  let stNum = 0;
  let sqNum = 0;
  let timeAllowedToLiveMs = 0;
  const breakerTrips: boolean[] = [];

  while (offset < frame.byteLength) {
    const tag = frame[offset++]!;
    const len = frame[offset++]!;
    if (tag === 0x80) {
      gocbRef = new TextDecoder().decode(frame.subarray(offset, offset + len));
    } else if (tag === 0x81 && len === 4) {
      timeAllowedToLiveMs = view.getUint32(offset, false);
    } else if (tag === 0x82) {
      datSet = new TextDecoder().decode(frame.subarray(offset, offset + len));
    } else if (tag === 0x83 && goID === "") {
      goID = new TextDecoder().decode(frame.subarray(offset, offset + len));
    } else if (tag === 0x85 && len === 4) {
      stNum = view.getUint32(offset, false);
    } else if (tag === 0x86 && len === 4) {
      sqNum = view.getUint32(offset, false);
    } else if (tag === 0xab) {
      const endAllData = offset + len;
      let dOff = offset;
      while (dOff < endAllData) {
        const dTag = frame[dOff++]!;
        const dLen = frame[dOff++]!;
        if (dTag === 0x83 && dLen === 1) {
          breakerTrips.push(frame[dOff]! !== 0);
        }
        dOff += dLen;
      }
    }
    offset += len;
  }

  return {
    etherType,
    appId,
    gocbRef,
    datSet,
    goID,
    stNum,
    sqNum,
    timeAllowedToLiveMs,
    breakerTrips,
  };
}
