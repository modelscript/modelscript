// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Set-Based Dataset Geometry, Isomorphic Decontamination,
 * Manifold Coverage Analysis, and Constrained Zonotope Variant Synthesis.
 *
 * Provides three formal set-based dataset curation primitives built directly atop the
 * 4-column Typed Relational Hypergraph (`compileRelationalHypergraph`) and exact
 * Constrained Zonotope arithmetic (`ConstrainedZonotope`):
 *
 *   1. `auditIsomorphicContamination`: Detects renamed-variable and rescaled-parameter
 *      train/eval leaks via renaming-invariant canonical hypergraph signatures.
 *   2. `analyzeGeometricCoverage`: Profiles `m_init` complexity bands and numeric parameter
 *      ranges across a corpus to surface sparse "manifold holes".
 *   3. `synthesizeConstrainedVariants`: Samples diverse, physically valid parameter variants
 *      strictly inside a `ConstrainedZonotope` (`||xi||_inf <= 1, A xi = b, C xi <= d`).
 */

import { ConstrainedZonotope, solveBoundedLp } from "../analysis/wasm_constrained_zonotope.js";
import { compileRelationalHypergraph, fnv1a32 } from "./hypergraph-compiler.js";
import type { RecipeExampleInput } from "./recipe-debugger.js";
import type { RelTypeId, RelationalHypergraphRecord, RelationalTokenSpan } from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Deterministic Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveHypergraph(example: RecipeExampleInput): RelationalHypergraphRecord {
  if (example.hypergraph) return example.hypergraph;
  return compileRelationalHypergraph({
    source: example.source,
    uri: example.uri,
    dialect: example.dialect,
  });
}

function resolveExampleId(example: RecipeExampleInput, record: RelationalHypergraphRecord): string {
  return example.exampleId ?? record.exampleId;
}

function isNumericTokenText(text: string): boolean {
  return /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
}

