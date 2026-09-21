import expect from "expect";
import { describe, it } from "node:test";
import { generateReasoner } from "../src/codegen/typesys/reasoner.js";
import type { NormalizedGrammar } from "../src/dsl/grammar.js";
import type { LanguageOptions } from "../src/dsl/language.js";

describe("Tier 1: Semiring Provenance & Stratified Datalog Reasoner", () => {
  const grammarOpts: LanguageOptions = {
    name: "TestLang",
    fileExtensions: [".test"],
    semantics: {
      reasoner: {
        rules: [
          // Subtyping transitivity: Subtype(A, C) :- Subtype(A, B), Subtype(B, C).
          "Subtype(?a, ?c) :- Subtype(?a, ?b), Subtype(?b, ?c).",
          // Connection compatibility: Connectable(?p1, ?p2) :- Port(?p1), Port(?p2), Compatible(?p1, ?p2).
          "Connectable(?p1, ?p2) :- Port(?p1), Port(?p2), Compatible(?p1, ?p2).",
        ],
      },
    },
  };

  const sampleGrammar: NormalizedGrammar = {
    name: "TestLang",
    rules: {
      root: {
        name: "root",
        type: "choice",
        choices: [],
      },
    },
  };

  it("emits factProvTable for PosBool semiring provenance", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("factProvTable");
    expect(code).toContain("createChunkedUint32Array");
  });

  it("emits addFactWithProv and findFactIndex", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("addFactWithProv(");
    expect(code).toContain("findFactIndex(");
  });

  it("emits retractToken for O(1) fact retraction on token invalidation", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("export function retractToken(tokenId: u32): u32");
    expect(code).toContain("let tokenBit: u32 = (1 << tokenId);");
    expect(code).toContain("tombstoneFact(i);");
  });

  it("emits getFactProvenance and getFactProvenanceTokens", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("export function getFactProvenance(factIdx: u32): u32");
    expect(code).toContain("export function getFactProvenanceTokens(factIdx: u32): StaticArray<u32>");
  });

  it("compiles rule heads to accumulate body atom provenance via PosBool semiring", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("_headProv: u32 = (factProvTable[s0r0_i0] | factProvTable[s0r0_i1]);");
    expect(code).toContain("factProvTable[s0r0_existingIdx as u32] |= s0r0_headProv;");
  });

  it("resets and compacts provenance table during garbage collection and init", () => {
    const code = generateReasoner(grammarOpts, sampleGrammar);
    expect(code).toContain("factProvTable[writeIdx] = factProvTable[i];");
    expect(code).toContain("factProvTable[factIdx] = 0;");
  });
});
