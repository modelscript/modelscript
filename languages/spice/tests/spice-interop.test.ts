// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DAEBuilder,
  eliminateArenaAliases,
  initBltWasm,
  InteropTrait,
  makePolyglotSymbolId,
  performBltTransformationArena,
  PolyglotDaeInliner,
  type SymbolEntry,
  type SymbolIndex,
  SymbolInteropRegistry,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { createSpiceInteropLibrary, getSpiceDomainId } from "../src/interop.js";

describe("@modelscript/spice SymbolInteropLibrary Pilot", () => {
  it("streams ports/parameters and inlines SPICE R/C/L devices directly into a host DAEBuilder", async () => {
    await initBltWasm();
    const spiceLib = createSpiceInteropLibrary();
    const domainId = getSpiceDomainId();
    assert.strictEqual(spiceLib.domainId, domainId);

    const rSym = makePolyglotSymbolId(domainId, 1);
    const cSym = makePolyglotSymbolId(domainId, 2);
    const entries: SymbolEntry[] = [
      {
        id: rSym,
        name: "R1",
        kind: "Resistor",
        ruleName: "resistor",
        namePath: "name",
        startOffset: 0,
        endOffset: 10,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { deviceType: "R", R: 500 },
        fieldName: null,
      },
      {
        id: cSym,
        name: "C1",
        kind: "Capacitor",
        ruleName: "capacitor",
        namePath: "name",
        startOffset: 11,
        endOffset: 22,
        parentId: null,
        exports: [],
        inherits: [],
        metadata: { deviceType: "C", C: 1e-3 },
        fieldName: null,
      },
    ];
    const index: SymbolIndex = {
      symbols: new Map(entries.map((e) => [e.id, e])),
      byName: new Map(entries.map((e) => [e.name, [e.id]])),
      childrenOf: new Map([[null, entries.map((e) => e.id)]]),
    };

    const registry = new SymbolInteropRegistry().register(spiceLib);
    assert.strictEqual(
      registry.hasTraits(rSym, InteropTrait.HasPorts | InteropTrait.HasParameters | InteropTrait.LowerableDAE, index),
      true,
    );

    const ports: string[] = [];
    spiceLib.readPorts!(rSym, (n) => ports.push(n), index);
    assert.deepStrictEqual(ports, ["p", "n"]);

    const params: string[] = [];
    spiceLib.readParameters!(cSym, (n, _t, v, u) => params.push(`${n}=${v}${u}`), index);
    assert.deepStrictEqual(params, ["C=0.001F"]);

    const dae = new DAEBuilder();
    const inliner = new PolyglotDaeInliner(registry);
    const rHandle = inliner.inlineComponent(rSym, dae, "r1", undefined, index);
    const cHandle = inliner.inlineComponent(cSym, dae, "c1", undefined, index);
    // Connect R1.n <-> C1.p and ground C1.n & drive R1.p = 5V
    inliner.bindPorts(dae, rHandle.portsByName.get("n")!, cHandle.portsByName.get("p")!);
    const ref = (v: number) => dae.addName(dae.getVarNameId(v));
    dae.addEquation(0, ref(rHandle.portsByName.get("p")!.potentialVarId!), dae.addRealLiteral(5.0));
    dae.addEquation(0, ref(cHandle.portsByName.get("n")!.potentialVarId!), dae.addRealLiteral(0.0));

    eliminateArenaAliases(dae);
    const blt = performBltTransformationArena(dae);
    assert.ok(blt.sortedEquations.length > 0);
    assert.ok(blt.blocks.length > 0);
  });
});
