// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { AdamsWorkspaceIndex } from "../src/workspace-index.js";

const FILE1 = `
PART/1, GROUND
PART/2, MASS = 2.0, IP = 0.05, 0.05, 0.05
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
`;

test("Adams WorkspaceIndex - Multi-File Indexing and Symbol Recovery", () => {
  const index = new AdamsWorkspaceIndex();
  index.indexFile("file:///project/crank.adm", FILE1);

  assert.equal(index.fileCount, 1);
  assert.equal(index.has("file:///project/crank.adm"), true);

  const fileIdx = index.getFileIndex("file:///project/crank.adm");
  assert.ok(fileIdx);

  // Check indexed symbols
  assert.ok(fileIdx.byName.has("ground"));
  assert.ok(fileIdx.byName.has("part_2"));
  assert.ok(fileIdx.byName.has("marker_1"));
  assert.ok(fileIdx.byName.has("joint_1"));

  const dataset = index.getDataset("file:///project/crank.adm");
  assert.ok(dataset);
  assert.equal(dataset.parts.size, 2);
});
