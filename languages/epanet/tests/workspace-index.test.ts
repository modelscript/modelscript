// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { EpanetWorkspaceIndex } from "../src/workspace-index.js";

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
    const indexer = new EpanetWorkspaceIndex();
    const uriA = "file:///workspace/networks/sector_a.inp";
    const uriB = "file:///workspace/networks/sector_b.inp";

    indexer.indexSource(uriA, NET_A);
    indexer.indexSource(uriB, NET_B);

    assert.strictEqual(indexer.fileCount, 2);
    assert.strictEqual(indexer.has(uriA), true);
    assert.strictEqual(indexer.has(uriB), true);

    const docA = indexer.getDocument(uriA);
    assert.strictEqual(docA?.junctions.length, 1);
    assert.strictEqual(docA?.junctions[0]?.id, "JuncA1");

    const syms = indexer.getSymbolsByName("JuncB1");
    assert.strictEqual(syms.length, 1);
    assert.strictEqual(syms[0]?.name, "JuncB1");
  });
});
