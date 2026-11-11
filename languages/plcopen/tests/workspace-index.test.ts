// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { getPlcopenProject, plcopenLanguage, resolvePlcopenInScope } from "../src/index.js";

describe("PLCopen UnifiedWorkspace Indexing", () => {
  it("indexes POUs, variables, and tasks and resolves across scopes", () => {
    const ws = new UnifiedWorkspace(plcopenLanguage);
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

    ws.setDocument(uri, code);
    assert.strictEqual(ws.fileCount, 1);
    assert.strictEqual(getPlcopenProject(ws, uri)?.pous.length, 1);
    assert(ws.getIndex().symbols.size >= 3);

    const pouSyms = ws.findSymbolsByName("StationController");
    assert.strictEqual(pouSyms.length, 1);
    assert.strictEqual(pouSyms[0]!.kind, "Class");

    const sensorSyms = ws.findSymbolsByName("SensorA");
    assert.strictEqual(sensorSyms.length, 1);
    assert.strictEqual(sensorSyms[0]!.kind, "Component");

    // Scope resolution
    const resolved = resolvePlcopenInScope(ws, "SensorA", pouSyms[0]!.id, uri);
    assert(resolved !== null);
    assert.strictEqual(resolved?.name, "SensorA");
  });
});
