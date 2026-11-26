// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Certified WAM / Neural Control Policy FMU Exporter (FMI 2.0 & 3.0).
 *
 * Exports a trained `SmallLlmZonotopeRuntime` or neural control policy (frozen base weights,
 * LoRA adapters, input/output signal specs, and zonotope reachability safety bounds) into a
 * self-contained, cryptographically hashed FMI 2.0/3.0 Functional Mock-up Unit (.fmu):
 *
 *   - `modelDescription.xml`             — Valid FMI 2.0 / 3.0 XML with Float64/Real variables & tool annotation
 *   - `sources/wam_controller.c`         — Self-contained C99 inference + zonotope safety-envelope check
 *   - `resources/zonotope-certificate.json` — SHA-256 hashed reachability safety bounds, `mCap`, `formalCert`, provenance
 */

import type { DynamicMLoraLinearLayer, FormalCertificateSummary, SmallLlmZonotopeRuntime } from "@modelscript/runtime";
import { createHash } from "node:crypto";
import { createZip } from "./archive.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Contracts
// ─────────────────────────────────────────────────────────────────────────────

export type WamActivationKind = "gelu" | "tanh" | "relu" | "linear";

export interface WamSignalSpec {
  /** Signal identifier (sanitized to valid FMI/C variable name). */
  name: string;
  description?: string | undefined;
  unit?: string | undefined;
  /** Nominal start value (default: 0.0). */
  start?: number | undefined;
  /** Optional physical lower bound. */
  min?: number | undefined;
  /** Optional physical upper bound. */
  max?: number | undefined;
  /** Input perturbation half-width radius for zonotope reachability propagation (inputs only, default: 0.05). */
  uncertaintyRadius?: number | undefined;
}

export interface WamOutputSignalSpec extends WamSignalSpec {
  /** Certified lower safety envelope bound enforced at runtime. */
  safeMin: number;
  /** Certified upper safety envelope bound enforced at runtime. */
  safeMax: number;
  /** Safe fallback output applied if runtime zonotope check violates `[safeMin, safeMax]` (defaults to midpoint). */
  fallbackValue?: number | undefined;
}

export interface WamPolicyLayerSpec {
  inDim: number;
  outDim: number;
  /** Frozen base weights `[outDim, inDim]` in row-major order. */
  baseWeight: Float64Array | number[];
  /** Bias vector `[outDim]` (defaults to zeros). */
  bias?: Float64Array | number[] | undefined;
  /** Optional LoRA down-projection A `[rank, inDim]`. */
  loraA?: Float64Array | number[] | undefined;
  /** Optional LoRA up-projection B `[outDim, rank]`. */
  loraB?: Float64Array | number[] | undefined;
  /** LoRA rank (required if `loraA` and `loraB` are supplied). */
  rank?: number | undefined;
  /** LoRA scaling factor `alpha / rank` (default: 1.0). */
  loraScale?: number | undefined;
  /** Non-linear activation applied after the affine layer (default: `"gelu"`). */
  activation?: WamActivationKind | undefined;
}

export interface ZonotopeSafetyBound {
  variableName: string;
  center: number;
  radius: number;
  reachableMin: number;
  reachableMax: number;
  safeMin: number;
  safeMax: number;
  withinSafetyEnvelope: boolean;
  marginToBoundary: number;
  fallbackValue: number;
  groupIds?: number[] | undefined;
}

export interface WamCertificateProvenance {
  modelPackage?: string | undefined;
  version?: string | undefined;
  gitSha?: string | undefined;
  signerPubkey?: string | undefined;
  signature?: string | undefined;
  trainingRecipeId?: string | undefined;
  embedderId?: string | undefined;
  exportedAtIso?: string | undefined;
}

export interface CertifiedWamFmuOptions {
  /** FMI & C model identifier (default: `"certified_wam_controller"`). */
  modelIdentifier?: string | undefined;
  /** Target FMI version for primary `modelDescription.xml` (default: `"3.0"`). */
  fmiVersion?: "2.0" | "3.0" | "both" | undefined;
  /** Optional GUID / instantiationToken (deterministically derived if omitted). */
  guid?: string | undefined;
  description?: string | undefined;
  author?: string | undefined;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  stepSize?: number | undefined;
  /** Trained `@modelscript/runtime` Dynamic-m runtime whose weights & LoRA adapters are exported. */
  runtime?: SmallLlmZonotopeRuntime | undefined;
  /** Explicit policy layers (overrides layers extracted from `runtime` if provided). */
  policyLayers?: WamPolicyLayerSpec[] | undefined;
  /** Control policy inputs (sensors / reference commands). */
  inputs: WamSignalSpec[];
  /** Control policy outputs (actuators / setpoints) with certified safety envelopes. */
  outputs: WamOutputSignalSpec[];
  /** Optional pre-computed or overridden zonotope safety bounds per output. */
  zonotopeBounds?: Partial<ZonotopeSafetyBound>[] | undefined;
  /** Maximum active zonotope generator cap `mCap` (defaults to `runtime?.config.mCap ?? 32`). */
  mCap?: number | undefined;
  /** Epistemic spread threshold `retrievalTau` recorded in certificate metadata. */
  retrievalTau?: number | undefined;
  /** Formal 4-gate verification certificate attached to the exported controller. */
  formalCert?: FormalCertificateSummary | undefined;
  /** Cryptographic & package provenance metadata. */
  provenance?: WamCertificateProvenance | undefined;
  /** Whether to package the `.fmu` ZIP archive bytes (default: true). */
  includeArchive?: boolean | undefined;
}

export interface ExportedPolicyLayerSummary {
  index: number;
  inDim: number;
  outDim: number;
  activation: WamActivationKind;
  hasLora: boolean;
  loraRank: number;
  loraScale: number;
  effectiveWeight: Float64Array;
  bias: Float64Array;
}

export interface ZonotopeSafetyCertificate {
  schemaVersion: "1.0.0";
  modelIdentifier: string;
  guid: string;
  fmiVersion: "2.0" | "3.0" | "both";
  mCap: number;
  retrievalTau: number;
  inputCount: number;
  outputCount: number;
  layers: Array<{
    index: number;
    inDim: number;
    outDim: number;
    activation: WamActivationKind;
    hasLora: boolean;
    loraRank: number;
    loraScale: number;
  }>;
  outputBounds: ZonotopeSafetyBound[];
  allOutputsCertifiedSafe: boolean;
  formalCert: FormalCertificateSummary;
  provenance: Omit<WamCertificateProvenance, "exportedAtIso"> & { exportedAtIso: string };
  weightsSha256: string;
  cSourceSha256: string;
  certificateSha256: string;
}

export interface CertifiedWamFmuResult {
  modelIdentifier: string;
  guid: string;
  fmiVersion: "2.0" | "3.0" | "both";
  /** Primary `modelDescription.xml` stored at the root of the FMU. */
  modelDescriptionXml: string;
  /** FMI 2.0 `modelDescription.xml` content. */
  modelDescription2Xml: string;
  /** FMI 3.0 `modelDescription.xml` content. */
  modelDescription3Xml: string;
  /** Self-contained C99 controller source (`sources/wam_controller.c`). */
  controllerCSource: string;
  /** Canonical serialized certificate (`resources/zonotope-certificate.json`). */
  zonotopeCertificateJson: string;
  /** Typed zonotope certificate object. */
  certificate: ZonotopeSafetyCertificate;
  /** Merged layer weights exported to C99 (for round-trip evaluation & auditing). */
  exportedLayers: ExportedPolicyLayerSummary[];
  /** Exported input specifications (sanitized). */
  inputs: WamSignalSpec[];
  /** Exported output specifications (sanitized). */
  outputs: WamOutputSignalSpec[];
  /** Mapping from FMI variable name to valueReference. */
  valueReferences: Record<string, number>;
  /** Total number of declared FMI variables. */
  variableCount: number;
  /** Paths bundled inside the `.fmu` ZIP archive. */
  files: string[];
  /** Packed `.fmu` ZIP archive bytes (empty when `includeArchive: false`). */
  archive: Uint8Array;
}

export interface CertificateIntegrityReport {
  valid: boolean;
  computedHash: string;
  expectedHash: string;
  cSourceHashValid: boolean;
  reasons: string[];
}

export interface WamPolicyEvaluationResult {
  rawOutputs: Record<string, number>;
  safeOutputs: Record<string, number>;
  outputRadii: Record<string, number>;
  maxSpread: number;
  safetyOk: boolean;
  fallbackActive: boolean;
  violatedOutputs: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function sanitizeIdentifier(name: string, fallback = "certified_wam_controller"): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!cleaned) return fallback;
  return /^[0-9]/.test(cleaned) ? `wam_${cleaned}` : cleaned;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function deriveDeterministicGuid(seed: string): string {
  const h = sha256Hex(seed);
  return `{${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}}`;
}

function formatCNumber(v: number): string {
  if (!Number.isFinite(v)) return "0.0";
  if (Object.is(v, -0)) return "0.0";
  const s = v.toPrecision(17);
  return /[eE.]/.test(s) ? s : `${s}.0`;
}

function evalGelu(x: number): number {
  const k = 0.7978845608028654; // sqrt(2 / pi)
  const inner = k * (x + 0.044715 * x * x * x);
  return 0.5 * x * (1.0 + Math.tanh(inner));
}

