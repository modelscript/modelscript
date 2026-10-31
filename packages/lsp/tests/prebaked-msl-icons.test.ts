// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "assert";
import test from "node:test";
import { iconCache, registerTreeHandlers } from "../src/handlers/treeHandler.js";
import { loadPrebakedMslIcons } from "../src/utils/msl-icons-loader.js";

test("test-prebaked-msl-icons-loader", async () => {
  iconCache.clear();
  assert.strictEqual(iconCache.size, 0, "iconCache should be initially empty");

  const t0 = performance.now();
  const count = await loadPrebakedMslIcons();
  const elapsedMs = performance.now() - t0;

  console.log(`Loaded ${count} prebaked MSL icons into iconCache in ${elapsedMs.toFixed(2)}ms`);
  assert(count > 5000, `Expected over 5000 icons, loaded ${count}`);
  assert(iconCache.size >= count, "iconCache must contain all loaded icons");

  // Verify critical component icons
  const testClasses = [
    "Modelica.Electrical.Analog.Basic.Resistor",
    "Modelica.Electrical.Analog.Basic.Capacitor",
    "Modelica.Blocks.Continuous.Integrator",
    "Modelica.Mechanics.Rotational.Components.Inertia",
    "Modelica.Electrical.Analog.Sources.SineVoltage",
    "Modelica.Blocks.Sources.Sine",
    "Modelica.Icons.Package",
  ];

  for (const fqn of testClasses) {
    const svg = iconCache.get(fqn);
    assert(svg, `Icon for ${fqn} must be present in prebaked cache`);
    assert(svg.startsWith("<svg"), `Icon for ${fqn} must start with <svg`);
    assert(svg.endsWith("</svg>"), `Icon for ${fqn} must end with </svg>`);
    assert(!svg.includes("NaN"), `Icon for ${fqn} must not contain NaN`);
  }

  // Test LSP handler lookup using prebaked cache
  const handlers = new Map<string, (...args: any[]) => any>();
  const mockContext: any = {
    connection: {
      onRequest: (name: string, fn: (...args: any[]) => any) => {
        handlers.set(name, fn);
      },
    },
    workspaceManager: {
      unifiedWorkspace: {
        toTreeIndex: () => ({ symbols: new Map(), byName: new Map(), childrenOf: new Map() }),
      },
    },
  };

  registerTreeHandlers(mockContext);

  const getClassIcon = handlers.get("modelscript/getClassIcon")!;
  const getClassIcons = handlers.get("modelscript/getClassIcons")!;

  const tSingle = performance.now();
  const singleSvg = await getClassIcon({ className: "Modelica.Electrical.Analog.Basic.Resistor" });
  const singleElapsed = performance.now() - tSingle;
  assert(singleSvg && singleSvg.startsWith("<svg"), "Single lookup must succeed");
  console.log(`Single icon lookup took ${singleElapsed.toFixed(3)}ms`);
  assert(singleElapsed < 2.0, `Single lookup should be sub-millisecond, took ${singleElapsed.toFixed(3)}ms`);

  const tBatch = performance.now();
  const batchResult = await getClassIcons({ classNames: testClasses });
  const batchElapsed = performance.now() - tBatch;
  console.log(`Batch lookup for ${testClasses.length} icons took ${batchElapsed.toFixed(3)}ms`);
  assert(batchElapsed < 5.0, `Batch lookup should be sub-millisecond, took ${batchElapsed.toFixed(3)}ms`);

  for (const fqn of testClasses) {
    assert(batchResult[fqn], `Batch result must contain ${fqn}`);
    assert(batchResult[fqn].startsWith("<svg"), `Batch result for ${fqn} must be SVG`);
  }

  console.log("test-prebaked-msl-icons-loader passed successfully!");
});
