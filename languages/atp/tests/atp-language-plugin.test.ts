// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAllAtpModels, getAtpModel } from "../src/indexing.js";
import { atpLanguage } from "../src/language.js";
import { getAtpDiagnostics, getAtpDocumentSymbols } from "../src/lsp.js";

const SAMPLE_ATP = `BEGIN NEW DATA CASE
C 138kV Substation Breaker Case
  1.0E-5  0.02
/BRANCH
BUS1  BUS2  1.00  10.00  0.10
BLANK RECORD
/SWITCH
BUS2  LOAD  0.005  0.015
BLANK RECORD
/SOURCE
14 BUS1  112676.0  60.0  0.0
BLANK RECORD
/OUTPUT
BUS1 BUS2 LOAD
BLANK RECORD
`;

describe("ATP Language Plugin & LSP Services", () => {
  it("indexes ATP documents in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(atpLanguage);
    ws.setDocument("file:///test/substation.atp", SAMPLE_ATP);

    const model = getAtpModel(ws, "file:///test/substation.atp");
    assert.ok(model !== undefined);
    assert.equal(model?.title, "138kV Substation Breaker Case");
    assert.equal(model?.branchCount, 1);
    assert.equal(model?.switchCount, 1);
    assert.equal(model?.sourceCount, 1);
    assert.ok(model?.nodes.includes("BUS1"));
    assert.ok(ws.getIndex().byName.has("BUS1"));

    assert.equal(getAllAtpModels(ws).length, 1);
    ws.clear();
    assert.equal(getAllAtpModels(ws).length, 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getAtpDocumentSymbols(SAMPLE_ATP);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "138kV Substation Breaker Case");
    assert.ok(root.children !== undefined);
    assert.ok(root.children!.length >= 3); // Branches, Switches, Sources
  });

  it("generates LSP diagnostics", () => {
    const diagnostics = getAtpDiagnostics(SAMPLE_ATP);
    assert.equal(diagnostics.filter((d) => d.severity === 1).length, 0);
  });

  it("executes language actions (transient simulation, DAE lowering, export)", async () => {
    const actions = atpLanguage.actions;
    assert.ok(actions && actions.length >= 4);

    const daeAction = actions.find((a) => a.id === "lower_atp_dae");
    assert.ok(daeAction?.execute);
    const daeResult = (await daeAction.execute({ languageId: "atp" } as any, { documentText: SAMPLE_ATP })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeResult.variableCount > 0);
    assert.ok(daeResult.equationCount > 0);

    const simAction = actions.find((a) => a.id === "simulate_atp_transient");
    assert.ok(simAction?.execute);
    const simResult = (await simAction.execute({ languageId: "atp" } as any, {
      documentText: SAMPLE_ATP,
      maxSteps: 50,
    })) as any;
    assert.ok(simResult !== null);
    assert.equal(simResult.converged, true);
    assert.equal(simResult.stepCount, 50);

    const exportAction = actions.find((a) => a.id === "export_atp_deck");
    assert.ok(exportAction?.execute);
    const exportedText = await exportAction.execute({ languageId: "atp" } as any, { documentText: SAMPLE_ATP });
    assert.equal(typeof exportedText, "string");
    assert.ok((exportedText as string).includes("BEGIN NEW DATA CASE"));
  });
});
