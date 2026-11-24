// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { modelicaActionHandlers } from "../src/actions.js";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "../src/factory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const pelagosModelPath = path.resolve(__dirname, "../examples/PelagosOC8Octopus.mo");

describe("Pelagos OC-8 Multi-Body + Fluid Siphon Modelica Starter Template", () => {
  it("parses, flattens cleanly, and simulates 0..25s multi-body + 7-piston siphon physics", async () => {
    const code = fs.readFileSync(pelagosModelPath, "utf8");
    assert.ok(code.includes("model PelagosOC8SubseaOctopus"));

    const { parser } = await createWasmParser(modelicaWasmPath);
    const tree = parser.parse(code);
    assert.equal(tree.rootNode.hasError, false, "PelagosOC8Octopus.mo must parse with zero syntax errors");

    const uri = "memfs:/pelagos-octopus/PelagosOC8Octopus.mo";
    const ws = createModelicaWorkspaceIndex();
    ws.indexDocument(uri, () => tree.rootNode);
    const unified = ws.getIndex({ eager: true });
    const queryEngine = createModelicaQueryEngine(unified, {
      getText: (s, e) => code.substring(s, e),
      getNode: (s, e) => tree.rootNode.descendantForIndex(s, Math.max(s, e)),
    });

    const execContext: any = {
      uri,
      languageId: "modelica",
      documentText: code,
      queryEngine,
    };

    const flatRes = await modelicaActionHandlers.flatten!(execContext, {
      name: "PelagosOC8SubseaOctopus",
      documentText: code,
    });
    assert.ok(flatRes.text.includes("pump.piston7Disp"), "Expected all 7 swashplate pistons in flattened DAE");
    assert.ok(flatRes.text.includes("siphon.thrust"), "Expected siphon jet thruster in flattened DAE");
    assert.ok(flatRes.text.includes("hull.vx"), "Expected mantle multi-body surge dynamics in flattened DAE");
    assert.ok(flatRes.text.includes("arms.arm3DetachOffset"), "Expected Arm 3 magnetic detach in flattened DAE");

    const simRes = await modelicaActionHandlers.simulate!(execContext, {
      name: "PelagosOC8SubseaOctopus",
      documentText: code,
    });

    assert.equal(simRes.experiment?.stopTime, 25, "Expected 25s mission StopTime");
    assert.ok(simRes.t.length >= 100, `Expected dense trajectory, got ${simRes.t.length} samples`);

    const seriesAt = (varName: string, targetSec: number): number => {
      const idx = simRes.states.indexOf(varName);
      assert.ok(idx >= 0, `Expected simulated variable '${varName}' in states`);
      let bestRow = 0;
      let bestDist = Infinity;
      for (let r = 0; r < simRes.t.length; r++) {
        const d = Math.abs(simRes.t[r]! - targetSec);
        if (d < bestDist) {
          bestDist = d;
          bestRow = r;
        }
      }
      const val = simRes.y[bestRow]?.[idx];
      assert.ok(typeof val === "number" && Number.isFinite(val), `Non-finite value for ${varName} at t=${targetSec}`);
      return val;
    };

    const seriesMax = (varName: string): number => {
      const idx = simRes.states.indexOf(varName);
      assert.ok(idx >= 0, `Expected simulated variable '${varName}' in states`);
      let maxVal = -Infinity;
      for (let r = 0; r < simRes.y.length; r++) {
        const val = simRes.y[r]?.[idx];
        if (typeof val === "number" && Number.isFinite(val) && val > maxVal) {
          maxVal = val;
        }
      }
      return maxVal;
    };

    // 1. Siphon water-jet reaches rated ~2.68 m/s & ~6.0 N burst thrust during t = 13..20 s
    const peakJetVel = seriesMax("jetVelocity");
    const peakThrust = seriesMax("siphonThrust");
    const peakSurgeVel = seriesMax("surgeVelocity");
    assert.ok(peakJetVel >= 2.55 && peakJetVel <= 2.7, `Expected peak jetVelocity ~2.68 m/s, got ${peakJetVel}`);
    assert.ok(peakThrust >= 5.5 && peakThrust <= 6.1, `Expected peak siphonThrust ~6.0 N, got ${peakThrust}`);
    assert.ok(
      peakSurgeVel >= 1.8 && peakSurgeVel <= 2.75,
      `Expected burst surge velocity ~2.4-2.68 m/s, got ${peakSurgeVel}`,
    );

    // 2. Arm 3 autonomous magnetic collar detach (t=6..12.8s) & reconnect
    assert.equal(seriesAt("arm3Attached", 2.0), 1.0, "Arm 3 must be docked during initial dive");
    assert.equal(seriesAt("arm3Attached", 8.5), 0.0, "Arm 3 must be detached at t = 8.5 s");
    assert.ok(seriesAt("arm3DetachOffset", 9.0) > 0.2, "Arm 3 detach offset must reach > 0.20 m");
    assert.equal(seriesAt("arm3Attached", 15.0), 1.0, "Arm 3 must reconnect before jet burst");
    assert.ok(seriesAt("arm3DetachOffset", 15.5) < 0.02, "Arm 3 collar offset must close back to 0 m");

    // 3. Depth dives toward 38 m then surfaces back toward 4 m
    assert.ok(seriesAt("depthM", 10.0) > 32.0, `Expected dive depth > 32 m at t=10s, got ${seriesAt("depthM", 10.0)}`);
    assert.ok(
      seriesAt("depthM", 25.0) < 12.0,
      `Expected ascent back near surface at t=25s, got ${seriesAt("depthM", 25.0)}`,
    );

    // 4. All 7 swashplate pistons produce non-zero oscillating strokes
    for (let k = 1; k <= 7; k++) {
      const maxPiston = seriesMax(`pump.piston${k}Disp`);
      assert.ok(maxPiston > 0.01, `Expected pump.piston${k}Disp stroke > 0.01 m, got ${maxPiston}`);
    }
  });
});
