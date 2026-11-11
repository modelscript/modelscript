// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "assert";
import test from "node:test";
import { iconCache, registerTreeHandlers } from "../src/handlers/treeHandler.js";
import { loadPrebakedMslIcons, padIconViewBox } from "../src/utils/msl-icons-loader.js";

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

  // Verify Modelica and Package icons have padded viewBox to prevent clipped rounded corners
  const modelicaSvg = iconCache.get("Modelica");
  assert(modelicaSvg, "Icon for Modelica must be present in prebaked cache");
  assert(
    modelicaSvg.includes('viewBox="-105 -105 210 210"') || modelicaSvg.includes('data-viewbox-padded="true"'),
    "Modelica icon must have padded viewBox to keep rounded corners unclipped",
  );
  assert(modelicaSvg.includes('rx="25"'), "Modelica icon must contain rounded rectangle rx=25");

  const packageSvg = iconCache.get("Modelica.Icons.Package");
  assert(packageSvg, "Icon for Modelica.Icons.Package must be present in prebaked cache");
  assert(
    packageSvg.includes('viewBox="-105 -105 210 210"') || packageSvg.includes('data-viewbox-padded="true"'),
    "Package icon must have padded viewBox to keep rounded corners unclipped",
  );

  // Test padIconViewBox unit behavior
  const rawSvg = '<svg viewBox="-100 -100 200 200"><rect x="-100" y="-100" width="200" height="200" rx="25"/></svg>';
  const padded = padIconViewBox(rawSvg);
  assert(padded.includes('viewBox="-105 -105 210 210"'), "padIconViewBox must pad tight viewBox by 2.5%");
  assert(padded.includes('data-viewbox-padded="true"'), "padIconViewBox must mark data-viewbox-padded");
  // Idempotency: second call must not double pad
  assert.strictEqual(padIconViewBox(padded), padded, "padIconViewBox must be idempotent");

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
        getIndex: () => ({ symbols: new Map(), byName: new Map(), childrenOf: new Map() }),
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
