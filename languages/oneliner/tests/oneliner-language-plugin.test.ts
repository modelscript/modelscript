// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { onelinerLanguage } from "../src/language.js";
import { getOneLinerDiagnostics, getOneLinerDocumentSymbols } from "../src/lsp.js";
import { OneLinerWorkspaceIndex } from "../src/workspace-index.js";

const SAMPLE_DXT = `[CASE DATA]
BASE_MVA=100.0, FREQ=60.0, TITLE="Plugin Test Substation"

[BUS DATA]
101, "BUS_A", 138.0, 1, 1
102, "BUS_B", 138.0, 1, 1

[LINE DATA]
"L101-102", 101, 102, "1", 0.01, 0.1, 0.03, 0.3, 0.01, 0.005, 200.0, 10.0

[GENERATOR DATA]
"G101", 101, 200.0, 0.005, 0.15, 0.002, 0.08

[RELAY OVERCURRENT]
"OC1", "SEL_51", "L101-102", 101, 600.0, 120.0, 2.0, "IEEE_Very_Inverse"
`;

describe("ASPEN OneLiner Language Plugin & LSP Services", () => {
  it("indexes OneLiner documents in workspace index", () => {
    const index = new OneLinerWorkspaceIndex();
    index.indexDocument("file:///test/system.dxt", SAMPLE_DXT);

    const model = index.getModel("file:///test/system.dxt");
    assert.ok(model !== undefined);
    assert.equal(model?.title, "Plugin Test Substation");
    assert.equal(model?.busCount, 2);
    assert.equal(model?.branchCount, 1);
    assert.equal(model?.generatorCount, 1);
    assert.equal(model?.relayCount, 1);

    assert.equal(index.getAllModels().length, 1);
    index.clear();
    assert.equal(index.getAllModels().length, 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getOneLinerDocumentSymbols(SAMPLE_DXT);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "Plugin Test Substation");
    assert.ok(root.children !== undefined);
    assert.ok(root.children!.length >= 3); // Busses, Lines, Relays
  });

  it("generates LSP diagnostics", () => {
    const diagnostics = getOneLinerDiagnostics(SAMPLE_DXT);
    assert.equal(diagnostics.filter((d) => d.severity === 1).length, 0);
  });

  it("executes language actions (fault calculation, relay trip, DAE lowering, export)", async () => {
    const actions = onelinerLanguage.actions;
    assert.ok(actions.length >= 4);

    const daeAction = actions.find((a) => a.id === "lower_oneliner_dae");
    assert.ok(daeAction !== undefined);
    const daeResult = (await daeAction!.execute({} as any, { documentText: SAMPLE_DXT })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeResult.variableCount > 0);
    assert.ok(daeResult.equationCount > 0);

    const faultAction = actions.find((a) => a.id === "calculate_oneliner_fault");
    assert.ok(faultAction !== undefined);
    const faultResult = (await faultAction!.execute({} as any, { documentText: SAMPLE_DXT, busId: "101" })) as any;
    assert.ok(faultResult !== null);
    assert.equal(faultResult.converged, true);
    assert.ok(faultResult.i3PhaseA > 0);

    const relayAction = actions.find((a) => a.id === "evaluate_oneliner_relay_trip");
    assert.ok(relayAction !== undefined);
    const relayResult = (await relayAction!.execute({} as any, {
      documentText: SAMPLE_DXT,
      faultCurrentA: 2400.0,
    })) as any;
    assert.ok(relayResult !== null);
    assert.ok(relayResult.tripTimeSec > 0);

    const exportAction = actions.find((a) => a.id === "export_oneliner_dxt");
    assert.ok(exportAction !== undefined);
    const exportedText = await exportAction!.execute({} as any, { documentText: SAMPLE_DXT });
    assert.equal(typeof exportedText, "string");
    assert.ok((exportedText as string).includes("[CASE DATA]"));
  });
});
