// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Grammar-driven sample generator, mutation fuzzer, and CST unparser round-trip verifier.
 */

import type { NormalizedGrammar, Production } from "../dsl/grammar.js";
import { CstUnparser } from "../unparser/cst-unparser.js";

export interface GrammarSampleOptions {
  /** Number of samples to generate (default: 10). */
  count?: number | undefined;
  /** Maximum derivation depth before switching to shortest-terminal productions (default: 8). */
  maxDepth?: number | undefined;
  /** Deterministic PRNG seed (default: 0x12345678). */
  seed?: number | undefined;
  /** Token separator inserted between generated terminals (default: " "). */
  separator?: string | undefined;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTerminalSample(term: string, rng: () => number): string {
  if (term === "EOF" || term === "ERROR") return "";
  if (term.startsWith('"') && term.endsWith('"') && term.length >= 2) {
    return term.slice(1, -1);
  }
  if (term.startsWith("/") && term.lastIndexOf("/") > 0) {
    const body = term.slice(1, term.lastIndexOf("/"));
    return sampleFromSimpleRegex(body, rng);
  }
  // Named terminal fallback
  return "id";
}

function sampleFromSimpleRegex(pattern: string, rng: () => number): string {
  if (pattern.includes("0-9") || pattern.includes("\\d")) {
    const len = 1 + Math.floor(rng() * 3);
    let out = "";
    for (let i = 0; i < len; i++) out += String(Math.floor(rng() * 10));
    return out;
  }
  if (pattern.includes("a-z") || pattern.includes("A-Z") || pattern.includes("\\w")) {
    const chars = "abcxyz";
    const len = 1 + Math.floor(rng() * 4);
    let out = "";
    for (let i = 0; i < len; i++) out += chars[Math.floor(rng() * chars.length)]!;
    return out;
  }
  if (pattern.includes('"')) return '"str"';
  if (pattern.includes("'")) return "'str'";
  return "tok";
}

function computeMinDepth(grammar: NormalizedGrammar): Map<string, number> {
  const minDepth = new Map<string, number>();
  for (const t of grammar.terminals) minDepth.set(t, 0);
  minDepth.set("EOF", 0);
  minDepth.set("ERROR", 0);

  let changed = true;
  while (changed) {
    changed = false;
    for (const prod of grammar.productions) {
      if (prod.left === "_START") continue;
      let maxChild = 0;
      let possible = true;
      for (const sym of prod.right) {
        const d = minDepth.get(sym);
        if (d === undefined) {
          possible = false;
          break;
        }
        if (d > maxChild) maxChild = d;
      }
      if (!possible) continue;
      const candidate = prod.right.length === 0 ? 1 : maxChild + 1;
      const prev = minDepth.get(prod.left);
      if (prev === undefined || candidate < prev) {
        minDepth.set(prod.left, candidate);
        changed = true;
      }
    }
  }
  return minDepth;
}

/**
 * Generates deterministic, depth-bounded sample strings derived from `grammar.productions`.
 */
export function generateGrammarSamples(grammar: NormalizedGrammar, options?: GrammarSampleOptions): string[] {
  const count = options?.count ?? 10;
  const maxDepth = options?.maxDepth ?? 8;
  const seed = options?.seed ?? 0x12345678;
  const separator = options?.separator ?? " ";
  const rng = createRng(seed);

  const prodsByLhs = new Map<string, Production[]>();
  for (const prod of grammar.productions) {
    if (prod.left === "_START") continue;
    let list = prodsByLhs.get(prod.left);
    if (!list) {
      list = [];
      prodsByLhs.set(prod.left, list);
    }
    list.push(prod);
  }
  const minDepth = computeMinDepth(grammar);

  const expand = (sym: string, depth: number, tokens: string[]): void => {
    if (sym === "EOF" || sym === "ERROR") return;
    if (grammar.terminals.has(sym) && !prodsByLhs.has(sym)) {
      const tok = generateTerminalSample(sym, rng);
      if (tok.length > 0) tokens.push(tok);
      return;
    }
    const prods = prodsByLhs.get(sym);
    if (!prods || prods.length === 0) {
      const tok = generateTerminalSample(sym, rng);
      if (tok.length > 0) tokens.push(tok);
      return;
    }

    let chosen: Production;
    if (depth >= maxDepth) {
      // Pick production with minimum terminal derivation depth
      chosen = prods[0]!;
      let bestScore = Infinity;
      for (const p of prods) {
        let score = 0;
        for (const s of p.right) {
          score = Math.max(score, minDepth.get(s) ?? 9999);
        }
        if (score < bestScore) {
          bestScore = score;
          chosen = p;
        }
      }
    } else {
      chosen = prods[Math.floor(rng() * prods.length)]!;
    }

    for (const rhsSym of chosen.right) {
      expand(rhsSym, depth + 1, tokens);
    }
  };

  const samples: string[] = [];
  for (let i = 0; i < count; i++) {
    const tokens: string[] = [];
    expand(grammar.startSymbol, 0, tokens);
    samples.push(tokens.join(separator));
  }
  return samples;
}

/**
 * Applies a deterministic token/character mutation to a sample string for error-recovery fuzzing.
 */
export function mutateSample(sample: string, seed = 1): string {
  if (sample.length === 0) return "?";
  const rng = createRng(seed);
  const idx = Math.floor(rng() * sample.length);
  const op = Math.floor(rng() * 3);
  if (op === 0) {
    // Drop a character
    return sample.slice(0, idx) + sample.slice(idx + 1);
  }
  if (op === 1) {
    // Insert an unexpected token
    return sample.slice(0, idx) + " @ " + sample.slice(idx);
  }
  // Duplicate a slice
  return sample.slice(0, idx) + sample.slice(idx, Math.min(sample.length, idx + 2)) + sample.slice(idx);
}

/**
 * Verifies `parse -> CstUnparser.unparseNode -> parse` round-trip invariants for a CST parser.
 */
export function verifyRoundTrip(
  parser: { parse(text: string): any },
  sample: string,
  unparser: (root: any) => string = (root) => CstUnparser.unparseNode(root),
): { ok: boolean; unparsed: string; reason?: string } {
  const tree1 = parser.parse(sample);
  const root1 = tree1?.rootNode ?? tree1;
  if (!root1) {
    return { ok: false, unparsed: "", reason: "Initial parse returned null/undefined rootNode." };
  }
  if (root1.hasError) {
    return { ok: false, unparsed: "", reason: "Initial parse produced syntax errors." };
  }
  const unparsed = unparser(root1);
  const tree2 = parser.parse(unparsed);
  const root2 = tree2?.rootNode ?? tree2;
  if (!root2 || root2.hasError) {
    return { ok: false, unparsed, reason: "Re-parse of unparsed output failed or produced syntax errors." };
  }
  if (root1.type !== root2.type) {
    return {
      ok: false,
      unparsed,
      reason: `Root node type mismatch after round-trip: '${root1.type}' vs '${root2.type}'.`,
    };
  }
  return { ok: true, unparsed };
}