function isStringTokenText(text: string): boolean {
  return (
    (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) ||
    (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Renaming-Invariant Hypergraph Isomorphic Decontamination
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalStructuralTuple = readonly [canonicalGroupId: number, relTypeId: RelTypeId, relSign: number];

export interface CanonicalHypergraphSignature {
  /** Active `groupIds` renumbered by order of first appearance (`0` remains `0`). */
  canonicalGroupSeq: number[];
  /** Aligned relation type IDs. */
  relTypeIds: RelTypeId[];
  /** Aligned coupling signs. */
  relSigns: number[];
  /** Canonical structural tuples `[canonicalGroupId, relTypeId, relSign]`. */
  tuples: CanonicalStructuralTuple[];
  /** Structural token encodings used for exact isomorphism & k-gram comparison. */
  encodedTokens: string[];
  /** Raw lexed token texts (or stringified tokenIds) used to confirm exact-hash matches. */
  rawTokenTexts: string[];
  /** Exact token-sequence hash (sensitive to identifier names and literal values). */
  exactTokenHash: number;
  /** Renaming- and rescaling-invariant structural signature hash. */
  structuralHash: number;
}

export interface IsomorphicContaminationMatch {
  trainUri: string;
  trainExampleId: string;
  evalUri: string;
  evalExampleId: string;
  matchKind: "exact-hash" | "hypergraph-isomorphic";
  similarity: number;
}

export interface IsomorphicContaminationReport {
  trainCount: number;
  evalCount: number;
  isomorphicLeakCount: number;
  contaminationRate: number;
  matches: IsomorphicContaminationMatch[];
  recommendedQuarantineIds: string[];
}

/**
 * Canonicalizes a compiled `RelationalHypergraphRecord` into a renaming-invariant and
 * parameter-rescaling-invariant structural signature by renumbering active `groupIds`
 * (`> 0`) sequentially in order of first appearance.
 */
export function canonicalizeHypergraphSignature(record: RelationalHypergraphRecord): CanonicalHypergraphSignature {
  const len = record.groupIds.length;
  const groupMap = new Map<number, number>();
  let nextCanonicalGroup = 1;

  const canonicalGroupSeq = new Array<number>(len);
  const relTypeIds = new Array<RelTypeId>(len);
  const relSigns = new Array<number>(len);
  const tuples = new Array<CanonicalStructuralTuple>(len);
  const encodedTokens = new Array<string>(len);
  const rawTokenTexts: string[] = [];

  for (let i = 0; i < len; i++) {
    const rawGroup = record.groupIds[i] ?? 0;
    const relType = record.relTypeIds[i] ?? (0 as RelTypeId);
    const relSign = record.relSigns[i] ?? 0;
    const span = record.spans[i];

    let canonGroup = 0;
    if (rawGroup > 0) {
      let mapped = groupMap.get(rawGroup);
      if (mapped === undefined) {
        mapped = nextCanonicalGroup++;
        groupMap.set(rawGroup, mapped);
      }
      canonGroup = mapped;
    }

    canonicalGroupSeq[i] = canonGroup;
    relTypeIds[i] = relType;
    relSigns[i] = relSign;
    tuples[i] = [canonGroup, relType, relSign] as const;

    if (span) {
      rawTokenTexts.push(span.text);
    } else {
      rawTokenTexts.push(String(record.tokenIds[i] ?? 0));
    }

    // Active tokens are represented solely by [canonGroup, relType, relSign] so renaming any
    // symbol (`R -> R_load`, `v -> voltage`) produces the exact same canonical sequence.
    // Locked syntax tokens distinguish structural operators/keywords while normalizing numeric
    // and string literals (`#NUM`, `#STR`) so parameter rescaling is also invariant.
    if (canonGroup > 0) {
      encodedTokens[i] = `G${canonGroup}:${relType}:${relSign}`;
    } else if (span) {
      let lockedTag: string;
      if (isNumericTokenText(span.text)) {
        lockedTag = "#NUM";
      } else if (isStringTokenText(span.text)) {
        lockedTag = "#STR";
      } else {
        lockedTag = span.text;
      }
      encodedTokens[i] = `0:${relType}:${relSign}:${lockedTag}`;
    } else {
      encodedTokens[i] = `0:${relType}:${relSign}`;
    }
  }

  const exactTokenHash = fnv1a32(rawTokenTexts.join("\0"));
  const structuralHash = fnv1a32(encodedTokens.join("|"));

  return {
    canonicalGroupSeq,
    relTypeIds,
    relSigns,
    tuples,
    encodedTokens,
    rawTokenTexts,
    exactTokenHash,
    structuralHash,
  };
}

function buildCanonicalShingles(encodedTokens: string[], k = 4): Map<number, number> {
  const counts = new Map<number, number>();
  if (encodedTokens.length === 0) return counts;
  const win = Math.min(k, encodedTokens.length);
  for (let i = 0; i <= encodedTokens.length - win; i++) {
    const h = fnv1a32(encodedTokens.slice(i, i + win).join("|"));
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return counts;
}

function multisetJaccard(a: Map<number, number>, b: Map<number, number>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  if (a.size === 0 || b.size === 0) return 0.0;
  let inter = 0;
  let union = 0;
  for (const [key, countA] of a.entries()) {
    const countB = b.get(key) ?? 0;
    inter += Math.min(countA, countB);
    union += Math.max(countA, countB);
  }
  for (const [key, countB] of b.entries()) {
    if (!a.has(key)) {
      union += countB;
    }
  }
  return union > 0 ? inter / union : 0;
}

function computeCanonicalSignatureSimilarity(
  a: CanonicalHypergraphSignature,
  aShingles: Map<number, number>,
  b: CanonicalHypergraphSignature,
  bShingles: Map<number, number>,
): number {
  if (
    a.structuralHash === b.structuralHash &&
    a.encodedTokens.length === b.encodedTokens.length &&
    a.encodedTokens.every((tok, idx) => tok === b.encodedTokens[idx])
  ) {
    return 1.0;
  }
  if (a.encodedTokens.length === 0 || b.encodedTokens.length === 0) {
    return 0.0;
  }
  return multisetJaccard(aShingles, bShingles);
}

/**
 * Audits training examples against held-out evaluation examples for both exact token matches
 * and renaming-/rescaling-invariant hypergraph-isomorphic leaks that raw text matching misses.
 */
export function auditIsomorphicContamination(
  trainExamples: RecipeExampleInput[],
  evalExamples: RecipeExampleInput[],
  threshold = 0.85,
): IsomorphicContaminationReport {
  const safeThreshold = Math.max(0, Math.min(1, threshold));

  const evalPrepared = evalExamples.map((ev) => {
    const record = resolveHypergraph(ev);
    const sig = canonicalizeHypergraphSignature(record);
    return {
      uri: ev.uri,
      exampleId: resolveExampleId(ev, record),
      dialect: record.dialect,
      sig,
      shingles: buildCanonicalShingles(sig.encodedTokens),
    };
  });

  const matches: IsomorphicContaminationMatch[] = [];
  const quarantinedSet = new Set<string>();

  for (const tr of trainExamples) {
    const trRecord = resolveHypergraph(tr);
    const trId = resolveExampleId(tr, trRecord);
    const trSig = canonicalizeHypergraphSignature(trRecord);
    const trShingles = buildCanonicalShingles(trSig.encodedTokens);

    let bestMatch: IsomorphicContaminationMatch | null = null;

    for (const ev of evalPrepared) {
      // Exact token hash match takes immediate priority
      if (
        trSig.exactTokenHash === ev.sig.exactTokenHash &&
        trSig.rawTokenTexts.length === ev.sig.rawTokenTexts.length &&
        trSig.rawTokenTexts.every((tok, idx) => tok === ev.sig.rawTokenTexts[idx])
      ) {
        bestMatch = {
          trainUri: tr.uri,
          trainExampleId: trId,
          evalUri: ev.uri,
          evalExampleId: ev.exampleId,
          matchKind: "exact-hash",
          similarity: 1.0,
        };
        break;
      }

      const sim = computeCanonicalSignatureSimilarity(trSig, trShingles, ev.sig, ev.shingles);
      if (sim >= safeThreshold) {
        if (!bestMatch || sim > bestMatch.similarity) {
          bestMatch = {
            trainUri: tr.uri,
            trainExampleId: trId,
            evalUri: ev.uri,
            evalExampleId: ev.exampleId,
            matchKind: "hypergraph-isomorphic",
            similarity: Number(sim.toFixed(4)),
          };
        }
      }
    }

    if (bestMatch) {
      matches.push(bestMatch);
      quarantinedSet.add(trId);
    }
  }

  return {
    trainCount: trainExamples.length,
    evalCount: evalExamples.length,
    isomorphicLeakCount: quarantinedSet.size,
    contaminationRate: trainExamples.length > 0 ? Number((quarantinedSet.size / trainExamples.length).toFixed(4)) : 0,
    matches,
    recommendedQuarantineIds: Array.from(quarantinedSet),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared Numeric Parameter Extractor (Modelica, OpenSCAD, SysML2, SPICE, C)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExtractedNumericParameter {
  name: string;
  value: number;
  /** Start offset in `source` of the numeric literal (including optional unary `-`/`+`). */
  valueStartOffset: number;
  /** End offset in `source` of the numeric literal. */
  valueEndOffset: number;
  /** Raw literal text (including optional unary sign). */
  rawText: string;
}

const VALID_PARAM_FOLLOWERS = new Set([";", ",", ")", "]", "}", undefined]);

/**
 * Extracts simple numeric parameter assignments (`name = <num>`, `name := <num>`,
 * or Modelica modified declarations `name(unit="Ohm") = <num>`) from compiled hypergraph spans.
 */
export function extractNumericParameters(source: string, spans: RelationalTokenSpan[]): ExtractedNumericParameter[] {
  const results: ExtractedNumericParameter[] = [];
  const n = spans.length;

  for (let i = 0; i < n; i++) {
    const tok = spans[i]!;
    if (tok.groupId <= 0 || !/^[A-Za-z_]\w*$/.test(tok.text)) {
      continue;
    }

    let assignIdx = i + 1;
    // Handle Modelica declaration modifiers like `parameter Real R(unit="Ohm") = 100.0;`
    if (assignIdx < n && spans[assignIdx]!.text === "(") {
      let depth = 1;
      assignIdx++;
      while (assignIdx < n && depth > 0) {
        const t = spans[assignIdx]!.text;
        if (t === "(") depth++;
        else if (t === ")") depth--;
        assignIdx++;
      }
    }

    if (assignIdx >= n) continue;
    const opTok = spans[assignIdx]!;
    if (opTok.text !== "=" && opTok.text !== ":=") continue;

    let numIdx = assignIdx + 1;
    let sign = 1;
    let signStartOffset: number | null = null;
    if (numIdx < n && (spans[numIdx]!.text === "-" || spans[numIdx]!.text === "+")) {
      sign = spans[numIdx]!.text === "-" ? -1 : 1;
      signStartOffset = spans[numIdx]!.startOffset;
      numIdx++;
    }

    if (numIdx >= n) continue;
    const numTok = spans[numIdx]!;
    if (!isNumericTokenText(numTok.text)) continue;

    // Ensure RHS is a standalone numeric literal rather than the left operand of a compound expression
    const afterTok = numIdx + 1 < n ? spans[numIdx + 1]!.text : undefined;
    if (!VALID_PARAM_FOLLOWERS.has(afterTok)) continue;

    const parsed = Number(numTok.text);
    if (!Number.isFinite(parsed)) continue;

    const valueStartOffset = signStartOffset ?? numTok.startOffset;
    const valueEndOffset = numTok.endOffset;
    results.push({
      name: tok.text,
      value: sign * parsed,
      valueStartOffset,
      valueEndOffset,
      rawText: source.slice(valueStartOffset, valueEndOffset),
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Geometric Coverage & Sparse Manifold Hole Analyzer
// ─────────────────────────────────────────────────────────────────────────────

export type MInitBandLabel = "[0..2]" | "[3..6]" | "[7..12]" | "[13..24]" | "[25+]";

interface MInitBandSpec {
  band: MInitBandLabel;
  minM: number;
  maxM: number | null;
}

const M_INIT_BAND_SPECS: readonly MInitBandSpec[] = [
  { band: "[0..2]", minM: 0, maxM: 2 },
  { band: "[3..6]", minM: 3, maxM: 6 },
  { band: "[7..12]", minM: 7, maxM: 12 },
  { band: "[13..24]", minM: 13, maxM: 24 },
  { band: "[25+]", minM: 25, maxM: null },
];

export interface MInitBandCoverage {
  band: MInitBandLabel;
  minM: number;
  maxM: number | null;
  count: number;
  share: number;
  sparse: boolean;
  exampleIds: string[];
}

export interface ParameterRangeCoverage {
  symbol: string;
  count: number;
  distinctCount: number;
  min: number;
  max: number;
  mean: number;
  span: number;
  relativeSpan: number;
  narrow: boolean;
  values: number[];
}

export interface ManifoldHole {
  kind: "empty-m-band" | "sparse-m-band" | "narrow-parameter-range";
  target: string;
  severity: "high" | "medium";
  observedCount: number;
  detail: string;
  suggestedAction: string;
}

export interface GeometricCoverageOptions {
  /** Minimum share of examples per `m_init` band before flagging it as sparse (default: `0.05`). */
  minBandShare?: number | undefined;
  /** Minimum absolute example count per `m_init` band (default: `1`). */
  minBandCount?: number | undefined;
  /** Minimum relative parameter span `(max - min) / max(|mean|, 1e-9)` before flagging as narrow (default: `0.1`). */
  minRelativeParameterSpan?: number | undefined;
}

export interface GeometricCoverageReport {
  totalExamples: number;
  coverageScore: number;
  mInitBands: MInitBandCoverage[];
  parameterRanges: Record<string, ParameterRangeCoverage>;
  manifoldHoles: ManifoldHole[];
}

function classifyMInitBand(mInit: number): MInitBandSpec {
  for (const spec of M_INIT_BAND_SPECS) {
    if (mInit >= spec.minM && (spec.maxM === null || mInit <= spec.maxM)) {
      return spec;
    }
  }
  return M_INIT_BAND_SPECS[M_INIT_BAND_SPECS.length - 1]!;
}

/**
 * Analyzes `m_init` complexity-band coverage (`[0..2]`, `[3..6]`, `[7..12]`, `[13..24]`, `[25+]`)
 * and per-symbol numeric parameter ranges across a corpus, pinpointing sparse manifold holes
 * that should be filled via constrained synthesis or targeted curation.
 */
export function analyzeGeometricCoverage(
  examples: RecipeExampleInput[],
  options: GeometricCoverageOptions = {},
): GeometricCoverageReport {
  const totalExamples = examples.length;
  const minBandShare = Math.max(0, options.minBandShare ?? 0.05);
  const minBandCount = Math.max(1, options.minBandCount ?? 1);
  const minRelParamSpan = Math.max(0, options.minRelativeParameterSpan ?? 0.1);

  const bandBuckets = new Map<MInitBandLabel, string[]>();
  for (const spec of M_INIT_BAND_SPECS) {
    bandBuckets.set(spec.band, []);
  }

  const paramValues = new Map<string, number[]>();

  for (const ex of examples) {
    const rec = resolveHypergraph(ex);
    const exId = resolveExampleId(ex, rec);
    const bandSpec = classifyMInitBand(rec.mInit);
    bandBuckets.get(bandSpec.band)!.push(exId);

    const extracted = extractNumericParameters(ex.source, rec.spans);
    for (const p of extracted) {
      let arr = paramValues.get(p.name);
      if (!arr) {
        arr = [];
        paramValues.set(p.name, arr);
      }
      arr.push(p.value);
    }
  }

  const manifoldHoles: ManifoldHole[] = [];
  const requiredPerBand = Math.max(minBandCount, Math.ceil(totalExamples * minBandShare));

  const mInitBands: MInitBandCoverage[] = M_INIT_BAND_SPECS.map((spec) => {
    const ids = bandBuckets.get(spec.band)!;
    const count = ids.length;
    const share = totalExamples > 0 ? Number((count / totalExamples).toFixed(4)) : 0;
    const sparse = count === 0 || (totalExamples > 0 && count < requiredPerBand);

    if (count === 0) {
      manifoldHoles.push({
        kind: "empty-m-band",
        target: spec.band,
        severity: "high",
        observedCount: 0,
        detail: `No training examples cover m_init complexity band ${spec.band}.`,
        suggestedAction: `Add or synthesize models with ${spec.minM}${spec.maxM !== null ? `..${spec.maxM}` : "+"} coupled generators.`,
      });
    } else if (sparse) {
      manifoldHoles.push({
        kind: "sparse-m-band",
        target: spec.band,
        severity: "medium",
        observedCount: count,
        detail: `Complexity band ${spec.band} is under-represented (${count}/${totalExamples}, ${(share * 100).toFixed(1)}% < ${(minBandShare * 100).toFixed(1)}%).`,
        suggestedAction: `Augment m_init band ${spec.band} to at least ${requiredPerBand} examples.`,
      });
    }

    return {
      band: spec.band,
      minM: spec.minM,
      maxM: spec.maxM,
      count,
      share,
      sparse,
      exampleIds: ids,
    };
  });

  const parameterRanges: Record<string, ParameterRangeCoverage> = {};
  let multiSampleParams = 0;
  let diverseParams = 0;

  for (const [symbol, values] of Array.from(paramValues.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const distinct = new Set<number>();

    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      distinct.add(Number(v.toPrecision(10)));
    }

    const mean = sum / values.length;
    const span = max - min;
    const denom = Math.max(Math.abs(mean), 1e-9);
    const relativeSpan = span / denom;
    const narrow = values.length >= 2 && (distinct.size <= 1 || relativeSpan < minRelParamSpan);

    if (values.length >= 2) {
      multiSampleParams++;
      if (!narrow) diverseParams++;
    }

    if (narrow) {
      manifoldHoles.push({
        kind: "narrow-parameter-range",
        target: symbol,
        severity: distinct.size <= 1 ? "high" : "medium",
        observedCount: values.length,
        detail:
          distinct.size <= 1
            ? `Parameter '${symbol}' is constant (${min}) across all ${values.length} occurrences.`
            : `Parameter '${symbol}' has narrow relative span ${(relativeSpan * 100).toFixed(2)}% ([${min}, ${max}]) across ${values.length} occurrences.`,
        suggestedAction: `Use synthesizeConstrainedVariants() to expand feasible coverage for '${symbol}'.`,
      });
    }

    parameterRanges[symbol] = {
      symbol,
      count: values.length,
      distinctCount: distinct.size,
      min: Number(min.toFixed(6)),
      max: Number(max.toFixed(6)),
      mean: Number(mean.toFixed(6)),
      span: Number(span.toFixed(6)),
      relativeSpan: Number(relativeSpan.toFixed(4)),
      narrow,
      values,
    };
  }

  let coverageScore = 0;
  if (totalExamples > 0) {
    const populatedBands = mInitBands.filter((b) => b.count > 0).length;
    const populatedRatio = populatedBands / mInitBands.length;

    // Normalized Shannon entropy over m_init bands in [0, 1]
    let entropy = 0;
    for (const b of mInitBands) {
      if (b.count > 0) {
        const p = b.count / totalExamples;
        entropy -= p * Math.log(p);
      }
    }
    const maxEntropy = Math.log(mInitBands.length);
    const balanceScore = maxEntropy > 0 ? entropy / maxEntropy : 0;

    const paramDiversityScore = multiSampleParams > 0 ? diverseParams / multiSampleParams : 1.0;

    coverageScore = Number(
      Math.max(0, Math.min(1, 0.55 * populatedRatio + 0.25 * balanceScore + 0.2 * paramDiversityScore)).toFixed(4),
    );
  }

  return {
    totalExamples,
    coverageScore,
    mInitBands,
    parameterRanges,
    manifoldHoles,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Constrained Zonotope Variant Synthesis (`C * xi <= d`, Positivity-Safe)
// ─────────────────────────────────────────────────────────────────────────────

export interface ParameterLinearConstraint {
  /** Linear coefficients keyed by parameter symbol name: `sum(coefficients[k] * x_k) <= rhs`. */
  coefficients: Record<string, number>;
  /** Right-hand side bound. */
  rhs: number;
  /** Constraint sense (default `"<="`). */
  sense?: "<=" | ">=" | "==" | undefined;
}

export interface SynthesizeConstrainedVariantsOptions {
  /** Number of diverse feasible interior variants to sample (default: `5`). */
  count?: number | undefined;
  /** Relative half-width perturbation around nominal parameter values (default: `0.35`, i.e. ±35%). */
  relativePerturbation?: number | undefined;
  /** Fallback absolute perturbation radius when a nominal parameter value is `0` (default: `0.5`). */
  zeroFallbackRadius?: number | undefined;
  /** Optional per-parameter absolute perturbation half-widths overriding `relativePerturbation`. */
  parameterRadii?: Record<string, number> | undefined;
  /** Optional allowlist of parameter names to perturb (defaults to all discovered numeric parameters). */
  parameterNames?: string[] | undefined;
  /** Enforce strict positivity (`x_k >= minPositiveValue`) for nominally positive parameters (default: `true`). */
  enforcePositivity?: boolean | undefined;
  /** Explicit list of parameters required to remain strictly positive even if nominal value is `<= 0`. */
  positiveParameters?: string[] | undefined;
  /** Lower bound floor for positivity constraints (default: `Math.min(1e-3, nominal * 0.05)`). */
  minPositiveValue?: number | undefined;
  /** Ergonomic parameter-space linear constraints converted via `ConstrainedZonotope.intersectHalfspace/Hyperplane`. */
  linearConstraints?: ParameterLinearConstraint[] | undefined;
  /** Optional direct generator-space inequality constraints `C * xi <= d`. */
  constraintsC?: number[][] | undefined;
  /** Optional direct generator-space inequality RHS `d` for `C * xi <= d`. */
  constraintsD?: number[] | undefined;
  /** Optional direct generator-space equality constraints `A * xi == b`. */
  constraintsA?: number[][] | undefined;
  /** Optional direct generator-space equality RHS `b` for `A * xi == b`. */
  constraintsB?: number[] | undefined;
  /** Optional base URI prefix for synthesized hypergraph records. */
  uri?: string | undefined;
  /** Deterministic PRNG seed (default: `2026`). */
  seed?: number | undefined;
}

export interface SynthesizedConstrainedVariant {
  source: string;
  parameters: Record<string, number>;
  xi: number[];
  hypergraph: RelationalHypergraphRecord;
}

export interface ConstrainedVariantSynthesisResult {
  feasible: boolean;
  parameterNames: string[];
  nominalParameters: Record<string, number>;
  constrainedZonotope: ConstrainedZonotope;
  variants: SynthesizedConstrainedVariant[];
}

function evaluateZonotopePoint(cz: ConstrainedZonotope, xi: number[]): number[] {
  const n = cz.dim;
  const p = cz.numGenerators;
  const out = [...cz.center];
  for (let j = 0; j < p; j++) {
    const xj = xi[j] ?? 0;
    const g = cz.generators[j]!;
    for (let i = 0; i < n; i++) {
      out[i] = (out[i] ?? 0) + (g[i] ?? 0) * xj;
    }
  }
  return out;
}

function isXiFeasible(cz: ConstrainedZonotope, xi: number[], tol = 1e-6): boolean {
  const p = cz.numGenerators;
  if (xi.length !== p) return false;
  for (let j = 0; j < p; j++) {
    const v = xi[j]!;
    if (!Number.isFinite(v) || v < -1 - tol || v > 1 + tol) return false;
  }
  for (let r = 0; r < cz.A.length; r++) {
    const row = cz.A[r]!;
    let sum = 0;
    for (let j = 0; j < p; j++) sum += (row[j] ?? 0) * xi[j]!;
    if (Math.abs(sum - (cz.b[r] ?? 0)) > tol) return false;
  }
  for (let r = 0; r < cz.C.length; r++) {
    const row = cz.C[r]!;
    let sum = 0;
    for (let j = 0; j < p; j++) sum += (row[j] ?? 0) * xi[j]!;
    if (sum > (cz.d[r] ?? 0) + tol) return false;
  }
  return true;
}

function l2Distance(a: number[], b: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

/**
 * Computes the exact feasible line segment `[tMin, tMax]` along ray `xi0 + t * dir`
 * inside `{ ||xi||_inf <= 1, C * xi <= d }`.
 */
function computeRayBounds(cz: ConstrainedZonotope, xi0: number[], dir: number[]): [number, number] {
  const p = cz.numGenerators;
  let tMin = -Infinity;
  let tMax = Infinity;

  // Box constraints: -1 <= xi0[j] + t * dir[j] <= 1
  for (let j = 0; j < p; j++) {
    const d = dir[j]!;
    const x = xi0[j]!;
    if (Math.abs(d) <= 1e-12) continue;
    const t1 = (-1 - x) / d;
    const t2 = (1 - x) / d;
    const lo = Math.min(t1, t2);
    const hi = Math.max(t1, t2);
    if (lo > tMin) tMin = lo;
    if (hi < tMax) tMax = hi;
  }

  // Inequality constraints: C_r . (xi0 + t * dir) <= d_r
  for (let r = 0; r < cz.C.length; r++) {
    const row = cz.C[r]!;
    let dotX = 0;
    let dotD = 0;
    for (let j = 0; j < p; j++) {
      const cVal = row[j] ?? 0;
      dotX += cVal * xi0[j]!;
      dotD += cVal * dir[j]!;
    }
    const slack = (cz.d[r] ?? 0) - dotX;
    if (dotD > 1e-12) {
      const bound = slack / dotD;
      if (bound < tMax) tMax = bound;
    } else if (dotD < -1e-12) {
      const bound = slack / dotD;
      if (bound > tMin) tMin = bound;
    }
  }

  if (tMin > tMax) {
    return [0, 0];
  }
  return [tMin, tMax];
}

/**
 * Samples `count` diverse feasible interior points in generator space `xi` inside `cz`
 * via bounded LP vertex discovery, convex interior centering, hit-and-run sampling,
 * and farthest-point diversity selection.
 */
function sampleFeasibleInteriorPoints(cz: ConstrainedZonotope, count: number, seed: number): number[][] {
  const p = cz.numGenerators;
  if (p === 0 || count <= 0) return [];
  const rng = createSeededRng(seed);

  // 1. Discover extreme feasible vertices along coordinate & random objective directions
  const vertices: number[][] = [];
  const addVertexIfValid = (xi: number[]) => {
    if (!isXiFeasible(cz, xi, 1e-5)) return;
    const clamped = xi.map((v) => Math.max(-1, Math.min(1, v)));
    if (!isXiFeasible(cz, clamped, 1e-5)) return;
    if (!vertices.some((existing) => l2Distance(existing, clamped) < 1e-6)) {
      vertices.push(clamped);
    }
  };

  for (let j = 0; j < p; j++) {
    for (const sign of [1, -1]) {
      const w = new Array<number>(p).fill(0);
      w[j] = sign;
      const res = solveBoundedLp(w, cz.A, cz.b, cz.C, cz.d);
      if (res.status === "INFEASIBLE") {
        return [];
      }
      if (res.xi.length === p) {
        addVertexIfValid(res.xi);
      }
    }
  }

  const extraDirs = Math.min(24, Math.max(8, p * 4));
  for (let d = 0; d < extraDirs; d++) {
    const w = Array.from({ length: p }, () => rng() * 2 - 1);
    const res = solveBoundedLp(w, cz.A, cz.b, cz.C, cz.d);
    if (res.status === "INFEASIBLE") {
      return [];
    }
    if (res.xi.length === p) {
      addVertexIfValid(res.xi);
    }
  }

  if (vertices.length === 0) {
    // Fallback check: try origin xi = 0
    const zero = new Array<number>(p).fill(0);
    if (isXiFeasible(cz, zero, 1e-6)) {
      vertices.push(zero);
    } else {
      return [];
    }
  }

  // 2. Compute strictly feasible interior barycenter of discovered vertices
  const barycenter = new Array<number>(p).fill(0);
  for (const v of vertices) {
    for (let j = 0; j < p; j++) {
      barycenter[j] = barycenter[j]! + v[j]! / vertices.length;
    }
  }

  // 3. Build rich pool of feasible interior candidates
  const candidates: number[][] = [];
  const pushCandidate = (xi: number[]) => {
    if (!isXiFeasible(cz, xi, 1e-6)) return;
    if (!candidates.some((c) => l2Distance(c, xi) < 1e-6)) {
      candidates.push(xi);
    }
  };

  // Start pool with barycenter and interior interpolations toward each vertex
  pushCandidate(barycenter);
  for (const v of vertices) {
    for (const alpha of [0.35, 0.65, 0.85]) {
      const pt = v.map((vj, j) => (1 - alpha) * barycenter[j]! + alpha * vj);
      pushCandidate(pt);
    }
  }

  const poolTarget = Math.max(count * 8, 32);

  // If no equality constraints, run hit-and-run random walk inside the polytope interior
  if (cz.A.length === 0) {
    let curr = [...barycenter];
    for (let step = 0; step < poolTarget * 2 && candidates.length < poolTarget; step++) {
      const dir = Array.from({ length: p }, () => {
        // Box-Muller approximate isotropic Gaussian direction
        const u1 = Math.max(1e-12, rng());
        const u2 = rng();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      });
      const norm = Math.sqrt(dir.reduce((acc, v) => acc + v * v, 0));
      if (norm <= 1e-12) continue;
      for (let j = 0; j < p; j++) dir[j] = dir[j]! / norm;

      const [tMin, tMax] = computeRayBounds(cz, curr, dir);
      const width = tMax - tMin;
      if (width > 1e-9) {
        // Keep strictly in the interior (5% inward margin on each end)
        const margin = 0.05 * width;
        const lo = tMin + margin;
        const hi = tMax - margin;
        const t = lo + rng() * Math.max(0, hi - lo);
        const next = curr.map((cVal, j) => cVal + t * dir[j]!);
        if (isXiFeasible(cz, next, 1e-6)) {
          curr = next;
          pushCandidate(next);
        }
      }
    }
  }

  // Also add random interior convex combinations of vertices (always respects A*xi = b AND C*xi <= d)
  let tries = 0;
  while (candidates.length < poolTarget && tries < poolTarget * 3 && vertices.length >= 2) {
    tries++;
    const weights = vertices.map(() => -Math.log(Math.max(1e-12, rng())) + 0.05);
    const wSum = weights.reduce((acc, v) => acc + v, 0);
    const pt = new Array<number>(p).fill(0);
    for (let vIdx = 0; vIdx < vertices.length; vIdx++) {
      const wNorm = weights[vIdx]! / wSum;
      const v = vertices[vIdx]!;
      for (let j = 0; j < p; j++) {
        pt[j] = pt[j]! + wNorm * v[j]!;
      }
    }
    pushCandidate(pt);
  }

  if (candidates.length <= count) {
    return candidates.slice(0, count);
  }

  // 4. Farthest-point diversity selection starting from the candidate farthest from barycenter
  const selected: number[][] = [];
  let firstIdx = 0;
  let bestStartDist = -1;
  for (let i = 0; i < candidates.length; i++) {
    const d = l2Distance(candidates[i]!, barycenter);
    if (d > bestStartDist) {
      bestStartDist = d;
      firstIdx = i;
    }
  }
  selected.push(candidates[firstIdx]!);
  const used = new Set<number>([firstIdx]);

  while (selected.length < count) {
    let bestIdx = -1;
    let bestMinDist = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      let minDist = Infinity;
      for (const s of selected) {
        const d = l2Distance(candidates[i]!, s);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    used.add(bestIdx);
    selected.push(candidates[bestIdx]!);
  }

  return selected;
}

function formatNumericLiteral(value: number, positiveFloor?: number): string {
  const safeVal = positiveFloor !== undefined ? Math.max(positiveFloor, value) : value;
  const rounded = Number(safeVal.toFixed(6));
  const finalVal = positiveFloor !== undefined && rounded <= 0 ? Number(safeVal.toPrecision(6)) : rounded;
  const text = Object.is(finalVal, -0) ? "0" : String(finalVal);
  return text;
}

/**
 * Models numeric parameter perturbations in `source` as a `ConstrainedZonotope` subject to
 * physical positivity and user linear constraints (`C * xi <= d`, `A * xi = b`), samples
 * `count` diverse feasible interior points, and substitutes the perturbed parameter values
 * cleanly into `source` along with fresh compiled 4-column hypergraphs.
 */
export function synthesizeConstrainedVariants(
  source: string,
  dialect: string,
  options: SynthesizeConstrainedVariantsOptions = {},
): ConstrainedVariantSynthesisResult {
  const count = Math.max(0, options.count ?? 5);
  const relPerturb = Math.max(0, options.relativePerturbation ?? 0.35);
  const zeroFallback = Math.max(1e-6, options.zeroFallbackRadius ?? 0.5);
  const enforcePositivity = options.enforcePositivity ?? true;
  const seed = options.seed ?? 2026;
  const baseUri = options.uri ?? `memory://synthesized.${dialect}`;

  const baseHg = compileRelationalHypergraph({ source, uri: baseUri, dialect });
  const extracted = extractNumericParameters(source, baseHg.spans);

  const allowedNames = options.parameterNames ? new Set(options.parameterNames) : null;
  const positiveSet = new Set(options.positiveParameters ?? []);

  // Group extracted literal occurrences by parameter name (preserving discovery order)
  const paramNames: string[] = [];
  const nominalParameters: Record<string, number> = {};
  const occurrencesByName = new Map<string, ExtractedNumericParameter[]>();

  for (const item of extracted) {
    if (allowedNames && !allowedNames.has(item.name)) continue;
    let list = occurrencesByName.get(item.name);
    if (!list) {
      list = [];
      occurrencesByName.set(item.name, list);
      paramNames.push(item.name);
      nominalParameters[item.name] = item.value;
    }
    list.push(item);
  }

  const n = paramNames.length;
  if (n === 0 || count === 0) {
    return {
      feasible: n > 0,
      parameterNames: paramNames,
      nominalParameters,
      constrainedZonotope: new ConstrainedZonotope([], []),
      variants: [],
    };
  }

  const center = paramNames.map((name) => nominalParameters[name]!);
  const generators: number[][] = paramNames.map((name, idx) => {
    const col = new Array<number>(n).fill(0);
    const customRadius = options.parameterRadii?.[name];
    const nominal = center[idx]!;
    const radius =
      customRadius !== undefined
        ? Math.max(0, customRadius)
        : Math.abs(nominal) > 1e-12
          ? Math.abs(nominal) * relPerturb
          : zeroFallback;
    col[idx] = radius;
    return col;
  });

  let cz = new ConstrainedZonotope(center, generators);

  // Enforce physical positivity constraints via exact halfspace intersection: -x_k <= -floor
  const positiveFloors = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const name = paramNames[i]!;
    const nominal = center[i]!;
    const mustBePositive = positiveSet.has(name) || (enforcePositivity && nominal > 0);
    if (mustBePositive) {
      const floor =
        options.minPositiveValue !== undefined
          ? Math.max(1e-9, options.minPositiveValue)
          : nominal > 0
            ? Math.min(1e-3, nominal * 0.05)
            : 1e-3;
      positiveFloors.set(name, floor);
      const h = new Array<number>(n).fill(0);
      h[i] = -1;
      cz = cz.intersectHalfspace(h, -floor);
    }
  }

  // Apply user parameter-space linear constraints
  const nameToIndex = new Map<string, number>();
  paramNames.forEach((name, idx) => nameToIndex.set(name, idx));

  if (options.linearConstraints) {
    for (const lc of options.linearConstraints) {
      const h = new Array<number>(n).fill(0);
      let hasActiveCoeff = false;
      for (const [sym, coeff] of Object.entries(lc.coefficients)) {
        const idx = nameToIndex.get(sym);
        if (idx !== undefined && Math.abs(coeff) > 0) {
          h[idx] = coeff;
          hasActiveCoeff = true;
        }
      }
      if (!hasActiveCoeff) continue;
      const sense = lc.sense ?? "<=";
      if (sense === "<=") {
        cz = cz.intersectHalfspace(h, lc.rhs);
      } else if (sense === ">=") {
        cz = cz.intersectHalfspace(
          h.map((v) => -v),
          -lc.rhs,
        );
      } else {
        cz = cz.intersectHyperplane(h, lc.rhs);
      }
    }
  }

  // Apply any direct generator-space constraints C * xi <= d and A * xi == b
  if (options.constraintsC && options.constraintsD) {
    const m = Math.min(options.constraintsC.length, options.constraintsD.length);
    for (let r = 0; r < m; r++) {
      const row = options.constraintsC[r]!;
      const padded = new Array<number>(cz.numGenerators).fill(0);
      for (let j = 0; j < Math.min(row.length, cz.numGenerators); j++) {
        padded[j] = row[j]!;
      }
      cz.C.push(padded);
      cz.d.push(options.constraintsD[r]!);
    }
  }

  if (options.constraintsA && options.constraintsB) {
    const m = Math.min(options.constraintsA.length, options.constraintsB.length);
    for (let r = 0; r < m; r++) {
      const row = options.constraintsA[r]!;
      const padded = new Array<number>(cz.numGenerators).fill(0);
      for (let j = 0; j < Math.min(row.length, cz.numGenerators); j++) {
        padded[j] = row[j]!;
      }
      cz.A.push(padded);
      cz.b.push(options.constraintsB[r]!);
    }
  }

  if (!cz.isFeasible()) {
    return {
      feasible: false,
      parameterNames: paramNames,
      nominalParameters,
      constrainedZonotope: cz,
      variants: [],
    };
  }

  const sampledXis = sampleFeasibleInteriorPoints(cz, count, seed);
  const variants: SynthesizedConstrainedVariant[] = [];

  for (let vIdx = 0; vIdx < sampledXis.length; vIdx++) {
    const xi = sampledXis[vIdx]!;
    const vec = evaluateZonotopePoint(cz, xi);
    const parameters: Record<string, number> = {};
    const replacements: { startOffset: number; endOffset: number; text: string }[] = [];

    for (let i = 0; i < n; i++) {
      const name = paramNames[i]!;
      const floor = positiveFloors.get(name);
      const formatted = formatNumericLiteral(vec[i]!, floor);
      parameters[name] = Number(formatted);
      for (const occ of occurrencesByName.get(name)!) {
        replacements.push({
          startOffset: occ.valueStartOffset,
          endOffset: occ.valueEndOffset,
          text: formatted,
        });
      }
    }

    // Substitute literals from right to left so character offsets remain exact
    replacements.sort((a, b) => b.startOffset - a.startOffset);
    let variantSource = source;
    for (const rep of replacements) {
      variantSource = variantSource.slice(0, rep.startOffset) + rep.text + variantSource.slice(rep.endOffset);
    }

    const hypergraph = compileRelationalHypergraph({
      source: variantSource,
      uri: `${baseUri}#variant_${vIdx}`,
      dialect,
    });

    variants.push({
      source: variantSource,
      parameters,
      xi: xi.map((v) => Number(v.toFixed(6))),
      hypergraph,
    });
  }

  return {
    feasible: variants.length > 0,
    parameterNames: paramNames,
    nominalParameters,
    constrainedZonotope: cz,
    variants,
  };
}
