// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cellmlLanguage,
  executeCellmlAction,
  getCellmlCompletions,
  getCellmlDefinition,
  getCellmlDocument,
  getCellmlDocumentSymbols,
  getCellmlHover,
  resolveCellmlInScope,
  validateCellml,
} from "../src/index.js";
import { HODGKIN_HUXLEY_FULL_CELLML } from "./solver-dae.test.js";

describe("CellML UnifiedWorkspace & LSP Services", () => {
  it("indexes multi-file CellML symbols and resolves definitions in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(cellmlLanguage);
    const uri = "file:///models/hh.cellml";
    ws.setDocument(uri, HODGKIN_HUXLEY_FULL_CELLML);
    assert.equal(ws.hasDocument(uri), true);
    assert.equal(ws.fileCount, 1);
    assert.ok(getCellmlDocument(ws, uri));
    assert.ok(ws.getSymbolsForUri(uri).length >= 25);

    const modelDef = ws.findSymbolsByName("hodgkin_huxley_squid_axon_1952")[0];
    assert.ok(modelDef);
    assert.equal(modelDef.kind, "Package");

    const compDef = ws.findSymbolsByName("sodium_channel")[0];
    assert.ok(compDef);
    assert.equal(compDef.kind, "Component");

    const varDef = ws.findSymbolsByName("membrane.V")[0];
    assert.ok(varDef);
    assert.equal(varDef.name, "V");

    const resolvedInScope = resolveCellmlInScope(ws, "V", compDef.id, uri);
    assert.ok(resolvedInScope);
    assert.equal(resolvedInScope.name, "V");

    const prevVersion = ws.version;
    ws.setDocument(uri, HODGKIN_HUXLEY_FULL_CELLML);
    assert.ok(ws.version >= prevVersion);

    ws.clear();
    assert.equal(ws.fileCount, 0);
  });

  it("provides LSP validation, document symbols, hover cards, completions, definitions, and actions", async () => {
    const diags = validateCellml(HODGKIN_HUXLEY_FULL_CELLML);
    assert.equal(diags.length, 0);

    const symbols = getCellmlDocumentSymbols(HODGKIN_HUXLEY_FULL_CELLML);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "hodgkin_huxley_squid_axon_1952");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 5);

    const vOffset = HODGKIN_HUXLEY_FULL_CELLML.indexOf('name="V" units="millivolt" initial_value="-65.0"');
    const hover = getCellmlHover(HODGKIN_HUXLEY_FULL_CELLML, vOffset);
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("membrane.V"));
    assert.ok(hover.contents.value.includes("millivolt"));

    const completions = getCellmlCompletions(HODGKIN_HUXLEY_FULL_CELLML);
    assert.ok(completions.some((c) => c.label === "millivolt"));
    assert.ok(completions.some((c) => c.label === "sodium_channel"));

    const compRefOffset = HODGKIN_HUXLEY_FULL_CELLML.indexOf("sodium_channel") + 2;
    const defLoc = getCellmlDefinition(HODGKIN_HUXLEY_FULL_CELLML, compRefOffset, "file:///hh.cellml");
    assert.ok(defLoc);
    assert.equal(defLoc.uri, "file:///hh.cellml");

    // Execute LSP actions
    const daeSummary = await executeCellmlAction("cellml_to_dae", HODGKIN_HUXLEY_FULL_CELLML);
    assert.equal(daeSummary.variableCount, daeSummary.equationCount);

    const simResult = await executeCellmlAction("cellml_simulate", HODGKIN_HUXLEY_FULL_CELLML, {
      options: { duration: 1.0, dt: 0.05 },
    });
    assert.equal(simResult.stepsCount, 20);

    assert.equal(cellmlLanguage.name, "cellml");
    assert.ok(cellmlLanguage.fileExtensions?.includes(".cellml"));
  });
});