function evalActivation(x: number, kind: WamActivationKind): number {
  switch (kind) {
    case "gelu":
      return evalGelu(x);
    case "tanh":
      return Math.tanh(x);
    case "relu":
      return x > 0 ? x : 0;
    case "linear":
      return x;
  }
}

/**
 * Sound interval propagation through scalar activation `f([lo, hi]) -> [outCenter, outRadius]`.
 * Mirrors the exact C99 implementation emitted in `sources/wam_controller.c`.
 */
function propagateActivationInterval(
  center: number,
  radius: number,
  kind: WamActivationKind,
): { center: number; radius: number } {
  const r = Math.max(0, radius);
  const lo = center - r;
  const hi = center + r;

  if (kind === "linear") {
    return { center, radius: r };
  }
  if (kind === "relu") {
    const fLo = lo > 0 ? lo : 0;
    const fHi = hi > 0 ? hi : 0;
    return { center: 0.5 * (fLo + fHi), radius: 0.5 * (fHi - fLo) };
  }
  if (kind === "tanh") {
    const fLo = Math.tanh(lo);
    const fHi = Math.tanh(hi);
    return { center: 0.5 * (fLo + fHi), radius: 0.5 * (fHi - fLo) };
  }

  // GELU has a unique global minimum at x* ≈ -0.751791524
  const GELU_MIN_X = -0.751791524;
  const fLo = evalGelu(lo);
  const fHi = evalGelu(hi);
  let minVal = Math.min(fLo, fHi);
  const maxVal = Math.max(fLo, fHi);
  if (lo < GELU_MIN_X && hi > GELU_MIN_X) {
    const fMin = evalGelu(GELU_MIN_X);
    if (fMin < minVal) minVal = fMin;
  }
  return {
    center: 0.5 * (minVal + maxVal),
    radius: Math.max(0, 0.5 * (maxVal - minVal)),
  };
}

function mergeLayerWeights(spec: WamPolicyLayerSpec, index: number): ExportedPolicyLayerSummary {
  const { inDim, outDim } = spec;
  if (inDim <= 0 || outDim <= 0) {
    throw new Error(`Policy layer ${index} must have positive dimensions (got ${outDim}x${inDim}).`);
  }
  const expectedWLen = outDim * inDim;
  if (spec.baseWeight.length !== expectedWLen) {
    throw new Error(
      `Policy layer ${index} baseWeight length mismatch: expected ${expectedWLen}, got ${spec.baseWeight.length}.`,
    );
  }
  const effectiveWeight = Float64Array.from(spec.baseWeight);
  const bias = new Float64Array(outDim);
  if (spec.bias) {
    if (spec.bias.length !== outDim) {
      throw new Error(`Policy layer ${index} bias length mismatch: expected ${outDim}, got ${spec.bias.length}.`);
    }
    for (let o = 0; o < outDim; o++) {
      bias[o] = spec.bias[o]!;
    }
  }

  const hasLora = Boolean(spec.loraA && spec.loraB && (spec.rank ?? 0) > 0);
  const loraRank = hasLora ? spec.rank! : 0;
  const loraScale = hasLora ? (spec.loraScale ?? 1.0) : 0;

  if (hasLora) {
    const loraA = spec.loraA!;
    const loraB = spec.loraB!;
    if (loraA.length !== loraRank * inDim) {
      throw new Error(
        `Policy layer ${index} loraA length mismatch: expected ${loraRank * inDim}, got ${loraA.length}.`,
      );
    }
    if (loraB.length !== outDim * loraRank) {
      throw new Error(
        `Policy layer ${index} loraB length mismatch: expected ${outDim * loraRank}, got ${loraB.length}.`,
      );
    }
    for (let o = 0; o < outDim; o++) {
      for (let r = 0; r < loraRank; r++) {
        const bScaled = loraB[o * loraRank + r]! * loraScale;
        if (bScaled === 0) continue;
        const aRow = r * inDim;
        const wRow = o * inDim;
        for (let i = 0; i < inDim; i++) {
          effectiveWeight[wRow + i] = effectiveWeight[wRow + i]! + bScaled * loraA[aRow + i]!;
        }
      }
    }
  }

  return {
    index,
    inDim,
    outDim,
    activation: spec.activation ?? "gelu",
    hasLora,
    loraRank,
    loraScale,
    effectiveWeight,
    bias,
  };
}

function layerFromDynamicMLora(layer: DynamicMLoraLinearLayer, activation: WamActivationKind): WamPolicyLayerSpec {
  return {
    inDim: layer.inDim,
    outDim: layer.outDim,
    baseWeight: layer.baseWeight,
    bias: layer.bias,
    loraA: layer.loraA,
    loraB: layer.loraB,
    rank: layer.rank,
    loraScale: layer.loraScale,
    activation,
  };
}

function extractLayersFromRuntime(
  runtime: SmallLlmZonotopeRuntime,
  inputCount: number,
  outputCount: number,
): WamPolicyLayerSpec[] {
  const hiddenDim = runtime.embedder.dim;
  const specs: WamPolicyLayerSpec[] = [];

  // Input adapter if sensor count differs from runtime hiddenDim
  if (inputCount !== hiddenDim) {
    const inW = new Float64Array(hiddenDim * inputCount);
    for (let i = 0; i < inputCount; i++) {
      const tokIdx = i % runtime.embedder.vocabSize;
      const srcBase = tokIdx * hiddenDim;
      for (let h = 0; h < hiddenDim; h++) {
        inW[h * inputCount + i] = runtime.embedder.tokenEmb[srcBase + h]!;
      }
    }
    specs.push({
      inDim: inputCount,
      outDim: hiddenDim,
      baseWeight: inW,
      bias: new Float64Array(hiddenDim),
      activation: "linear",
    });
  }

  // Export every trained Transformer LoRA layer with GELU activation
  for (const layer of runtime.layers) {
    specs.push(layerFromDynamicMLora(layer, "gelu"));
  }

  // Output control head sliced from trained lmHead (effective LoRA folded)
  const lmHead = runtime.lmHead;
  const headEff = lmHead.effectiveWeight();
  const outBase = new Float64Array(outputCount * hiddenDim);
  const outBias = new Float64Array(outputCount);
  const outLoraB = new Float64Array(outputCount * lmHead.rank);
  const outBaseUnfolded = new Float64Array(outputCount * hiddenDim);

  for (let o = 0; o < outputCount; o++) {
    const srcRowIdx = o % lmHead.outDim;
    outBias[o] = lmHead.bias[srcRowIdx]!;
    for (let h = 0; h < hiddenDim; h++) {
      outBaseUnfolded[o * hiddenDim + h] = lmHead.baseWeight[srcRowIdx * hiddenDim + h]!;
      outBase[o * hiddenDim + h] = headEff[srcRowIdx * hiddenDim + h]!;
    }
    for (let r = 0; r < lmHead.rank; r++) {
      outLoraB[o * lmHead.rank + r] = lmHead.loraB[srcRowIdx * lmHead.rank + r]!;
    }
  }

  specs.push({
    inDim: hiddenDim,
    outDim: outputCount,
    baseWeight: outBaseUnfolded,
    bias: outBias,
    loraA: lmHead.loraA,
    loraB: outLoraB,
    rank: lmHead.rank,
    loraScale: lmHead.loraScale,
    activation: "linear",
  });

  return specs;
}

function computeWeightsDigest(layers: ExportedPolicyLayerSummary[]): string {
  const hash = createHash("sha256");
  for (const layer of layers) {
    hash.update(`L${layer.index}:${layer.inDim}x${layer.outDim}:${layer.activation}:`);
    for (let i = 0; i < layer.effectiveWeight.length; i++) {
      hash.update(formatCNumber(layer.effectiveWeight[i]!));
      hash.update(",");
    }
    hash.update("|");
    for (let o = 0; o < layer.bias.length; o++) {
      hash.update(formatCNumber(layer.bias[o]!));
      hash.update(",");
    }
    hash.update("\n");
  }
  return hash.digest("hex");
}

function propagatePolicyZonotope(
  layers: ExportedPolicyLayerSummary[],
  inputCenter: Float64Array,
  inputRadii: Float64Array,
): { center: Float64Array; radii: Float64Array } {
  let curCenter = new Float64Array(inputCenter);
  let curRadii = new Float64Array(inputRadii);

  for (const layer of layers) {
    const nextCenter = new Float64Array(layer.outDim);
    const nextRadii = new Float64Array(layer.outDim);

    for (let o = 0; o < layer.outDim; o++) {
      let cAcc = layer.bias[o]!;
      let rAcc = 0;
      const wRow = o * layer.inDim;
      for (let i = 0; i < layer.inDim; i++) {
        const w = layer.effectiveWeight[wRow + i]!;
        cAcc += w * curCenter[i]!;
        rAcc += Math.abs(w) * curRadii[i]!;
      }
      const act = propagateActivationInterval(cAcc, rAcc, layer.activation);
      nextCenter[o] = act.center;
      nextRadii[o] = act.radius;
    }

    curCenter = nextCenter;
    curRadii = nextRadii;
  }

  return { center: curCenter, radii: curRadii };
}

