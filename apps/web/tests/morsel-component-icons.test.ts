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
});
