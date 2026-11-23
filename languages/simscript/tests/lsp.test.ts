// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simscriptIndexing } from "../src/indexing.js";
import {
  getSimscriptCompletions,
  getSimscriptDocumentSymbols,
  getSimscriptHover,
  validateSimscript,
} from "../src/lsp.js";

const LSP_SAMPLE = `'' MODEL: BankTeller
PREAMBLE
  TEMPORARY ENTITIES
    EVERY CUSTOMER BELONGS TO TELLER.LINE
  PROCESSES
    INCLUDE ARRIVAL
    INCLUDE CUSTOMER
  RESOURCES
    EVERY TELLER
  DEFINE TELLER.LINE AS A FIFO SET
  ACCUMULATE AVG.BUSY AS THE MEAN OF N.X.TELLER
END

MAIN
  LET U.TELLER = 2
  ACTIVATE A ARRIVAL NOW
  START SIMULATION
END

PROCESS ARRIVAL
  ACTIVATE A CUSTOMER NOW
  ACTIVATE A ARRIVAL IN EXPONENTIAL.F(3.0, 1) MINUTES
END

PROCESS CUSTOMER
  FILE THIS CUSTOMER IN TELLER.LINE
  REQUEST 1 TELLER
  REMOVE FIRST CUSTOMER FROM TELLER.LINE
  WORK EXPONENTIAL.F(4.0, 2) MINUTES
  RELINQUISH 1 TELLER
END
`;

describe("SIMSCRIPT II.5 LSP Services & Indexing", () => {
  it("recognizes SIMSCRIPT II.5 files in simscriptIndexing.canIndex", () => {
    assert.strictEqual(simscriptIndexing.canIndex("file:///bank.sim", ""), true);
    assert.strictEqual(simscriptIndexing.canIndex("file:///bank.s25", ""), true);
    assert.strictEqual(simscriptIndexing.canIndex("file:///unknown.txt", LSP_SAMPLE), true);
    assert.strictEqual(simscriptIndexing.canIndex("file:///other.txt", "hello world"), false);
  });

  it("extracts hierarchical document symbols for Preamble, Main, and Processes", () => {
    const syms = getSimscriptDocumentSymbols(LSP_SAMPLE, "bank.sim");
    assert.strictEqual(syms.length, 1);
    const root = syms[0]!;
    assert.strictEqual(root.name, "BankTeller");
    assert.ok(root.children && root.children.length >= 6);
    assert.ok(root.children.some((c) => c.name === "TELLER"));
    assert.ok(root.children.some((c) => c.name === "MAIN"));
    assert.ok(root.children.some((c) => c.name === "PROCESS CUSTOMER"));
  });

  it("provides contextual hover for resources, distributions, and keywords", () => {
    // Hover over TELLER on line 8 ("    EVERY TELLER")
    const resHover = getSimscriptHover(LSP_SAMPLE, { line: 8, character: 12 });
    assert.ok(resHover, "Expected hover for TELLER");
    assert.ok(resHover.contents.value.includes("RESOURCE"));
    assert.ok(resHover.contents.value.includes("2"));

    // Hover over EXPONENTIAL.F on line 21 ("  ACTIVATE A ARRIVAL IN EXPONENTIAL.F(3.0, 1) MINUTES")
    const distHover = getSimscriptHover(LSP_SAMPLE, { line: 21, character: 28 });
    assert.ok(distHover, "Expected hover for EXPONENTIAL.F");
    assert.ok(distHover.contents.value.includes("EXPONENTIAL.F"));
  });

  it("provides completions for keywords, declared symbols, and stdlib distributions", () => {
    const expCompletions = getSimscriptCompletions("  WORK EXP", { line: 0, character: 10 });
    assert.ok(expCompletions.some((c) => c.label === "EXPONENTIAL.F"));

    const allCompletions = getSimscriptCompletions(LSP_SAMPLE, { line: 12, character: 0 });
    assert.ok(allCompletions.some((c) => c.label === "TELLER"));
    assert.ok(allCompletions.some((c) => c.label === "TELLER.LINE"));
    assert.ok(allCompletions.some((c) => c.label === "START SIMULATION"));
  });

  it("returns zero diagnostics for valid models and structured diagnostics for invalid models", () => {
    assert.strictEqual(validateSimscript(LSP_SAMPLE).length, 0);

    const invalid = `
PREAMBLE
  RESOURCES
    EVERY TELLER
MAIN
  REQUEST 1 UNKNOWN.RES
END
`;
    const diags = validateSimscript(invalid);
    assert.ok(diags.some((d) => d.code === "SIMS1002"));
    assert.ok(diags.some((d) => d.code === "SIMS4001"));
    assert.ok(diags.some((d) => d.code === "SIMS2002"));
  });
});