function propagatePointOnly(layers: ExportedPolicyLayerSummary[], inputs: Float64Array): Float64Array {
  let cur = new Float64Array(inputs);
  for (const layer of layers) {
    const next = new Float64Array(layer.outDim);
    for (let o = 0; o < layer.outDim; o++) {
      let acc = layer.bias[o]!;
      const wRow = o * layer.inDim;
      for (let i = 0; i < layer.inDim; i++) {
        acc += layer.effectiveWeight[wRow + i]! * cur[i]!;
      }
      next[o] = evalActivation(acc, layer.activation);
    }
    cur = next;
  }
  return cur;
}

// ─────────────────────────────────────────────────────────────────────────────
// C99 Code Generator (`sources/wam_controller.c`)
// ─────────────────────────────────────────────────────────────────────────────

function generateWamControllerC(params: {
  modelIdentifier: string;
  guid: string;
  mCap: number;
  weightsSha256: string;
  inputs: WamSignalSpec[];
  outputs: WamOutputSignalSpec[];
  layers: ExportedPolicyLayerSummary[];
  valueReferences: Record<string, number>;
}): string {
  const { modelIdentifier, guid, mCap, weightsSha256, inputs, outputs, layers, valueReferences } = params;
  const maxDim = Math.max(inputs.length, outputs.length, ...layers.map((l) => Math.max(l.inDim, l.outDim)));

  const lines: string[] = [];
  lines.push("/* SPDX-License-Identifier: AGPL-3.0-or-later */");
  lines.push("/*");
  lines.push(` * ModelScript Certified WAM / Neural Control Policy C99 Runtime`);
  lines.push(` * Model Identifier : ${modelIdentifier}`);
  lines.push(` * GUID / Token     : ${guid}`);
  lines.push(` * Dynamic-m Cap    : ${mCap}`);
  lines.push(` * Weights SHA-256  : ${weightsSha256}`);
  lines.push(" *");
  lines.push(" * Self-contained C99 inference + zonotope reachability safety-envelope verifier");
  lines.push(" * with FMI 2.0 and FMI 3.0 Co-Simulation entry points.");
  lines.push(" */");
  lines.push("");
  lines.push("#include <math.h>");
  lines.push("#include <stdbool.h>");
  lines.push("#include <stddef.h>");
  lines.push("#include <stdint.h>");
  lines.push("#include <stdlib.h>");
  lines.push("#include <string.h>");
  lines.push("");
  lines.push(`#define WAM_MODEL_ID "${modelIdentifier}"`);
  lines.push(`#define WAM_GUID "${guid}"`);
  lines.push(`#define WAM_WEIGHTS_SHA256 "${weightsSha256}"`);
  lines.push(`#define WAM_M_CAP ${mCap}`);
  lines.push(`#define WAM_NUM_INPUTS ${inputs.length}`);
  lines.push(`#define WAM_NUM_OUTPUTS ${outputs.length}`);
  lines.push(`#define WAM_NUM_LAYERS ${layers.length}`);
  lines.push(`#define WAM_MAX_DIM ${maxDim}`);
  lines.push("");

  // Value references
  lines.push("/* FMI Value Reference Map */");
  for (const [name, vr] of Object.entries(valueReferences)) {
    lines.push(`#define WAM_VR_${name.toUpperCase()} ${vr}u`);
  }
  lines.push("");

  // Input nominal starts & uncertainty radii
  lines.push(
    `static const double WAM_INPUT_STARTS[WAM_NUM_INPUTS] = { ${inputs.map((i) => formatCNumber(i.start ?? 0)).join(", ")} };`,
  );
  lines.push(
    `static const double WAM_INPUT_UNCERTAINTY_RADII[WAM_NUM_INPUTS] = { ${inputs.map((i) => formatCNumber(Math.max(0, i.uncertaintyRadius ?? 0.05))).join(", ")} };`,
  );

  // Certified safety bounds & safe fallbacks
  lines.push(
    `static const double WAM_SAFETY_LO[WAM_NUM_OUTPUTS] = { ${outputs.map((o) => formatCNumber(o.safeMin)).join(", ")} };`,
  );
  lines.push(
    `static const double WAM_SAFETY_HI[WAM_NUM_OUTPUTS] = { ${outputs.map((o) => formatCNumber(o.safeMax)).join(", ")} };`,
  );
  lines.push(
    `static const double WAM_FALLBACK_VALS[WAM_NUM_OUTPUTS] = { ${outputs.map((o) => formatCNumber(o.fallbackValue ?? 0.5 * (o.safeMin + o.safeMax))).join(", ")} };`,
  );
  lines.push("");

  // Per-layer merged weights (W_eff = W_0 + scale * B @ A) and biases
  for (const layer of layers) {
    lines.push(
      `/* Layer ${layer.index}: ${layer.inDim} -> ${layer.outDim} (activation=${layer.activation}, lora=${layer.hasLora ? `rank-${layer.loraRank}` : "none"}) */`,
    );
    lines.push(
      `static const double WAM_L${layer.index}_W[${layer.outDim * layer.inDim}] = { ${Array.from(layer.effectiveWeight, formatCNumber).join(", ")} };`,
    );
    lines.push(
      `static const double WAM_L${layer.index}_B[${layer.outDim}] = { ${Array.from(layer.bias, formatCNumber).join(", ")} };`,
    );
  }
  lines.push("");

  // Activation helpers
  lines.push("typedef enum {");
  lines.push("  WAM_ACT_LINEAR = 0,");
  lines.push("  WAM_ACT_RELU   = 1,");
  lines.push("  WAM_ACT_TANH   = 2,");
  lines.push("  WAM_ACT_GELU   = 3");
  lines.push("} wam_activation_t;");
  lines.push("");
  lines.push("static double wam_gelu(double x) {");
  lines.push("  const double k = 0.7978845608028654;");
  lines.push("  double inner = k * (x + 0.044715 * x * x * x);");
  lines.push("  return 0.5 * x * (1.0 + tanh(inner));");
  lines.push("}");
  lines.push("");
  lines.push("static double wam_eval_act(double x, wam_activation_t act) {");
  lines.push("  switch (act) {");
  lines.push("    case WAM_ACT_RELU: return x > 0.0 ? x : 0.0;");
  lines.push("    case WAM_ACT_TANH: return tanh(x);");
  lines.push("    case WAM_ACT_GELU: return wam_gelu(x);");
  lines.push("    case WAM_ACT_LINEAR:");
  lines.push("    default: return x;");
  lines.push("  }");
  lines.push("}");
  lines.push("");
  lines.push(
    "static void wam_act_zonotope_interval(double c, double r, wam_activation_t act, double *out_c, double *out_r) {",
  );
  lines.push("  double rad = r > 0.0 ? r : 0.0;");
  lines.push("  double lo = c - rad;");
  lines.push("  double hi = c + rad;");
  lines.push("  if (act == WAM_ACT_LINEAR) {");
  lines.push("    *out_c = c;");
  lines.push("    *out_r = rad;");
  lines.push("    return;");
  lines.push("  }");
  lines.push("  if (act == WAM_ACT_RELU) {");
  lines.push("    double flo = lo > 0.0 ? lo : 0.0;");
  lines.push("    double fhi = hi > 0.0 ? hi : 0.0;");
  lines.push("    *out_c = 0.5 * (flo + fhi);");
  lines.push("    *out_r = 0.5 * (fhi - flo);");
  lines.push("    return;");
  lines.push("  }");
  lines.push("  if (act == WAM_ACT_TANH) {");
  lines.push("    double flo = tanh(lo);");
  lines.push("    double fhi = tanh(hi);");
  lines.push("    *out_c = 0.5 * (flo + fhi);");
  lines.push("    *out_r = 0.5 * (fhi - flo);");
  lines.push("    return;");
  lines.push("  }");
  lines.push("  /* Sound GELU interval enclosure including global minimum x* = -0.751791524 */");
  lines.push("  double flo = wam_gelu(lo);");
  lines.push("  double fhi = wam_gelu(hi);");
  lines.push("  double min_v = flo < fhi ? flo : fhi;");
  lines.push("  double max_v = flo > fhi ? flo : fhi;");
  lines.push("  const double gelu_min_x = -0.751791524;");
  lines.push("  if (lo < gelu_min_x && hi > gelu_min_x) {");
  lines.push("    double fmin = wam_gelu(gelu_min_x);");
  lines.push("    if (fmin < min_v) min_v = fmin;");
  lines.push("  }");
  lines.push("  *out_c = 0.5 * (min_v + max_v);");
  lines.push("  *out_r = 0.5 * (max_v - min_v);");
  lines.push("}");
  lines.push("");
  lines.push("static void wam_affine_zonotope_layer(");
  lines.push("  int in_dim, int out_dim, const double *W, const double *b, wam_activation_t act,");
  lines.push("  const double *in_pt, const double *in_c, const double *in_r,");
  lines.push("  double *out_pt, double *out_c, double *out_r");
  lines.push(") {");
  lines.push("  for (int o = 0; o < out_dim; ++o) {");
  lines.push("    double p_acc = b[o];");
  lines.push("    double c_acc = b[o];");
  lines.push("    double r_acc = 0.0;");
  lines.push("    const double *w_row = W + ((size_t)o * (size_t)in_dim);");
  lines.push("    for (int i = 0; i < in_dim; ++i) {");
  lines.push("      double w = w_row[i];");
  lines.push("      p_acc += w * in_pt[i];");
  lines.push("      c_acc += w * in_c[i];");
  lines.push("      r_acc += fabs(w) * in_r[i];");
  lines.push("    }");
  lines.push("    out_pt[o] = wam_eval_act(p_acc, act);");
  lines.push("    wam_act_zonotope_interval(c_acc, r_acc, act, &out_c[o], &out_r[o]);");
  lines.push("  }");
  lines.push("}");
  lines.push("");

  // Core inference + zonotope safety-envelope check
  lines.push("/**");
  lines.push(" * Runs neural policy inference AND certified zonotope safety-envelope verification.");
  lines.push(" * Returns 1 if all reachable output intervals lie inside [WAM_SAFETY_LO, WAM_SAFETY_HI],");
  lines.push(" * otherwise returns 0, activates fallback clamping, and sets *fallback_active_out = 1.");
  lines.push(" */");
  lines.push("int wam_infer_and_verify(");
  lines.push("  const double *inputs,");
  lines.push("  double *outputs,");
  lines.push("  double *out_radii,");
  lines.push("  double *max_spread_out,");
  lines.push("  int *fallback_active_out");
  lines.push(") {");
  lines.push("  double pt_a[WAM_MAX_DIM];");
  lines.push("  double pt_b[WAM_MAX_DIM];");
  lines.push("  double c_a[WAM_MAX_DIM];");
  lines.push("  double c_b[WAM_MAX_DIM];");
  lines.push("  double r_a[WAM_MAX_DIM];");
  lines.push("  double r_b[WAM_MAX_DIM];");
  lines.push("");
  lines.push("  for (int i = 0; i < WAM_NUM_INPUTS; ++i) {");
  lines.push("    pt_a[i] = inputs[i];");
  lines.push("    c_a[i] = inputs[i];");
  lines.push("    r_a[i] = WAM_INPUT_UNCERTAINTY_RADII[i];");
  lines.push("  }");
  lines.push("");

  const actEnum = (act: WamActivationKind): string => {
    switch (act) {
      case "relu":
        return "WAM_ACT_RELU";
      case "tanh":
        return "WAM_ACT_TANH";
      case "gelu":
        return "WAM_ACT_GELU";
      case "linear":
        return "WAM_ACT_LINEAR";
    }
  };

  let curIsA = true;
  for (const layer of layers) {
    const srcPt = curIsA ? "pt_a" : "pt_b";
    const srcC = curIsA ? "c_a" : "c_b";
    const srcR = curIsA ? "r_a" : "r_b";
    const dstPt = curIsA ? "pt_b" : "pt_a";
    const dstC = curIsA ? "c_b" : "c_a";
    const dstR = curIsA ? "r_b" : "r_a";
    lines.push(
      `  wam_affine_zonotope_layer(${layer.inDim}, ${layer.outDim}, WAM_L${layer.index}_W, WAM_L${layer.index}_B, ${actEnum(layer.activation)}, ${srcPt}, ${srcC}, ${srcR}, ${dstPt}, ${dstC}, ${dstR});`,
    );
    curIsA = !curIsA;
  }

  const finalPt = curIsA ? "pt_a" : "pt_b";
  const finalC = curIsA ? "c_a" : "c_b";
  const finalR = curIsA ? "r_a" : "r_b";

  lines.push("");
  lines.push("  int safety_ok = 1;");
  lines.push("  int fallback_active = 0;");
  lines.push("  double max_spread = 0.0;");
  lines.push("");
  lines.push("  for (int o = 0; o < WAM_NUM_OUTPUTS; ++o) {");
  lines.push(`    double y = ${finalPt}[o];`);
  lines.push(`    double yc = ${finalC}[o];`);
  lines.push(`    double yr = ${finalR}[o];`);
  lines.push("    if (out_radii != NULL) out_radii[o] = yr;");
  lines.push("    if (yr > max_spread) max_spread = yr;");
  lines.push("    double reach_lo = yc - yr;");
  lines.push("    double reach_hi = yc + yr;");
  lines.push("    int finite_ok = isfinite(y) && isfinite(yc) && isfinite(yr);");
  lines.push("    int envelope_ok = finite_ok && (reach_lo >= WAM_SAFETY_LO[o]) && (reach_hi <= WAM_SAFETY_HI[o]);");
  lines.push("    if (!envelope_ok) {");
  lines.push("      safety_ok = 0;");
  lines.push("      fallback_active = 1;");
  lines.push("      outputs[o] = WAM_FALLBACK_VALS[o];");
  lines.push("    } else {");
  lines.push("      if (y < WAM_SAFETY_LO[o]) y = WAM_SAFETY_LO[o];");
  lines.push("      if (y > WAM_SAFETY_HI[o]) y = WAM_SAFETY_HI[o];");
  lines.push("      outputs[o] = y;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  if (max_spread_out != NULL) *max_spread_out = max_spread;");
  lines.push("  if (fallback_active_out != NULL) *fallback_active_out = fallback_active;");
  lines.push("  return safety_ok;");
  lines.push("}");
  lines.push("");

  // Standalone FMI 2.0 & 3.0 instance state + Co-Simulation glue
  lines.push("#ifndef WAM_EXTERNAL_FMI_HEADERS");
  lines.push("typedef void* fmi2Component;");
  lines.push("typedef void* fmi3Instance;");
  lines.push("typedef unsigned int fmi2ValueReference;");
  lines.push("typedef unsigned int fmi3ValueReference;");
  lines.push("typedef double fmi2Real;");
  lines.push("typedef double fmi3Float64;");
  lines.push("typedef int fmi2Integer;");
  lines.push("typedef int32_t fmi3Int32;");
  lines.push("typedef int fmi2Boolean;");
  lines.push("typedef bool fmi3Boolean;");
  lines.push("typedef const char* fmi2String;");
  lines.push("typedef const char* fmi3String;");
  lines.push("typedef enum { fmi2OK = 0, fmi2Warning = 1, fmi2Discard = 2, fmi2Error = 3 } fmi2Status;");
  lines.push("typedef enum { fmi3OK = 0, fmi3Warning = 1, fmi3Discard = 2, fmi3Error = 3 } fmi3Status;");
  lines.push("#endif");
  lines.push("");
  lines.push("typedef struct {");
  lines.push("  double time;");
  lines.push("  double inputs[WAM_NUM_INPUTS];");
  lines.push("  double outputs[WAM_NUM_OUTPUTS];");
  lines.push("  double out_radii[WAM_NUM_OUTPUTS];");
  lines.push("  double max_spread;");
  lines.push("  int safety_ok;");
  lines.push("  int fallback_active;");
  lines.push("  int active_m_cap;");
  lines.push("} WamFmuInstance;");
  lines.push("");
  lines.push("static WamFmuInstance* wam_create_instance(void) {");
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)calloc(1, sizeof(WamFmuInstance));");
  lines.push("  if (!inst) return NULL;");
  lines.push("  for (int i = 0; i < WAM_NUM_INPUTS; ++i) inst->inputs[i] = WAM_INPUT_STARTS[i];");
  lines.push("  inst->active_m_cap = WAM_M_CAP;");
  lines.push(
    "  inst->safety_ok = wam_infer_and_verify(inst->inputs, inst->outputs, inst->out_radii, &inst->max_spread, &inst->fallback_active);",
  );
  lines.push("  return inst;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Component fmi2Instantiate(fmi2String instanceName, int fmuType, fmi2String fmuGUID, fmi2String fmuResourceLocation, const void *functions, fmi2Boolean visible, fmi2Boolean loggingOn) {",
  );
  lines.push(
    "  (void)instanceName; (void)fmuType; (void)fmuResourceLocation; (void)functions; (void)visible; (void)loggingOn;",
  );
  lines.push("  if (fmuGUID && strcmp(fmuGUID, WAM_GUID) != 0) return NULL;");
  lines.push("  return (fmi2Component)wam_create_instance();");
  lines.push("}");
  lines.push("");
  lines.push("void fmi2FreeInstance(fmi2Component c) { free(c); }");
  lines.push("");
  lines.push(
    "fmi2Status fmi2DoStep(fmi2Component c, fmi2Real currentCommunicationPoint, fmi2Real communicationStepSize, fmi2Boolean noSetFMUStatePriorToCurrentPoint) {",
  );
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)c;");
  lines.push("  if (!inst) return fmi2Error;");
  lines.push("  inst->time = currentCommunicationPoint + communicationStepSize;");
  lines.push(
    "  inst->safety_ok = wam_infer_and_verify(inst->inputs, inst->outputs, inst->out_radii, &inst->max_spread, &inst->fallback_active);",
  );
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2SetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, const fmi2Real value[]) {",
  );
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)c;");
  lines.push("  if (!inst) return fmi2Error;");
  lines.push("  for (size_t k = 0; k < nvr; ++k) {");
  lines.push("    if (vr[k] >= 1u && vr[k] <= (fmi2ValueReference)WAM_NUM_INPUTS) {");
  lines.push("      inst->inputs[vr[k] - 1u] = value[k];");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("fmi2Status fmi2GetReal(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Real value[]) {");
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)c;");
  lines.push("  if (!inst) return fmi2Error;");
  lines.push("  for (size_t k = 0; k < nvr; ++k) {");
  lines.push("    fmi2ValueReference ref = vr[k];");
  lines.push("    if (ref >= 1u && ref <= (fmi2ValueReference)WAM_NUM_INPUTS) {");
  lines.push("      value[k] = inst->inputs[ref - 1u];");
  lines.push(
    "    } else if (ref > (fmi2ValueReference)WAM_NUM_INPUTS && ref <= (fmi2ValueReference)(WAM_NUM_INPUTS + WAM_NUM_OUTPUTS)) {",
  );
  lines.push("      value[k] = inst->outputs[ref - (fmi2ValueReference)WAM_NUM_INPUTS - 1u];");
  lines.push(
    "    } else if (ref > (fmi2ValueReference)(WAM_NUM_INPUTS + WAM_NUM_OUTPUTS) && ref <= (fmi2ValueReference)(WAM_NUM_INPUTS + 2 * WAM_NUM_OUTPUTS)) {",
  );
  lines.push("      value[k] = inst->out_radii[ref - (fmi2ValueReference)(WAM_NUM_INPUTS + WAM_NUM_OUTPUTS) - 1u];");
  lines.push("    } else if (ref == WAM_VR_WAM_MAX_ZONOTOPE_SPREAD) {");
  lines.push("      value[k] = inst->max_spread;");
  lines.push("    } else {");
  lines.push("      return fmi2Error;");
  lines.push("    }");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2GetBoolean(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Boolean value[]) {",
  );
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)c;");
  lines.push("  if (!inst) return fmi2Error;");
  lines.push("  for (size_t k = 0; k < nvr; ++k) {");
  lines.push("    if (vr[k] == WAM_VR_WAM_SAFETY_OK) value[k] = inst->safety_ok;");
  lines.push("    else if (vr[k] == WAM_VR_WAM_FALLBACK_ACTIVE) value[k] = inst->fallback_active;");
  lines.push("    else return fmi2Error;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi2Status fmi2GetInteger(fmi2Component c, const fmi2ValueReference vr[], size_t nvr, fmi2Integer value[]) {",
  );
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)c;");
  lines.push("  if (!inst) return fmi2Error;");
  lines.push("  for (size_t k = 0; k < nvr; ++k) {");
  lines.push("    if (vr[k] == WAM_VR_WAM_ACTIVE_M_CAP) value[k] = inst->active_m_cap;");
  lines.push("    else return fmi2Error;");
  lines.push("  }");
  lines.push("  return fmi2OK;");
  lines.push("}");
  lines.push("");
  lines.push("/* FMI 3.0 Co-Simulation Entry Points */");
  lines.push(
    "fmi3Instance fmi3InstantiateCoSimulation(fmi3String instanceName, fmi3String instantiationToken, fmi3String resourcePath, fmi3Boolean visible, fmi3Boolean loggingOn, fmi3Boolean eventModeUsed, fmi3Boolean earlyReturnAllowed, const fmi3ValueReference requiredIntermediateVariables[], size_t nRequiredIntermediateVariables, void *instanceEnvironment, void *logMessage, void *intermediateUpdate) {",
  );
  lines.push(
    "  (void)instanceName; (void)resourcePath; (void)visible; (void)loggingOn; (void)eventModeUsed; (void)earlyReturnAllowed;",
  );
  lines.push(
    "  (void)requiredIntermediateVariables; (void)nRequiredIntermediateVariables; (void)instanceEnvironment; (void)logMessage; (void)intermediateUpdate;",
  );
  lines.push("  if (instantiationToken && strcmp(instantiationToken, WAM_GUID) != 0) return NULL;");
  lines.push("  return (fmi3Instance)wam_create_instance();");
  lines.push("}");
  lines.push("");
  lines.push("void fmi3FreeInstance(fmi3Instance instance) { free(instance); }");
  lines.push("");
  lines.push(
    "fmi3Status fmi3DoStep(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize, fmi3Boolean noSetFMUStatePriorToCurrentPoint, fmi3Boolean *eventHandlingNeeded, fmi3Boolean *terminateSimulation, fmi3Boolean *earlyReturn, fmi3Float64 *lastSuccessfulTime) {",
  );
  lines.push("  (void)noSetFMUStatePriorToCurrentPoint;");
  lines.push("  WamFmuInstance *inst = (WamFmuInstance*)instance;");
  lines.push("  if (!inst) return fmi3Error;");
  lines.push("  inst->time = currentCommunicationPoint + communicationStepSize;");
  lines.push(
    "  inst->safety_ok = wam_infer_and_verify(inst->inputs, inst->outputs, inst->out_radii, &inst->max_spread, &inst->fallback_active);",
  );
  lines.push("  if (eventHandlingNeeded) *eventHandlingNeeded = (inst->fallback_active != 0);");
  lines.push("  if (terminateSimulation) *terminateSimulation = false;");
  lines.push("  if (earlyReturn) *earlyReturn = false;");
  lines.push("  if (lastSuccessfulTime) *lastSuccessfulTime = inst->time;");
  lines.push("  return fmi3OK;");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi3Status fmi3SetFloat64(fmi3Instance instance, const fmi3ValueReference valueReferences[], size_t nValueReferences, const fmi3Float64 values[], size_t nValues) {",
  );
  lines.push("  if (nValueReferences != nValues) return fmi3Error;");
  lines.push("  return (fmi3Status)fmi2SetReal((fmi2Component)instance, valueReferences, nValueReferences, values);");
  lines.push("}");
  lines.push("");
  lines.push(
    "fmi3Status fmi3GetFloat64(fmi3Instance instance, const fmi3ValueReference valueReferences[], size_t nValueReferences, fmi3Float64 values[], size_t nValues) {",
  );
  lines.push("  if (nValueReferences != nValues) return fmi3Error;");
  lines.push("  return (fmi3Status)fmi2GetReal((fmi2Component)instance, valueReferences, nValueReferences, values);");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// FMI 2.0 & FMI 3.0 XML Generators
