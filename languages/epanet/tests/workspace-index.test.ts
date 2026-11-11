// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { epanetLanguage, getEpanetNetwork } from "../src/index.js";

const NET_A = `
[TITLE]
Sector A

[RESERVOIRS]
 ResA  100.0

[JUNCTIONS]
 JuncA1  60.0  10.0

[PIPES]
 PipeA1  ResA  JuncA1  500  200  100  0  OPEN
`;

const NET_B = `
[TITLE]
Sector B

[RESERVOIRS]
 ResB  150.0

[JUNCTIONS]
 JuncB1  70.0  20.0

[PIPES]
 PipeB1  ResB  JuncB1  600  250  110  0  OPEN
`;

describe("EPANET Multi-File Workspace Indexer", () => {
  it("indexes multiple EPANET hydraulic network files across workspace", () => {
    const ws = new UnifiedWorkspace(epanetLanguage);
    const uriA = "file:///workspace/networks/sector_a.inp";
    const uriB = "file:///workspace/networks/sector_b.inp";

    ws.setDocument(uriA, NET_A);
    ws.setDocument(uriB, NET_B);

    assert.strictEqual(ws.fileCount, 2);
    assert.strictEqual(ws.hasDocument(uriA), true);
    assert.strictEqual(ws.hasDocument(uriB), true);

    const docA = getEpanetNetwork(ws, uriA);
    assert.strictEqual(docA?.junctions.length, 1);
    assert.strictEqual(docA?.junctions[0]?.id, "JuncA1");

    const syms = ws.findSymbolsByName("JuncB1");
    assert.strictEqual(syms.length, 1);
    assert.strictEqual(syms[0]?.name, "JuncB1");
  });
});
