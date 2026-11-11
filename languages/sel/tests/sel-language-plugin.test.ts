// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSelWorkspaceModel, selLanguage } from "../src/index.js";
import { formatSELDocument, getSELDiagnostics, getSELDocumentSymbols } from "../src/lsp.js";

const TEST_SEL_DOC = `
RELAY="SEL-411L"
RID="LINE_WEST_411"
TID="BREAKER_411"
ACTIVE_GROUP=1
GROUP 1
50P1P=15.00
51P1P=5.00
51P1C=U3
51P1TD=2.00
Z1P=3.00
Z2P=12.00
TRIP=50P1P OR 51P1 OR Z1P
CLOSE=!51P1 AND IN101
OUT101=TRIP
`;

describe("SEL Language Plugin & LSP Services", () => {
  it("indexes SEL documents in UnifiedWorkspace", () => {
    const ws = new UnifiedWorkspace(selLanguage);
    ws.setDocument("file:///test.rcf", TEST_SEL_DOC);

    const model = getSelWorkspaceModel(ws, "file:///test.rcf");
    assert.ok(model);
    assert.equal(model.relayId, "LINE_WEST_411");
    assert.equal(model.relayType, "SEL-411L");
    assert.equal(model.groupCount, 1);
    assert.ok(model.equationCount >= 3);
    assert.ok(ws.findSymbolsByName("LINE_WEST_411").length > 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getSELDocumentSymbols(TEST_SEL_DOC);
    assert.equal(symbols.length, 1);
    assert.ok(symbols[0]?.name.includes("LINE_WEST_411"));
    assert.ok((symbols[0]?.children?.length ?? 0) >= 1);
  });

  it("generates LSP diagnostics and formats document", () => {
    const diags = getSELDiagnostics(TEST_SEL_DOC);
    assert.ok(Array.isArray(diags));

    const formatted = formatSELDocument(TEST_SEL_DOC);
    assert.ok(formatted.includes('RID="LINE_WEST_411"'));
    assert.ok(formatted.includes("50P1P=15.00"));
  });

  it("executes language actions (evaluate, lower DAE, lint, export)", async () => {
    const evalAction = selLanguage.actions.find((a) => a.id === "evaluate_sel_protection");
    assert.ok(evalAction);
    const evalRes = (await evalAction.execute({ documentText: TEST_SEL_DOC } as any, { phaseCurrentA: 20.0 })) as any;
    assert.ok(evalRes);
    assert.equal(evalRes.tripped, true);

    const daeAction = selLanguage.actions.find((a) => a.id === "lower_sel_dae");
    assert.ok(daeAction);
    const daeRes = (await daeAction.execute({ documentText: TEST_SEL_DOC } as any)) as any;
    assert.ok(daeRes.variableCount > 0);
    assert.ok(daeRes.equationCount > 0);

    const lintAction = selLanguage.actions.find((a) => a.id === "lint_sel_settings");
    assert.ok(lintAction);
    const lintRes = (await lintAction.execute({ documentText: TEST_SEL_DOC } as any)) as any[];
    assert.ok(Array.isArray(lintRes));

    const exportAscii = selLanguage.actions.find((a) => a.id === "export_sel_ascii");
    assert.ok(exportAscii);
    const asciiRes = (await exportAscii.execute({ documentText: TEST_SEL_DOC } as any)) as string;
    assert.ok(asciiRes.includes("LINE_WEST_411"));

    const exportJson = selLanguage.actions.find((a) => a.id === "export_sel_json");
    assert.ok(exportJson);
    const jsonRes = (await exportJson.execute({ documentText: TEST_SEL_DOC } as any)) as string;
    assert.ok(jsonRes.includes("LINE_WEST_411"));
  });
});