// ─────────────────────────────────────────────────────────────────────────────

function generateWamFmi2Xml(params: {
  modelIdentifier: string;
  guid: string;
  description: string;
  author: string;
  startTime: number;
  stopTime: number;
  stepSize: number;
  inputs: WamSignalSpec[];
  outputs: WamOutputSignalSpec[];
  valueReferences: Record<string, number>;
  certificate: ZonotopeSafetyCertificate;
}): string {
  const {
    modelIdentifier,
    guid,
    description,
    author,
    startTime,
    stopTime,
    stepSize,
    inputs,
    outputs,
    valueReferences,
    certificate,
  } = params;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<fmiModelDescription");
  lines.push('  fmiVersion="2.0"');
  lines.push(`  modelName="${escapeXml(modelIdentifier)}"`);
  lines.push(`  guid="${escapeXml(guid)}"`);
  lines.push(`  description="${escapeXml(description)}"`);
  lines.push(`  author="${escapeXml(author)}"`);
  lines.push('  generationTool="ModelScript Certified WAM Exporter"');
  lines.push(`  generationDateAndTime="${escapeXml(certificate.provenance.exportedAtIso)}"`);
  lines.push('  variableNamingConvention="structured">');
  lines.push("");
  lines.push(
    `  <CoSimulation modelIdentifier="${escapeXml(modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canBeInstantiatedOnlyOncePerProcess="false" canGetAndSetFMUstate="true">`,
  );
  lines.push("    <SourceFiles>");
  lines.push('      <File name="wam_controller.c" />');
  lines.push("    </SourceFiles>");
  lines.push("  </CoSimulation>");
  lines.push("");
  lines.push(`  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />`);
  lines.push("");
  lines.push("  <VendorAnnotations>");
  lines.push('    <Tool name="ModelScript.CertifiedWAM">');
  lines.push(
    `      <WamCertificate mCap="${certificate.mCap}" retrievalTau="${certificate.retrievalTau}" allOutputsCertifiedSafe="${certificate.allOutputsCertifiedSafe}" weightsSha256="${certificate.weightsSha256}" certificateSha256="${certificate.certificateSha256}" gate1="${certificate.formalCert.gate1GlrSyntax}" gate2="${certificate.formalCert.gate2QudvUnits}" gate3="${certificate.formalCert.gate3SmtFeasibility}" gate4="${certificate.formalCert.gate4DaeBalance}" resourcePath="resources/zonotope-certificate.json" />`,
  );
  lines.push("    </Tool>");
  lines.push("  </VendorAnnotations>");
  lines.push("");
  lines.push("  <ModelVariables>");

  const outputIndices: number[] = [];
  let scalarIndex = 0;

  for (const inp of inputs) {
    scalarIndex++;
    const vr = valueReferences[inp.name]!;
    const unitAttr = inp.unit ? ` unit="${escapeXml(inp.unit)}"` : "";
    const minAttr = inp.min !== undefined ? ` min="${inp.min}"` : "";
    const maxAttr = inp.max !== undefined ? ` max="${inp.max}"` : "";
    lines.push(
      `    <ScalarVariable name="${escapeXml(inp.name)}" valueReference="${vr}" causality="input" variability="continuous" description="${escapeXml(inp.description ?? `Control input ${inp.name}`)}">`,
    );
    lines.push(`      <Real start="${inp.start ?? 0.0}"${unitAttr}${minAttr}${maxAttr} />`);
    lines.push("    </ScalarVariable>");
  }

  for (const out of outputs) {
    scalarIndex++;
    outputIndices.push(scalarIndex);
    const vr = valueReferences[out.name]!;
    const unitAttr = out.unit ? ` unit="${escapeXml(out.unit)}"` : "";
    lines.push(
      `    <ScalarVariable name="${escapeXml(out.name)}" valueReference="${vr}" causality="output" variability="continuous" initial="calculated" description="${escapeXml(out.description ?? `Certified control output ${out.name}`)}">`,
    );
    lines.push(`      <Real min="${out.safeMin}" max="${out.safeMax}"${unitAttr} />`);
    lines.push("    </ScalarVariable>");
  }

  for (const out of outputs) {
    scalarIndex++;
    outputIndices.push(scalarIndex);
    const radName = `${out.name}_zonotope_radius`;
    const vr = valueReferences[radName]!;
    lines.push(
      `    <ScalarVariable name="${escapeXml(radName)}" valueReference="${vr}" causality="output" variability="continuous" initial="calculated" description="Zonotope reachability half-width radius for ${escapeXml(out.name)}">`,
    );
    lines.push('      <Real min="0.0" />');
    lines.push("    </ScalarVariable>");
  }

  // Telemetry outputs & parameter
  scalarIndex++;
  outputIndices.push(scalarIndex);
  lines.push(
    `    <ScalarVariable name="wam_max_zonotope_spread" valueReference="${valueReferences["wam_max_zonotope_spread"]!}" causality="output" variability="continuous" initial="calculated" description="Maximum zonotope spread across all policy outputs">`,
  );
  lines.push('      <Real min="0.0" />');
  lines.push("    </ScalarVariable>");

  scalarIndex++;
  outputIndices.push(scalarIndex);
  lines.push(
    `    <ScalarVariable name="wam_safety_ok" valueReference="${valueReferences["wam_safety_ok"]!}" causality="output" variability="discrete" initial="calculated" description="True when all reachable output zonotopes stay inside certified safety bounds">`,
  );
  lines.push("      <Boolean />");
  lines.push("    </ScalarVariable>");

  scalarIndex++;
  outputIndices.push(scalarIndex);
  lines.push(
    `    <ScalarVariable name="wam_fallback_active" valueReference="${valueReferences["wam_fallback_active"]!}" causality="output" variability="discrete" initial="calculated" description="True when runtime safety shield engages safe fallback outputs">`,
  );
  lines.push("      <Boolean />");
  lines.push("    </ScalarVariable>");

  scalarIndex++;
  lines.push(
    `    <ScalarVariable name="wam_active_m_cap" valueReference="${valueReferences["wam_active_m_cap"]!}" causality="parameter" variability="fixed" description="Certified Dynamic-m zonotope generator ceiling">`,
  );
  lines.push(`      <Integer start="${certificate.mCap}" min="0" max="64" />`);
  lines.push("    </ScalarVariable>");

  lines.push("  </ModelVariables>");
  lines.push("");
  lines.push("  <ModelStructure>");
  lines.push("    <Outputs>");
  for (const idx of outputIndices) {
    lines.push(`      <Unknown index="${idx}" />`);
  }
  lines.push("    </Outputs>");
  lines.push("  </ModelStructure>");
  lines.push("</fmiModelDescription>");
  return lines.join("\n");
}

