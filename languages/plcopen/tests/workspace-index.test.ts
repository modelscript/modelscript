// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { PlcopenWorkspaceIndex } from "../src/workspace-index.js";

describe("PLCopen Multi-File Workspace Index", () => {
  it("indexes POUs, variables, and tasks and resolves across scopes", () => {
    const idx = new PlcopenWorkspaceIndex();
    const uri = "file:///workspace/station.st";
    const code = `
      PROGRAM StationController
        VAR_INPUT
          SensorA : BOOL;
        END_VAR
        VAR_OUTPUT
          ActuatorB : BOOL;
        END_VAR
      END_PROGRAM
    `;

    const symIndex = idx.indexFile(uri, code);
    assert.strictEqual(idx.fileCount, 1);
    assert(symIndex.symbols.size >= 3);

    const pouSyms = idx.findByName("StationController");
    assert.strictEqual(pouSyms.length, 1);
    assert.strictEqual(pouSyms[0]!.kind, "Class");

    const sensorSyms = idx.findByName("SensorA");
    assert.strictEqual(sensorSyms.length, 1);
    assert.strictEqual(sensorSyms[0]!.kind, "Component");

    // Scope resolution
    const resolved = idx.resolveInScope("SensorA", pouSyms[0]!.id, uri);
    assert(resolved !== null);
    assert.strictEqual(resolved?.name, "SensorA");
  });
});
