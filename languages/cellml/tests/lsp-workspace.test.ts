// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CellmlWorkspaceIndex,
  cellmlLanguage,
  executeCellmlAction,
  getCellmlCompletions,
  getCellmlDefinition,
  getCellmlDocumentSymbols,
  getCellmlHover,
  validateCellml,
} from "../src/index.js";
import { HODGKIN_HUXLEY_FULL_CELLML } from "./solver-dae.test.js";

describe("CellML Workspace Index & LSP Services", () => {
  it("indexes multi-file CellML symbols and resolves definitions in CellmlWorkspaceIndex", () => {
    const index = new CellmlWorkspaceIndex();
    const uri = "file:///models/hh.cellml";
    index.register(uri);
    assert.equal(index.has(uri), true);

    const symIndex = index.indexFile(uri, HODGKIN_HUXLEY_FULL_CELLML);
    assert.equal(index.fileCount, 1);
    assert.ok(symIndex.symbols.size >= 25);

    const modelDef = index.findDefinition("hodgkin_huxley_squid_axon_1952");
    assert.ok(modelDef);
    assert.equal(modelDef.kind, "Package");

    const compDef = index.findDefinition("sodium_channel");
    assert.ok(compDef);
    assert.equal(compDef.kind, "Component");

    const varDef = index.findDefinition("membrane.V");
    assert.ok(varDef);
    assert.equal(varDef.name, "V");

    const resolvedInScope = index.resolveInScope("V", compDef.id, uri);
    assert.ok(resolvedInScope);
    assert.equal(resolvedInScope.name, "V");

    index.reindexDocument(uri, () => ({ text: HODGKIN_HUXLEY_FULL_CELLML }));
    assert.ok(index.version >= 2);

    index.clear();
    assert.equal(index.fileCount, 0);
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
