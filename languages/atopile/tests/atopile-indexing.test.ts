// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { canIndexAtopileFile, indexAtopileFile } from "../src/indexing.js";

describe("@modelscript/atopile — UnifiedWorkspace Indexing", () => {
  it("recognizes and indexes .ato modules and component instances", () => {
    const text = `
module PowerStage:
    r1 = new Resistor
    c1 = new Capacitor
`;
    assert.strictEqual(canIndexAtopileFile("power.ato", text), true);

    const symbols: { name: string; kind: string }[] = [];
    let nextId = 1;
    indexAtopileFile({
      uri: "file:///power.ato",
      text,
      setParsedModel: () => {},
      addSymbol: (name: string, kind: string) => {
        symbols.push({ name, kind });
        return nextId++ as never;
      },
    } as never);

    assert(symbols.some((s) => s.name === "PowerStage" && s.kind === "Class"));
    assert(symbols.some((s) => s.name === "r1" && s.kind === "Component"));
    assert(symbols.some((s) => s.name === "c1" && s.kind === "Component"));
  });
});
