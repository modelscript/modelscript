// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { RtmIndexEngine } from "../src/rtm/index.js";

describe("ISO 14971 Risk Management & Hazard RTM Engine", () => {
  test("classifyDomain identifies hazard domain from AST rules and metadata", () => {
    assert.equal(RtmIndexEngine.classifyDomain({ ruleName: "HazardDefinition" } as SymbolEntry), "hazard");
    assert.equal(RtmIndexEngine.classifyDomain({ ruleName: "HazardUsage" } as SymbolEntry), "hazard");
    assert.equal(
      RtmIndexEngine.classifyDomain({ ruleName: "Def", metadata: { defKind: "hazard" } } as SymbolEntry),
      "hazard",
    );
    assert.equal(
      RtmIndexEngine.classifyDomain({ ruleName: "Def", metadata: { hazardId: "HAZ-001" } } as SymbolEntry),
      "hazard",
    );
  });

  test("extractElementsByDomain calculates ISO 14971 quantitative RPN and acceptability", () => {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();

    const hazardEntry: SymbolEntry = {
      id: 1,
      name: "Stale_CGM_Data",
      kind: "Definition",
      ruleName: "HazardDefinition",
      resourceId: "file:///insulin_pump.sysml",
      startByte: 10,
      endByte: 120,
      parentId: null,
      metadata: {
        hazardId: "HAZ-102",
        text: "Controller delivers insulin bolus based on stale sensor reading",
        severity: 5, // Catastrophic
        probability: 3, // Occasional
        residualSeverity: 5,
        residualProbability: 1, // Extremely remote after mitigation
        mitigates: "SR_204",
      },
    };

    symbols.set(1, hazardEntry);
    byName.set("Stale_CGM_Data", [1]);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf: new Map([[null, [1]]]),
    };

    const hazards = RtmIndexEngine.extractElementsByDomain(index, "hazard");
    assert.equal(hazards.length, 1);
    const h = hazards[0]!;
    assert.equal(h.name, "Stale_CGM_Data");
    assert.equal(h.domain, "hazard");

    const iso = h.metadata.iso14971;
    assert.ok(iso);
    assert.equal(iso.hazardId, "HAZ-102");
    assert.equal(iso.initialSeverity, 5);
    assert.equal(iso.initialProbability, 3);
    assert.equal(iso.initialRpn, 15);
    assert.equal(iso.initialAcceptability, "Unacceptable");

    assert.equal(iso.residualSeverity, 5);
    assert.equal(iso.residualProbability, 1);
    assert.equal(iso.residualRpn, 5);
    assert.equal(iso.residualAcceptability, "Broadly Acceptable");
    assert.deepEqual(iso.mitigationRequirementIds, ["SR_204"]);
    assert.equal(iso.status, "Mitigated");
  });

  test("extractLinks, computeAnalytics, and buildMatrix compute ISO 14971 risk reduction KPIs", () => {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();

    // 1. Hazard: Overdose
    const haz1: SymbolEntry = {
      id: 1,
      name: "HAZ_Overdose",
      kind: "Definition",
      ruleName: "HazardDefinition",
      resourceId: "file:///pump.sysml",
      startByte: 0,
      endByte: 50,
      parentId: null,
      metadata: {
        hazardId: "HAZ-001",
        severity: 5,
        probability: 4,
        residualSeverity: 2,
        residualProbability: 1,
      },
    };
    symbols.set(1, haz1);
    byName.set("HAZ_Overdose", [1]);

    // 2. Requirement: SR-204
    const req1: SymbolEntry = {
      id: 2,
      name: "SR_204",
      kind: "Definition",
      ruleName: "RequirementDefinition",
      resourceId: "file:///pump.sysml",
      startByte: 60,
      endByte: 120,
      parentId: null,
      metadata: {
        reqId: "SR-204",
        text: "Reject CGM data older than 5 minutes",
      },
    };
    symbols.set(2, req1);
    byName.set("SR_204", [2]);

    // 3. Mitigation Link: HAZ_Overdose mitigates SR_204
    const mitLink: SymbolEntry = {
      id: 3,
      name: "SR_204",
      kind: "Usage",
      ruleName: "MitigateRequirementUsage",
      resourceId: "file:///pump.sysml",
      startByte: 130,
      endByte: 160,
      parentId: 1, // owned by HAZ_Overdose
    };
    symbols.set(3, mitLink);
    byName.set("SR_204", [2, 3]);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf: new Map([
        [null, [1, 2]],
        [1, [3]],
      ]),
    };

    const matrix = RtmIndexEngine.buildMatrix(index, "hazard", "requirement");
    assert.equal(matrix.rows.length, 1);
    assert.equal(matrix.cols.length, 1);

    const { links } = RtmIndexEngine.extractLinks(index);
    assert.equal(links.length, 1);
    const link = links[0]!;
    assert.equal(link.linkKind, "mitigate");
    assert.equal(link.sourceName, "HAZ_Overdose");
    assert.equal(link.targetName, "SR_204");

    const analytics = matrix.analytics;
    assert.equal(analytics.totalHazards, 1);
    assert.equal(analytics.mitigatedHazardsCount, 1);
    assert.equal(analytics.unmitigatedHazardsCount, 0);
    assert.equal(analytics.unacceptableResidualRiskCount, 0);
    // Initial RPN = 20, Residual RPN = 2 -> reduction = 18
    assert.equal(analytics.averageRpnReduction, 18);
  });
});
