// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Brownfield Seed Alignment & Trigram Matching Engine for @modelscript/runtime.
 *
 * Automatically correlates disparate brownfield engineering assets (STEP CAD parts,
 * Modelica dynamic models, SysML v2 logical blocks, and ReqIF requirements)
 * using multi-signal heuristic alignment:
 * 1. Domain acronym & abbreviation expansion (e.g., Mtr_Assy_01 <-> ElectricMotor)
 * 2. Character trigram fuzzy similarity (Dex-style inverted trigrams)
 * 3. Structural neighborhood affinity (ports, hierarchy, and child elements)
 *
 * Seeds high-confidence matches (>= 0.85) directly into DigitalThreadHypergraph
 * and WASM CorrespondenceIndex to bootstrap the Digital Thread without manual wiring.
 */

import { DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export interface AlignmentElement {
  id: string | number;
  name: string;
  domain: ThreadDomain | string;
  type?: string;
  ports?: string[];
  children?: string[];
  properties?: Record<string, any>;
}

export interface AlignmentScoreBreakdown {
  tokenScore: number;
  trigramScore: number;
  structuralScore: number;
  acronymBonus: number;
}

export interface AlignmentCandidate {
  sourceId: string | number;
  sourceName: string;
  sourceDomain: ThreadDomain | string;
  targetId: string | number;
  targetName: string;
  targetDomain: ThreadDomain | string;
  confidence: number;
  breakdown: AlignmentScoreBreakdown;
  reasoning: string;
}

export interface BrownfieldAlignmentOptions {
  minConfidence?: number;
  customAcronyms?: Record<string, string>;
  tokenWeight?: number;
  trigramWeight?: number;
  structuralWeight?: number;
}

export const DEFAULT_DOMAIN_ACRONYMS: Record<string, string> = {
  // Mechanical & Automotive
  mtr: "motor",
  eng: "engine",
  brkt: "bracket",
  asm: "assembly",
  assy: "assembly",
  spd: "speed",
  sens: "sensor",
  ctrl: "controller",
  pwr: "power",
  volt: "voltage",
  curr: "current",
  temp: "temperature",
  press: "pressure",
  hyd: "hydraulic",
  pneu: "pneumatic",
  batt: "battery",
  tx: "transmission",
  whl: "wheel",
  sys: "system",
  elem: "element",
  cyl: "cylinder",
  pos: "position",
  vel: "velocity",
  acc: "acceleration",
  pmp: "pump",
  vlv: "valve",
  gen: "generator",
  inv: "inverter",
  res: "resistor",
  cap: "capacitor",
  ind: "inductor",
  mech: "mechanical",
  elec: "electrical",
  dyn: "dynamic",
  kin: "kinematic",
  flg: "flange",
  jnt: "joint",
  drv: "drive",
  act: "actuator",
  cmp: "component",
  env: "environment",
  steer: "steering",
  brk: "brake",
  chass: "chassis",
  susp: "suspension",
  calc: "calculation",
  param: "parameter",
  req: "requirement",
  spec: "specification",
};

export class BrownfieldAlignmentEngine {
  private acronymMap: Map<string, string> = new Map();
  private tokenWeight: number;
  private trigramWeight: number;
  private structuralWeight: number;

  constructor(options?: BrownfieldAlignmentOptions) {
    this.tokenWeight = options?.tokenWeight ?? 0.45;
    this.trigramWeight = options?.trigramWeight ?? 0.35;
    this.structuralWeight = options?.structuralWeight ?? 0.2;

    // Load defaults
    for (const [abbr, full] of Object.entries(DEFAULT_DOMAIN_ACRONYMS)) {
      this.acronymMap.set(abbr.toLowerCase(), full.toLowerCase());
    }

    // Load custom overrides
    if (options?.customAcronyms) {
      for (const [abbr, full] of Object.entries(options.customAcronyms)) {
        this.acronymMap.set(abbr.toLowerCase(), full.toLowerCase());
      }
    }
  }

  /**
   * Registers a custom domain abbreviation.
   */
  registerAcronym(abbreviation: string, expanded: string): void {
    this.acronymMap.set(abbreviation.toLowerCase(), expanded.toLowerCase());
  }

  /**
   * Tokenizes an identifier (camelCase, snake_case, kebab-case, numbers)
   * and expands domain acronyms.
   */
  tokenizeAndNormalize(name: string): string[] {
    // Replace underscores, hyphens, dots with spaces
    const spaced = name.replace(/[-_.]+/g, " ");
    // Split camelCase and PascalCase
    const splitCamel = spaced.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    // Extract alphanumeric tokens
    const rawTokens = splitCamel.toLowerCase().match(/[a-z0-9]+/g) || [];

    return rawTokens.map((tok) => {
      return this.acronymMap.get(tok) || tok;
    });
  }

  /**
   * Generates character trigrams from a normalized string.
   */
  computeTrigrams(text: string): Set<string> {
    const clean = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    const trigrams = new Set<string>();
    if (clean.length < 3) {
      if (clean.length > 0) trigrams.add(clean);
      return trigrams;
    }
    for (let i = 0; i <= clean.length - 3; i++) {
      trigrams.add(clean.substring(i, i + 3));
    }
    return trigrams;
  }

  /**
   * Computes Dice similarity coefficient between two trigram sets.
   */
  computeTrigramSimilarity(a: string, b: string): number {
    const triA = this.computeTrigrams(a);
    const triB = this.computeTrigrams(b);

    if (triA.size === 0 && triB.size === 0) return 1.0;
    if (triA.size === 0 || triB.size === 0) return 0.0;

    let matches = 0;
    for (const t of triA) {
      if (triB.has(t)) matches++;
    }

    return (2.0 * matches) / (triA.size + triB.size);
  }

  /**
   * Computes token overlap (Jaccard similarity) on normalized tokens.
   */
  computeTokenSimilarity(tokensA: string[], tokensB: string[]): { score: number; matchedTokens: string[] } {
    if (tokensA.length === 0 && tokensB.length === 0) return { score: 1.0, matchedTokens: [] };
    if (tokensA.length === 0 || tokensB.length === 0) return { score: 0.0, matchedTokens: [] };

    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    const matchedTokens: string[] = [];
    for (const tok of setA) {
      if (setB.has(tok)) {
        matchedTokens.push(tok);
      }
    }

    const unionSize = new Set([...tokensA, ...tokensB]).size;
    const score = unionSize === 0 ? 0 : matchedTokens.length / unionSize;

    return { score, matchedTokens };
  }

  /**
   * Evaluates structural affinity (compatible ports, child count, properties).
   */
  computeStructuralAffinity(source: AlignmentElement, target: AlignmentElement): number {
    let score = 0.5; // neutral baseline
    let signals = 0;

    // Compare ports
    if (source.ports && target.ports && source.ports.length > 0 && target.ports.length > 0) {
      signals++;
      const sourceNormPorts = source.ports.flatMap((p) => this.tokenizeAndNormalize(p));
      const targetNormPorts = target.ports.flatMap((p) => this.tokenizeAndNormalize(p));
      const { score: portScore } = this.computeTokenSimilarity(sourceNormPorts, targetNormPorts);
      score += (portScore - 0.5) * 0.4;
    }

    // Compare children
    if (source.children && target.children && source.children.length > 0 && target.children.length > 0) {
      signals++;
      const sourceNormChildren = source.children.flatMap((c) => this.tokenizeAndNormalize(c));
      const targetNormChildren = target.children.flatMap((c) => this.tokenizeAndNormalize(c));
      const { score: childScore } = this.computeTokenSimilarity(sourceNormChildren, targetNormChildren);
      score += (childScore - 0.5) * 0.4;
    }

    // Clamp between 0.0 and 1.0
    return Math.max(0.0, Math.min(1.0, score));
  }

  /**
   * Scores a single candidate pair.
   */
  scorePair(source: AlignmentElement, target: AlignmentElement): AlignmentCandidate {
    const tokensA = this.tokenizeAndNormalize(source.name);
    const tokensB = this.tokenizeAndNormalize(target.name);

    const normA = tokensA.join("");
    const normB = tokensB.join("");

    // Exact normalized match bonus
    const isExactNorm = normA.length > 0 && normA === normB;

    const { score: tokenScore, matchedTokens } = this.computeTokenSimilarity(tokensA, tokensB);
    const minTokenLen = Math.min(tokensA.length, tokensB.length);
    const overlapCoeff = minTokenLen === 0 ? 0 : matchedTokens.length / minTokenLen;
    const trigramScore = this.computeTrigramSimilarity(normA, normB);
    const structuralScore = this.computeStructuralAffinity(source, target);

    let confidence = 0;
    if (isExactNorm) {
      confidence = 0.95 + 0.05 * structuralScore;
    } else {
      confidence =
        this.tokenWeight * tokenScore + this.trigramWeight * trigramScore + this.structuralWeight * structuralScore;

      // Bonus if primary semantic tokens match (e.g. motor, bracket, pump, sensor)
      const primaryKeywords = [
        "motor",
        "engine",
        "bracket",
        "battery",
        "sensor",
        "pump",
        "valve",
        "chassis",
        "controller",
        "speed",
        "mount",
        "wheel",
        "radiator",
        "inverter",
        "transmission",
      ];
      const sharedKeywords = matchedTokens.filter((t) => primaryKeywords.includes(t));
      if (sharedKeywords.length > 0) {
        const anchorScore = 0.65 + 0.25 * overlapCoeff + 0.1 * structuralScore;
        confidence = Math.max(confidence, anchorScore);
      }
    }

    // Generate reasoning
    const reasons: string[] = [];
    if (isExactNorm) reasons.push("Exact normalized name match");
    if (matchedTokens.length > 0) reasons.push(`Shared semantic tokens: [${matchedTokens.join(", ")}]`);
    if (trigramScore > 0.6) reasons.push(`High trigram string similarity (${(trigramScore * 100).toFixed(0)}%)`);
    if (structuralScore > 0.6) reasons.push(`Compatible structural neighborhood`);

    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceDomain: source.domain,
      targetId: target.id,
      targetName: target.name,
      targetDomain: target.domain,
      confidence: Math.round(confidence * 1000) / 1000,
      breakdown: {
        tokenScore: Math.round(tokenScore * 100) / 100,
        trigramScore: Math.round(trigramScore * 100) / 100,
        structuralScore: Math.round(structuralScore * 100) / 100,
        acronymBonus: isExactNorm ? 0.2 : matchedTokens.length > 0 ? 0.1 : 0,
      },
      reasoning: reasons.join("; ") || "Weak lexical affinity",
    };
  }

  /**
   * Correlates source elements with target elements and ranks candidate alignments.
   */
  alignModels(
    sources: AlignmentElement[],
    targets: AlignmentElement[],
    options?: { minConfidence?: number; topKPerSource?: number },
  ): AlignmentCandidate[] {
    const minConfidence = options?.minConfidence ?? 0.5;
    const topK = options?.topKPerSource ?? 3;
    const candidates: AlignmentCandidate[] = [];

    for (const src of sources) {
      const srcMatches: AlignmentCandidate[] = [];
      for (const tgt of targets) {
        const candidate = this.scorePair(src, tgt);
        if (candidate.confidence >= minConfidence) {
          srcMatches.push(candidate);
        }
      }

      // Sort descending by confidence
      srcMatches.sort((a, b) => b.confidence - a.confidence);

      // Keep top K
      for (let k = 0; k < Math.min(topK, srcMatches.length); k++) {
        candidates.push(srcMatches[k]);
      }
    }

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Automatically seeds high-confidence alignments into DigitalThreadHypergraph.
   */
  applySeeds(
    candidates: AlignmentCandidate[],
    hypergraph: DigitalThreadHypergraph,
    options?: { minConfidence?: number; threadIdStart?: number },
  ): { seededCount: number; threadsCreated: number } {
    const minConfidence = options?.minConfidence ?? 0.85;
    let nextThreadId = options?.threadIdStart ?? hypergraph.getThreadCount() + 1000;
    let seededCount = 0;
    let threadsCreated = 0;

    const resolveDomainIdx = (d: ThreadDomain | string): ThreadDomain => {
      if (typeof d === "number") return d;
      const lower = d.toLowerCase();
      if (lower.includes("sysml")) return ThreadDomain.SysML2;
      if (lower.includes("modelica")) return ThreadDomain.Modelica;
      if (lower.includes("cad") || lower.includes("step")) return ThreadDomain.CAD;
      if (lower.includes("req")) return ThreadDomain.Requirements;
      if (lower.includes("fea")) return ThreadDomain.FEA;
      if (lower.includes("cfd")) return ThreadDomain.CFD;
      if (lower.includes("bom")) return ThreadDomain.BOM;
      if (lower.includes("fmu")) return ThreadDomain.FMU;
      return ThreadDomain.SysML2;
    };

    const resolveNodeId = (id: string | number): number => {
      if (typeof id === "number") return id;
      const match = id.match(/\d+/);
      return match
        ? parseInt(match[0], 10)
        : Math.abs(id.split("").reduce((acc, c) => (acc << 5) - acc + c.charCodeAt(0), 0) % 65535);
    };

    for (const cand of candidates) {
      if (cand.confidence < minConfidence) continue;

      const srcDomain = resolveDomainIdx(cand.sourceDomain);
      const tgtDomain = resolveDomainIdx(cand.targetDomain);
      const srcNodeId = resolveNodeId(cand.sourceId);
      const tgtNodeId = resolveNodeId(cand.targetId);

      // Check if source or target already belongs to an existing thread
      let slot = hypergraph.findSlotByDomainNode(srcDomain, srcNodeId);
      if (slot === undefined) {
        slot = hypergraph.findSlotByDomainNode(tgtDomain, tgtNodeId);
      }

      if (slot === undefined) {
        // Create new hypergraph thread
        const threadId = nextThreadId++;
        slot = hypergraph.createThread(threadId);
        threadsCreated++;
      }

      // Bind both nodes to the thread
      hypergraph.bindDomainNode(slot, srcDomain, srcNodeId);
      hypergraph.bindDomainNode(slot, tgtDomain, tgtNodeId);
      seededCount++;
    }

    return { seededCount, threadsCreated };
  }

  /**
   * Formats candidates as a formatted table string for CLI display.
   */
  formatCandidatesTable(candidates: AlignmentCandidate[]): string {
    if (candidates.length === 0) {
      return "No alignment candidates found above threshold.";
    }

    const rows: string[] = [];
    rows.push(
      "┌──────────────────────────────────┬──────────────────────────────────┬────────────┬────────────────────────────────────────┐",
    );
    rows.push(
      "│ Source Element                   │ Target Element                   │ Confidence │ Primary Rationale                      │",
    );
    rows.push(
      "├──────────────────────────────────┼──────────────────────────────────┼────────────┼────────────────────────────────────────┤",
    );

    const pad = (str: string, len: number) => {
      const s = str.length > len ? str.substring(0, len - 3) + "..." : str;
      return s.padEnd(len);
    };

    for (const c of candidates) {
      const srcStr = `[${c.sourceDomain}] ${c.sourceName}`;
      const tgtStr = `[${c.targetDomain}] ${c.targetName}`;
      const confStr = `${(c.confidence * 100).toFixed(1)}%`;
      rows.push(`│ ${pad(srcStr, 32)} │ ${pad(tgtStr, 32)} │ ${pad(confStr, 10)} │ ${pad(c.reasoning, 38)} │`);
    }

    rows.push(
      "└──────────────────────────────────┴──────────────────────────────────┴────────────┴────────────────────────────────────────┘",
    );
    return rows.join("\n");
  }
}