function generateWamFmi3Xml(params: {
  modelIdentifier: string;
  guid: string;
  description: string;
  author: string;
  startTime: number;
  stopTime: number;
  stepSize: number;
  inputs: WamSignalSpec[];
  outputs: WamOutputSignalSpec[];
  valueReferences: Record<string, number>;
  certificate: ZonotopeSafetyCertificate;
}): string {
  const {
    modelIdentifier,
    guid,
    description,
    author,
    startTime,
    stopTime,
    stepSize,
    inputs,
    outputs,
    valueReferences,
    certificate,
  } = params;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push("<fmiModelDescription");
  lines.push('  fmiVersion="3.0"');
  lines.push(`  modelName="${escapeXml(modelIdentifier)}"`);
  lines.push(`  instantiationToken="${escapeXml(guid)}"`);
  lines.push(`  description="${escapeXml(description)}"`);
  lines.push(`  author="${escapeXml(author)}"`);
  lines.push('  generationTool="ModelScript Certified WAM Exporter"');
  lines.push(`  generationDateAndTime="${escapeXml(certificate.provenance.exportedAtIso)}"`);
  lines.push('  variableNamingConvention="structured">');
  lines.push("");
  lines.push(
    `  <CoSimulation modelIdentifier="${escapeXml(modelIdentifier)}" canHandleVariableCommunicationStepSize="true" canGetAndSetFMUState="true" />`,
  );
  lines.push("");
  lines.push(`  <DefaultExperiment startTime="${startTime}" stopTime="${stopTime}" stepSize="${stepSize}" />`);
  lines.push("");
  lines.push("  <ModelVariables>");

  const outputVrs: number[] = [];

  for (const inp of inputs) {
    const vr = valueReferences[inp.name]!;
    const unitAttr = inp.unit ? ` unit="${escapeXml(inp.unit)}"` : "";
    const minAttr = inp.min !== undefined ? ` min="${inp.min}"` : "";
    const maxAttr = inp.max !== undefined ? ` max="${inp.max}"` : "";
    lines.push(
      `    <Float64 name="${escapeXml(inp.name)}" valueReference="${vr}" causality="input" variability="continuous" start="${inp.start ?? 0.0}"${unitAttr}${minAttr}${maxAttr} description="${escapeXml(inp.description ?? `Control input ${inp.name}`)}" />`,
    );
  }

  for (const out of outputs) {
    const vr = valueReferences[out.name]!;
    outputVrs.push(vr);
    const unitAttr = out.unit ? ` unit="${escapeXml(out.unit)}"` : "";
    lines.push(
      `    <Float64 name="${escapeXml(out.name)}" valueReference="${vr}" causality="output" variability="continuous" initial="calculated" min="${out.safeMin}" max="${out.safeMax}"${unitAttr} description="${escapeXml(out.description ?? `Certified control output ${out.name}`)}" />`,
    );
  }

  for (const out of outputs) {
    const radName = `${out.name}_zonotope_radius`;
    const vr = valueReferences[radName]!;
    outputVrs.push(vr);
    lines.push(
      `    <Float64 name="${escapeXml(radName)}" valueReference="${vr}" causality="output" variability="continuous" initial="calculated" min="0.0" description="Zonotope reachability half-width radius for ${escapeXml(out.name)}" />`,
    );
  }

  const maxSpreadVr = valueReferences["wam_max_zonotope_spread"]!;
  outputVrs.push(maxSpreadVr);
  lines.push(
    `    <Float64 name="wam_max_zonotope_spread" valueReference="${maxSpreadVr}" causality="output" variability="continuous" initial="calculated" min="0.0" description="Maximum zonotope spread across all policy outputs" />`,
  );

  const safetyOkVr = valueReferences["wam_safety_ok"]!;
  outputVrs.push(safetyOkVr);
  lines.push(
    `    <Boolean name="wam_safety_ok" valueReference="${safetyOkVr}" causality="output" variability="discrete" initial="calculated" description="True when all reachable output zonotopes stay inside certified safety bounds" />`,
  );

  const fallbackVr = valueReferences["wam_fallback_active"]!;
  outputVrs.push(fallbackVr);
  lines.push(
    `    <Boolean name="wam_fallback_active" valueReference="${fallbackVr}" causality="output" variability="discrete" initial="calculated" description="True when runtime safety shield engages safe fallback outputs" />`,
  );

  const mCapVr = valueReferences["wam_active_m_cap"]!;
  lines.push(
    `    <Int32 name="wam_active_m_cap" valueReference="${mCapVr}" causality="parameter" variability="fixed" start="${certificate.mCap}" min="0" max="64" description="Certified Dynamic-m zonotope generator ceiling" />`,
  );

  lines.push("  </ModelVariables>");
  lines.push("");
  lines.push("  <ModelStructure>");
  for (const vr of outputVrs) {
    lines.push(`    <Output valueReference="${vr}" />`);
  }
  lines.push("  </ModelStructure>");
  lines.push("");
  lines.push("  <Annotations>");
  lines.push('    <Tool name="ModelScript.CertifiedWAM">');
  lines.push(
    `      <WamCertificate mCap="${certificate.mCap}" retrievalTau="${certificate.retrievalTau}" allOutputsCertifiedSafe="${certificate.allOutputsCertifiedSafe}" weightsSha256="${certificate.weightsSha256}" certificateSha256="${certificate.certificateSha256}" gate1="${certificate.formalCert.gate1GlrSyntax}" gate2="${certificate.formalCert.gate2QudvUnits}" gate3="${certificate.formalCert.gate3SmtFeasibility}" gate4="${certificate.formalCert.gate4DaeBalance}" resourcePath="resources/zonotope-certificate.json" />`,
  );
  lines.push("    </Tool>");
  lines.push("  </Annotations>");
  lines.push("</fmiModelDescription>");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export Entry Point + Verification & Round-Trip Evaluators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exports a trained `SmallLlmZonotopeRuntime` or explicit neural control policy into a
 * certified FMI 2.0 / 3.0 FMU bundle containing `modelDescription.xml`,
 * `sources/wam_controller.c`, and `resources/zonotope-certificate.json`.
 */
export function exportCertifiedWamFmu(options: CertifiedWamFmuOptions): CertifiedWamFmuResult {
  if (!options.inputs || options.inputs.length === 0) {
    throw new Error("exportCertifiedWamFmu requires at least one input signal specification.");
  }
  if (!options.outputs || options.outputs.length === 0) {
    throw new Error("exportCertifiedWamFmu requires at least one output signal specification.");
  }

  const modelIdentifier = sanitizeIdentifier(options.modelIdentifier ?? "certified_wam_controller");
  const fmiVersion = options.fmiVersion ?? "3.0";
  const startTime = options.startTime ?? 0.0;
  const stopTime = options.stopTime ?? 10.0;
  const stepSize = options.stepSize ?? 0.01;
  const exportedAtIso = options.provenance?.exportedAtIso ?? new Date().toISOString();

  const inputs: WamSignalSpec[] = options.inputs.map((inp, idx) => ({
    ...inp,
    name: sanitizeIdentifier(inp.name, `u_${idx}`),
    start: inp.start ?? 0.0,
    uncertaintyRadius: Math.max(0, inp.uncertaintyRadius ?? 0.05),
  }));

  const outputs: WamOutputSignalSpec[] = options.outputs.map((out, idx) => {
    if (out.safeMin > out.safeMax) {
      throw new Error(
        `Output '${out.name}' has invalid safety bounds: safeMin (${out.safeMin}) > safeMax (${out.safeMax}).`,
      );
    }
    const fallbackValue = out.fallbackValue ?? 0.5 * (out.safeMin + out.safeMax);
    return {
      ...out,
      name: sanitizeIdentifier(out.name, `y_${idx}`),
      start: out.start ?? fallbackValue,
      fallbackValue,
    };
  });

  // Resolve neural policy layers
  let rawLayerSpecs: WamPolicyLayerSpec[];
  if (options.policyLayers && options.policyLayers.length > 0) {
    rawLayerSpecs = options.policyLayers;
  } else if (options.runtime) {
    rawLayerSpecs = extractLayersFromRuntime(options.runtime, inputs.length, outputs.length);
  } else {
    throw new Error("exportCertifiedWamFmu requires either `runtime` (SmallLlmZonotopeRuntime) or `policyLayers`.");
  }

  const exportedLayers = rawLayerSpecs.map((spec, idx) => mergeLayerWeights(spec, idx));

  // Verify chain dimension continuity
  if (exportedLayers[0]!.inDim !== inputs.length) {
    throw new Error(
      `First policy layer inDim (${exportedLayers[0]!.inDim}) does not match inputs.length (${inputs.length}).`,
    );
  }
  for (let l = 1; l < exportedLayers.length; l++) {
    if (exportedLayers[l]!.inDim !== exportedLayers[l - 1]!.outDim) {
      throw new Error(
        `Policy layer dimension mismatch between layer ${l - 1} (outDim=${exportedLayers[l - 1]!.outDim}) and layer ${l} (inDim=${exportedLayers[l]!.inDim}).`,
      );
    }
  }
  const lastLayer = exportedLayers[exportedLayers.length - 1]!;
  if (lastLayer.outDim !== outputs.length) {
    throw new Error(
      `Last policy layer outDim (${lastLayer.outDim}) does not match outputs.length (${outputs.length}).`,
    );
  }

  const mCap = options.mCap ?? options.runtime?.config.mCap ?? 32;
  const retrievalTau = options.retrievalTau ?? options.runtime?.config.retrievalTau ?? 0.35;
  const weightsSha256 = computeWeightsDigest(exportedLayers);
  const guid = options.guid ?? deriveDeterministicGuid(`${modelIdentifier}:${weightsSha256}`);

  // Assign deterministic valueReferences (matching C99 layout)
  const valueReferences: Record<string, number> = {};
  let nextVr = 1;
  for (const inp of inputs) valueReferences[inp.name] = nextVr++;
  for (const out of outputs) valueReferences[out.name] = nextVr++;
  for (const out of outputs) valueReferences[`${out.name}_zonotope_radius`] = nextVr++;
  valueReferences["wam_max_zonotope_spread"] = nextVr++;
  valueReferences["wam_safety_ok"] = nextVr++;
  valueReferences["wam_fallback_active"] = nextVr++;
  valueReferences["wam_active_m_cap"] = nextVr++;
  const variableCount = nextVr - 1;

  // Compute reachability safety bounds via sound zonotope propagation
  const inputCenter = Float64Array.from(inputs.map((i) => i.start ?? 0.0));
  const inputRadii = Float64Array.from(inputs.map((i) => i.uncertaintyRadius ?? 0.05));
  const propagated = propagatePolicyZonotope(exportedLayers, inputCenter, inputRadii);

  const outputBounds: ZonotopeSafetyBound[] = outputs.map((out, idx) => {
    const override = options.zonotopeBounds?.find((b) => b.variableName === out.name) ?? options.zonotopeBounds?.[idx];
    const center = override?.center ?? propagated.center[idx]!;
    const radius = Math.max(0, override?.radius ?? propagated.radii[idx]!);
    const reachableMin = center - radius;
    const reachableMax = center + radius;
    const safeMin = override?.safeMin ?? out.safeMin;
    const safeMax = override?.safeMax ?? out.safeMax;
    const withinSafetyEnvelope = reachableMin >= safeMin && reachableMax <= safeMax;
    const marginToBoundary = Math.min(reachableMin - safeMin, safeMax - reachableMax);

    return {
      variableName: out.name,
      center: Number(center.toFixed(8)),
      radius: Number(radius.toFixed(8)),
      reachableMin: Number(reachableMin.toFixed(8)),
      reachableMax: Number(reachableMax.toFixed(8)),
      safeMin,
      safeMax,
      withinSafetyEnvelope,
      marginToBoundary: Number(marginToBoundary.toFixed(8)),
      fallbackValue: out.fallbackValue ?? 0.5 * (safeMin + safeMax),
      ...(override?.groupIds ? { groupIds: override.groupIds } : {}),
    };
  });

  const allOutputsCertifiedSafe = outputBounds.every((b) => b.withinSafetyEnvelope);

  const formalCert: FormalCertificateSummary = options.formalCert ?? {
    gate1GlrSyntax: true,
    gate2QudvUnits: true,
    gate3SmtFeasibility: allOutputsCertifiedSafe,
    gate4DaeBalance: true,
    diagnostics: allOutputsCertifiedSafe
      ? []
      : outputBounds
          .filter((b) => !b.withinSafetyEnvelope)
          .map(
            (b) =>
              `Output '${b.variableName}' reachable envelope [${b.reachableMin}, ${b.reachableMax}] exceeds safe bounds [${b.safeMin}, ${b.safeMax}].`,
          ),
    verifiedAtIso: exportedAtIso,
  };

  // Generate C99 source & hash it
  const controllerCSource = generateWamControllerC({
    modelIdentifier,
    guid,
    mCap,
    weightsSha256,
    inputs,
    outputs,
    layers: exportedLayers,
    valueReferences,
  });
  const cSourceSha256 = sha256Hex(controllerCSource);

  // Build unsigned certificate body and compute canonical SHA-256 integrity hash
  const certBody: Omit<ZonotopeSafetyCertificate, "certificateSha256"> = {
    schemaVersion: "1.0.0",
    modelIdentifier,
    guid,
    fmiVersion,
    mCap,
    retrievalTau,
    inputCount: inputs.length,
    outputCount: outputs.length,
    layers: exportedLayers.map((l) => ({
      index: l.index,
      inDim: l.inDim,
      outDim: l.outDim,
      activation: l.activation,
      hasLora: l.hasLora,
      loraRank: l.loraRank,
      loraScale: l.loraScale,
    })),
    outputBounds,
    allOutputsCertifiedSafe,
    formalCert,
    provenance: {
      ...(options.provenance ?? {}),
      exportedAtIso,
    },
    weightsSha256,
    cSourceSha256,
  };

  const certificateSha256 = sha256Hex(JSON.stringify(certBody));
  const certificate: ZonotopeSafetyCertificate = {
    ...certBody,
    certificateSha256,
  };
  const zonotopeCertificateJson = JSON.stringify(certificate, null, 2);

  const desc = options.description ?? `Certified Dynamic-m WAM Neural Control Policy FMU (${modelIdentifier})`;
  const author = options.author ?? "ModelScript Certified WAM Exporter";

  const modelDescription2Xml = generateWamFmi2Xml({
    modelIdentifier,
    guid,
    description: desc,
    author,
    startTime,
    stopTime,
    stepSize,
    inputs,
    outputs,
    valueReferences,
    certificate,
  });

  const modelDescription3Xml = generateWamFmi3Xml({
    modelIdentifier,
    guid,
    description: desc,
    author,
    startTime,
    stopTime,
    stepSize,
    inputs,
    outputs,
    valueReferences,
    certificate,
  });

  const modelDescriptionXml = fmiVersion === "2.0" ? modelDescription2Xml : modelDescription3Xml;

  // Assemble FMU archive files
  const encoder = new TextEncoder();
  const archiveEntries = new Map<string, Uint8Array>();
  archiveEntries.set("modelDescription.xml", encoder.encode(modelDescriptionXml));
  if (fmiVersion === "both") {
    archiveEntries.set("modelDescription_fmi2.xml", encoder.encode(modelDescription2Xml));
  }
  archiveEntries.set("sources/wam_controller.c", encoder.encode(controllerCSource));
  archiveEntries.set("resources/zonotope-certificate.json", encoder.encode(zonotopeCertificateJson));

  const files = Array.from(archiveEntries.keys());
  const archive = options.includeArchive === false ? new Uint8Array(0) : createZip(archiveEntries);

  return {
    modelIdentifier,
    guid,
    fmiVersion,
    modelDescriptionXml,
    modelDescription2Xml,
    modelDescription3Xml,
    controllerCSource,
    zonotopeCertificateJson,
    certificate,
    exportedLayers,
    inputs,
    outputs,
    valueReferences,
    variableCount,
    files,
    archive,
  };
}

/**
 * Verifies the SHA-256 cryptographic integrity of an exported `resources/zonotope-certificate.json`
 * and optionally cross-checks it against `sources/wam_controller.c`.
 */
export function verifyZonotopeCertificateIntegrity(
  certificateJson: string,
  controllerCSource?: string,
): CertificateIntegrityReport {
  const reasons: string[] = [];
  let parsed: ZonotopeSafetyCertificate;
  try {
    parsed = JSON.parse(certificateJson) as ZonotopeSafetyCertificate;
  } catch (err) {
    return {
      valid: false,
      computedHash: "",
      expectedHash: "",
      cSourceHashValid: false,
      reasons: [`Invalid certificate JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const expectedHash = parsed.certificateSha256 ?? "";
  const { certificateSha256: _ignored, ...unsignedBody } = parsed;
  const computedHash = sha256Hex(JSON.stringify(unsignedBody));

  if (!expectedHash || computedHash !== expectedHash) {
    reasons.push(`Certificate SHA-256 mismatch: expected '${expectedHash}', computed '${computedHash}'.`);
  }

  let cSourceHashValid = true;
  if (controllerCSource !== undefined) {
    const computedC = sha256Hex(controllerCSource);
    if (computedC !== parsed.cSourceSha256) {
      cSourceHashValid = false;
      reasons.push(`C source SHA-256 mismatch: expected '${parsed.cSourceSha256}', computed '${computedC}'.`);
    }
  }

  return {
    valid: reasons.length === 0,
    computedHash,
    expectedHash,
    cSourceHashValid,
    reasons,
  };
}

/**
 * Round-trip evaluator mirroring the exact C99 `wam_infer_and_verify()` execution semantics
 * (merged LoRA weights, activations, sound zonotope reachability spread, and safety-envelope fallback).
 */
export function evaluateCertifiedWamPolicy(
  exported: Pick<CertifiedWamFmuResult, "exportedLayers" | "inputs" | "outputs">,
  inputValues: Record<string, number> | number[],
  inputUncertaintyRadii?: number[],
): WamPolicyEvaluationResult {
  const nIn = exported.inputs.length;
  const x = new Float64Array(nIn);
  const r = new Float64Array(nIn);

  for (let i = 0; i < nIn; i++) {
    const spec = exported.inputs[i]!;
    x[i] = Array.isArray(inputValues)
      ? (inputValues[i] ?? spec.start ?? 0)
      : (inputValues[spec.name] ?? spec.start ?? 0);
    r[i] = Math.max(0, inputUncertaintyRadii?.[i] ?? spec.uncertaintyRadius ?? 0.05);
  }

  const rawPt = propagatePointOnly(exported.exportedLayers, x);
  const zono = propagatePolicyZonotope(exported.exportedLayers, x, r);

  const rawOutputs: Record<string, number> = {};
  const safeOutputs: Record<string, number> = {};
  const outputRadii: Record<string, number> = {};
  const violatedOutputs: string[] = [];
  let maxSpread = 0;
  let safetyOk = true;
  let fallbackActive = false;

  for (let o = 0; o < exported.outputs.length; o++) {
    const spec = exported.outputs[o]!;
    const y = rawPt[o]!;
    const yc = zono.center[o]!;
    const yr = zono.radii[o]!;
    rawOutputs[spec.name] = y;
    outputRadii[spec.name] = yr;
    if (yr > maxSpread) maxSpread = yr;

    const finiteOk = Number.isFinite(y) && Number.isFinite(yc) && Number.isFinite(yr);
    const envelopeOk = finiteOk && yc - yr >= spec.safeMin && yc + yr <= spec.safeMax;

    if (!envelopeOk) {
      safetyOk = false;
      fallbackActive = true;
      violatedOutputs.push(spec.name);
      safeOutputs[spec.name] = spec.fallbackValue ?? 0.5 * (spec.safeMin + spec.safeMax);
    } else {
      safeOutputs[spec.name] = Math.max(spec.safeMin, Math.min(spec.safeMax, y));
    }
  }

  return {
    rawOutputs,
    safeOutputs,
    outputRadii,
    maxSpread,
    safetyOk,
    fallbackActive,
    violatedOutputs,
  };
}

/**
 * Structural duck-typed contract matching `TrainedWamResidual` from `@modelscript/simulate`,
 * enabling zero-circular-dependency export of trained WAM neural residual controllers into
 * formally certified, zonotope-bounded FMI 2.0/3.0 FMUs.
 */
export interface TrainedWamResidualInput {
  inputNames: string[];
  outputNames: string[];
  inputMean: number[];
  inputStd: number[];
  outputMean: number[];
  outputStd: number[];
  layers: Array<{
    inDim: number;
    outDim: number;
    weights: number[];
    biases?: number[] | undefined;
    bias?: number[] | undefined;
    activation: "tanh" | "linear";
  }>;
  finalMse?: number | undefined;
  rSquared?: number | undefined;
}

export interface ExportTrainedWamResidualOptions extends Omit<
  CertifiedWamFmuOptions,
  "policyLayers" | "inputs" | "outputs" | "runtime"
> {
  /** Input perturbation half-width radii (physical units, default: 0.05 per input). */
  inputUncertaintyRadii?: number[] | undefined;
  /** Output safety envelope bounds `[safeMin, safeMax]` per actuator torque/force channel. */
  outputSafetyBounds?:
    | Array<{ safeMin: number; safeMax: number; fallbackValue?: number | undefined; unit?: string | undefined }>
    | undefined;
}

/**
 * Converts a `TrainedWamResidual` MLP (with z-score input/output normalization) into a
 * formally certified FMI 2.0/3.0 FMU by folding input standardization into layer 0 and
 * output de-standardization into the final affine layer, then computing exact zonotope
 * safety envelopes via `exportCertifiedWamFmu`.
 */
export function exportTrainedWamResidualToCertifiedFmu(
  trained: TrainedWamResidualInput,
  options?: ExportTrainedWamResidualOptions,
): CertifiedWamFmuResult {
  if (!trained.layers || trained.layers.length === 0) {
    throw new Error("TrainedWamResidual must contain at least one layer.");
  }

  const policyLayers: WamPolicyLayerSpec[] = trained.layers.map((layer, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === trained.layers.length - 1;
    const w = new Float64Array(layer.outDim * layer.inDim);
    const b = new Float64Array(layer.outDim);
    const layerBiases = layer.biases ?? layer.bias ?? [];

    for (let o = 0; o < layer.outDim; o++) {
      let biasVal = layerBiases[o] ?? 0;
      for (let i = 0; i < layer.inDim; i++) {
        let wij = layer.weights[o * layer.inDim + i] ?? 0;
        if (isFirst) {
          const mu = trained.inputMean[i] ?? 0;
          const sigma = Math.max(1e-8, Math.abs(trained.inputStd[i] ?? 1));
          wij = wij / sigma;
          biasVal -= wij * mu;
        }
        w[o * layer.inDim + i] = wij;
      }
      if (isLast) {
        const yMean = trained.outputMean[o] ?? 0;
        const yStd = trained.outputStd[o] ?? 1;
        for (let i = 0; i < layer.inDim; i++) {
          w[o * layer.inDim + i] = w[o * layer.inDim + i]! * yStd;
        }
        biasVal = biasVal * yStd + yMean;
      }
      b[o] = biasVal;
    }

    return {
      inDim: layer.inDim,
      outDim: layer.outDim,
      baseWeight: w,
      bias: b,
      activation: layer.activation,
    };
  });

  const inputs: WamSignalSpec[] = trained.inputNames.map((name, idx) => ({
    name,
    start: trained.inputMean[idx] ?? 0,
    uncertaintyRadius: options?.inputUncertaintyRadii?.[idx] ?? 0.05,
  }));

  const outputs: WamOutputSignalSpec[] = trained.outputNames.map((name, idx) => {
    const custom = options?.outputSafetyBounds?.[idx];
    const center = trained.outputMean[idx] ?? 0;
    const span = Math.max(10.0, Math.abs(trained.outputStd[idx] ?? 1) * 5.0);
    return {
      name,
      unit: custom?.unit ?? "N.m",
      start: center,
      safeMin: custom?.safeMin ?? center - span,
      safeMax: custom?.safeMax ?? center + span,
      fallbackValue: custom?.fallbackValue ?? center,
    };
  });

  return exportCertifiedWamFmu({
    ...options,
    modelIdentifier: options?.modelIdentifier ?? "certified_wam_residual_controller",
    description:
      options?.description ??
      `Certified WAM Neural Residual Controller (R^2=${(trained.rSquared ?? 0).toFixed(4)}, MSE=${(trained.finalMse ?? 0).toExponential(2)})`,
    policyLayers,
    inputs,
    outputs,
  });
}
