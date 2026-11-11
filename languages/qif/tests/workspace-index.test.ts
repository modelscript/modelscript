// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { qifLanguage, resolveQifInScope } from "../src/index.js";

describe("QIF 3.0 Multi-File UnifiedWorkspace Indexing", () => {
  it("indexes QIF symbols and resolves by name and scope", () => {
    const ws = new UnifiedWorkspace(qifLanguage);
    const uri = "file:///housing.qif";
    const content = `
      QIF 3.0.0
      DATUM A id=D1 feature=F1
      FEATURE F1 Plane "BasePlane" points=4
      FEATURE F2 Cylinder "MainBore" size=30.0 points=6
      DEVICE CMM1 CMM "Zeiss" uncertainty=0.001
      CHARACTERISTIC C1 Position "MainBore_Pos" zone=0.05 material=MMC datums=[A] features=[F2] device=CMM1
      STEP S1 step=1 feature=F2 characteristic=C1 device=CMM1 points=6
      ACTUAL ACT1 characteristic=C1 serial="SN-01" value=0.02 actualSize=30.01 status=PASS
    `;

    ws.setDocument(uri, content);
    const fileIdx = ws.getFileIndex(uri);
    assert(ws.hasDocument(uri));
    assert.strictEqual(ws.fileCount, 1);
    assert(fileIdx && fileIdx.symbols.size >= 7);

    const foundBore = ws.findSymbolsByName("MainBore");
    assert.strictEqual(foundBore.length, 1);
    assert.strictEqual(foundBore[0]?.ruleName, "qif_feature");

    const foundChar = ws.findSymbolsByName("C1");
    assert.strictEqual(foundChar.length, 1);
    const charId = foundChar[0]!.id;

    // Resolve child actual in characteristic scope
    const resolvedAct = resolveQifInScope(ws, "ACT1", charId, uri);
    assert(resolvedAct !== null);
    assert.strictEqual(resolvedAct.ruleName, "qif_actual");

    ws.clear();
    assert.strictEqual(ws.fileCount, 0);
  });
});
