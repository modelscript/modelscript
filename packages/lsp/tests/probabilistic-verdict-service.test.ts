// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { DiagnosticSeverity, Range } from "vscode-languageserver";
import {
  ProbabilisticVerdictService,
  formatProbabilisticVerdictTitle,
} from "../src/services/probabilistic-verdict-service.js";

console.log("=== Testing LSP ProbabilisticVerdictService ===");

const svc = new ProbabilisticVerdictService();
const uri = "file:///workspace/thermal.mo";
const r0 = Range.create(0, 0, 0, 10);
const r1 = Range.create(5, 0, 5, 10);
const r2 = Range.create(10, 0, 10, 10);

svc.setVerdicts(uri, [
  {
    range: r0,
    label: "T > 400",
    verdict: { kind: "proven", rigor: "rigorous", probabilityBounds: [0, 1e-4], maxAllowedProbability: 1e-3 },
  },
  {
    range: r1,
    label: "P > 50",
    verdict: { kind: "violated", rigor: "rigorous", probabilityBounds: [0.12, 0.25], maxAllowedProbability: 0.05 },
  },
  {
    range: r2,
    label: "v < 0",
    verdict: {
      kind: "unknown",
      reason: "inconclusive-pbox",
      rigor: "rigorous",
      probabilityBounds: [0.01, 0.08],
      maxAllowedProbability: 0.05,
    },
  },
]);

const allLenses = svc.getCodeLenses(uri, false);
assert.strictEqual(allLenses.length, 3);
assert.ok(allLenses[0]!.command!.title.includes("P-Box Proven"));
assert.ok(allLenses[1]!.command!.title.includes("Probabilistic Violation"));
assert.ok(allLenses[2]!.command!.title.includes("Probabilistic Unknown"));

// problemsOnly mode omits proven entries
const problemLenses = svc.getCodeLenses(uri, true);
assert.strictEqual(problemLenses.length, 2);

// Diagnostics: proven -> none, violated -> Error, inconclusive -> Warning
const diags = svc.getDiagnostics(uri);
assert.strictEqual(diags.length, 2);
assert.strictEqual(diags[0]!.severity, DiagnosticSeverity.Error);
assert.strictEqual(diags[0]!.code, "UQ_VIOLATED");
assert.strictEqual(diags[1]!.severity, DiagnosticSeverity.Warning);
assert.strictEqual(diags[1]!.code, "UQ_UNKNOWN_INCONCLUSIVE_PBOX");

// Soundness check: unknown(not-rigorous) title must never say Proven or Certified
const heurTitle = formatProbabilisticVerdictTitle("x > 1", {
  kind: "unknown",
  reason: "not-rigorous",
  rigor: "heuristic",
});
assert.ok(!/proven|certified/i.test(heurTitle), `Heuristic title must not claim proof: ${heurTitle}`);

console.log("✓ LSP ProbabilisticVerdictService CodeLens & Diagnostics passed");
