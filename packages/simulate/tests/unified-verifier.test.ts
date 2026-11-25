// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ConstraintTheoryOracle,
  DigitalThreadHypergraph,
  SemanticTheoryCoordinator,
  ThreadDomain,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnifiedVerifier, type VerificationInputContext } from "../src/verification/unified-verifier.js";

describe("UnifiedVerifier", () => {
  it("should thread cancellationToken through UnifiedVerifier.verify", async () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());

    const token = { isCancellationRequested: true };
    const report = await UnifiedVerifier.verify(
      {
        sourceText: "model Test end Test;",
        coordinator,
      },
      {
        theoryCoordinator: true,
        cancellationToken: token,
      },
    );

    assert.strictEqual(report.summary.overallPassed, false);
    assert.strictEqual(report.stages["theory_coordination"]?.passed, false);
    assert.ok(report.stages["theory_coordination"]?.summary.includes("cancelled by client token"));
  });

  it("should reuse existing hypergraph thread slot in UnifiedVerifier.verify", async () => {
    const hg = new DigitalThreadHypergraph();
    const s0 = hg.createThread(101);
    hg.bindDomainNode(s0, ThreadDomain.SysML2, 2001);
    assert.strictEqual(hg.getThreadCount(), 1);

    await UnifiedVerifier.verify(
      {
        sourceText: "package P {}",
        hypergraph: hg,
      },
      { updateHypergraph: true, all: false },
    );
    assert.strictEqual(hg.getThreadCount(), 1, "syncDigitalThread must reuse existing thread slot when present");
  });

  it("emits standard compliance rules, clauses, margins, and methods across SARIF, CTRF, HTML, and DHF reports", () => {
    const sampleReport = {
      timestamp: "2026-11-15T00:00:00.000Z",
      target: "VesselSeparator.mo",
      summary: {
        totalStages: 1,
        passedStages: 0,
        failedStages: 1,
        certifiedStages: 0,
        skippedStages: 0,
        totalViolations: 1,
        durationMs: 12.5,
        overallPassed: false,
      },
      stages: {
        flowpipes: {
          stage: "flowpipes",
          name: "DAE Interval Reachability",
          passed: false,
          durationMs: 12.5,
          summary: "1 ASME BPVC VIII-1 violation",
          violations: [
            {
              stage: "flowpipes",
              severity: "error" as const,
              message: "Shell thickness 12.0 mm violates UG-27(c)(1) minimum 17.28 mm.",
              standard: "ASME BPVC VIII-1",
              clauseId: "UG-27(c)(1)",
              margin: -5.28,
              verificationMethod: "formal-interval",
            },
          ],
        },
      },
    };

    const sarif = JSON.parse(UnifiedVerifier.formatSarif(sampleReport as any));
    assert.strictEqual(sarif.runs[0].results[0].ruleId, "ASME-BPVC-VIII-1:UG-27(c)(1)");
    assert.strictEqual(sarif.runs[0].results[0].properties.standard, "ASME BPVC VIII-1");
    assert.strictEqual(sarif.runs[0].results[0].properties.clauseId, "UG-27(c)(1)");
    assert.strictEqual(sarif.runs[0].results[0].properties.margin, -5.28);
    assert.strictEqual(sarif.runs[0].results[0].properties.verificationMethod, "formal-interval");

    const ctrf = UnifiedVerifier.formatCtrf(sampleReport as any);
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["standardClause"], "ASME BPVC VIII-1 UG-27(c)(1)");
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["margin"], -5.28);
    assert.strictEqual(ctrf.report.results.tests[0]?.extra?.["verificationMethod"], "formal-interval");

    const html = UnifiedVerifier.formatHtml(sampleReport as any);
    assert.ok(html.includes("ASME BPVC VIII-1 UG-27(c)(1)"));
    assert.ok(html.includes("-5.2800"));
    assert.ok(html.includes("[formal-interval]"));

    const dhf = UnifiedVerifier.formatDhf(sampleReport as any);
    assert.ok(dhf.includes("ASME BPVC VIII-1 UG-27(c)(1)"));
    assert.ok(dhf.includes("Margin: -5.2800"));
  });

  it("should forward Stage 0 contracted state space to downstream stages in UnifiedVerifier", async () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["pos_x", 10, 20],
      domain: "constraint",
    });

    const ctx: VerificationInputContext = {
      uri: "file:///model/system.mo",
      coordinator,
    };

    const report = await UnifiedVerifier.verify(ctx, {
      theoryCoordinator: true,
      all: false,
    });

    assert.ok(report.stages.theory_coordination, "Theory coordination stage should be present");
    assert.equal(report.stages.theory_coordination.passed, true);
    assert.ok(report.stages.decisions, "Decisions stage should be present");
    assert.equal(report.stages.decisions.passed, true);

    assert.ok(ctx.contractedStateSpace, "Contracted state space should be forwarded into context");
    assert.ok(ctx.contractedStateSpace!.has("pos_x"), "pos_x should be in contracted state space");
    const bounds = ctx.contractedStateSpace!.get("pos_x");
    assert.equal(bounds?.[0], 10);
    assert.equal(bounds?.[1], 20);
  });
});
