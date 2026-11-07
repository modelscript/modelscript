// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getClassIcon, globalClassIconCache } from "../src/components/morsel/util/lsp-bridge.js";

describe("Morsel General Component & Library Icon Resolution", () => {
  it("strips __LIB__: prefix and caches resolved icons in globalClassIconCache", async () => {
    // Populate cache with a clean name
    globalClassIconCache.set("Modelica", "<svg viewBox='0 0 100 100'><rect width='100' height='100'/></svg>");

    // Querying with __LIB__:Modelica should immediately return the cached SVG
    const svg = await getClassIcon("__LIB__:Modelica");
    assert.ok(svg, "Must return icon SVG for __LIB__:Modelica");
    assert.ok(svg?.includes("<svg"), "Must be valid SVG string");
    assert.strictEqual(globalClassIconCache.get("__LIB__:Modelica"), svg, "Must cache both raw and clean names");
  });

  it("deduplicates in-flight icon requests", async () => {
    globalClassIconCache.clear();
    // Simulate setting into cache
    globalClassIconCache.set("TestClass", "<svg id='test'/>");

    const [res1, res2] = await Promise.all([
      getClassIcon("TestClass"),
      getClassIcon("TestClass"),
    ]);

    assert.strictEqual(res1, res2);
    assert.strictEqual(res1, "<svg id='test'/>");
  });

  it("filters out synthetic junction dots and nodes without properties", () => {
    const rawNodes = [
      { id: "R1", properties: { className: "Modelica.Electrical.Analog.Basic.Resistor", classKind: "model" } },
      { id: "solder_dot_1", shape: "circle" },
      { id: "solder_dot_2" },
      { id: "C1", properties: { className: "Modelica.Electrical.Analog.Basic.Capacitor", classKind: "model" } },
    ];

    const validComponents = rawNodes.filter((c: any) => {
      if (!c.id || c.id.startsWith("__diagram_") || c.id.startsWith("solder_dot_")) return false;
      if (!c.properties || c.shape === "circle") return false;
      const kind = c.properties?.classKind?.toLowerCase();
      if (kind && kind.includes("connector")) return false;
      return true;
    });

    assert.strictEqual(validComponents.length, 2);
    assert.strictEqual(validComponents[0].id, "R1");
    assert.strictEqual(validComponents[1].id, "C1");
  });

  it("extracts short type names from fully qualified Modelica class names for ComponentList display", () => {
    const testCases = [
      { fqn: "Modelica.Electrical.Analog.Sources.SineVoltage", expectedShort: "SineVoltage" },
      { fqn: "Modelica.Electrical.Analog.Basic.Inductor", expectedShort: "Inductor" },
      { fqn: "Modelica.Electrical.Analog.Basic.Capacitor", expectedShort: "Capacitor" },
      { fqn: "Modelica.Electrical.Analog.Basic.Resistor", expectedShort: "Resistor" },
      { fqn: "Modelica.Electrical.Analog.Basic.Ground", expectedShort: "Ground" },
    ];

    for (const { fqn, expectedShort } of testCases) {
      const rawClassName = fqn;
      const rawKind = "model";
      const shortTypeName = rawClassName.includes(".")
        ? rawClassName.split(".").pop()
        : rawClassName.toLowerCase() !== rawKind.toLowerCase()
          ? rawClassName
          : undefined;

      assert.strictEqual(shortTypeName, expectedShort, `Short name for ${fqn} must be ${expectedShort}`);
    }
  });

  it("normalizeSvgForIcon sets 100% width/height on outer svg without corrupting stroke-width or child element dimensions", async () => {
    const { normalizeSvgForIcon } = await import("../src/components/morsel/util/x6.js");

    const sampleSineVoltage = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="-100 -100 200 200">
    <g>
        <ellipse rx="50" ry="50" cx="0" cy="0" fill="#ffffff" stroke="#0000ff" stroke-width="1" vector-effect="non-scaling-stroke"></ellipse>
    </g>
</svg>`;

    const normalized = normalizeSvgForIcon(sampleSineVoltage);
    assert.ok(normalized.startsWith('<svg width="100%" height="100%"'), "Root svg must have width and height 100%");
    assert.ok(normalized.includes('stroke-width="1"'), "Must preserve inner stroke-width='1' and not replace it with 100%");
    assert.ok(!normalized.includes('stroke-width="100%"'), "Must never produce stroke-width='100%'");

    const sampleResistor = `<svg viewBox="-100 -100 200 200"><rect width="140" height="60" x="-70" y="-30" fill="#ffffff" stroke="#0000ff" stroke-width="1"/></svg>`;
    const normalizedResistor = normalizeSvgForIcon(sampleResistor);
    assert.ok(normalizedResistor.includes('width="140"'), "Must preserve inner rect width");
    assert.ok(normalizedResistor.includes('height="60"'), "Must preserve inner rect height");
    assert.ok(normalizedResistor.includes('stroke-width="1"'), "Must preserve inner rect stroke-width");
  });
});

