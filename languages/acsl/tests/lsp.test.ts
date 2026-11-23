// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acslIndexing } from "../src/indexing.js";
import {
  executeAcslAction,
  getAcslCompletions,
  getAcslDocumentSymbols,
  getAcslHover,
  validateAcsl,
} from "../src/lsp.js";

const LSP_SAMPLE = `PROGRAM RC_CIRCUIT
  INITIAL
    CONSTANT r = 1000.0, c = 0.001
  END
  DYNAMIC
    DERIVATIVE
      vdot = (5.0 - vc) / (r * c)
      vc = INTEG(vdot, 0.0)
    END
    TERMT(t .GE. 5.0)
  END
END`;

describe("ACSL LSP Services & UnifiedWorkspace Indexing", () => {
  it("provides diagnostics, documentSymbols, hover, and completions", () => {
    const diags = validateAcsl(LSP_SAMPLE);
    assert.strictEqual(diags.length, 0);

    const symbols = getAcslDocumentSymbols(LSP_SAMPLE);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "RC_CIRCUIT");
    assert.ok(symbols[0]!.children && symbols[0]!.children.length >= 4);

    // Hover over INTEG on line 7 (0-indexed)
    const hoverOp = getAcslHover(LSP_SAMPLE, { line: 7, character: 12 });
    assert.ok(hoverOp && hoverOp.contents.value.includes("INTEG"));

    // Hover over state vc on line 7
    const hoverState = getAcslHover(LSP_SAMPLE, { line: 7, character: 7 });
    assert.ok(hoverState && hoverState.contents.value.includes("vc"));

    // Completions with prefix "IN"
    const comps = getAcslCompletions("IN", { line: 0, character: 2 });
    assert.ok(comps.some((c) => c.label === "INTEG"));
    assert.ok(comps.some((c) => c.label === "INITIAL"));
  });

  it("executes domain actions (lint, to_modelica, to_dae, simulate)", async () => {
    const mo = (await executeAcslAction("to_modelica", { content: LSP_SAMPLE })) as string;
    assert.ok(mo.includes("model RC_CIRCUIT"));

    const daeStats = (await executeAcslAction("to_dae", { content: LSP_SAMPLE })) as {
      varCount: number;
      eqCount: number;
    };
    assert.ok(daeStats.varCount >= 3);
    assert.ok(daeStats.eqCount >= 2);

    const sim = (await executeAcslAction("simulate", { content: LSP_SAMPLE, tEnd: 5.0 })) as {
      finalValues: Record<string, number>;
    };
    // RC time constant = 1s, at t=5s vc ≈ 5*(1 - e^-5) ≈ 4.9663
    assert.ok(Math.abs((sim.finalValues["vc"] ?? 0) - 5.0 * (1 - Math.exp(-5))) < 1e-3);
  });

  it("recognizes .csl/.acsl files and indexes symbols via acslIndexing", () => {
    assert.strictEqual(acslIndexing.canIndex("file:///demo.csl", ""), true);
    assert.strictEqual(acslIndexing.canIndex("file:///demo.acsl", ""), true);
    assert.strictEqual(acslIndexing.canIndex("file:///unknown.txt", LSP_SAMPLE), true);
    assert.strictEqual(acslIndexing.canIndex("file:///readme.md", "# hello"), false);
  });
});
