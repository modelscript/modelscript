// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { findSpiceReferencesTo, findSpiceSymbols, resolveSpiceQualified, spiceLanguage } from "../src/index.js";

const FILE_LIB = `* Operational Amplifier Library (.lib)
.SUBCKT OPAMP_IDEAL in_pos in_neg out_pin
  E1 out_pin 0 in_pos in_neg 100000
.ENDS OPAMP_IDEAL

.MODEL DIODE_FAST D (IS=1e-12 RS=1 N=1.2)
.END
`;

const FILE_MAIN = `* Main Inverting Amplifier Circuit (.cir)
.INCLUDE opamp.lib
V1 in 0 SINE(0 1 1k)
R_in in inv 10k
R_fb inv out 100k
X1 0 inv out OPAMP_IDEAL
D1 out 0 DIODE_FAST
.END
`;

describe("SPICE Multi-File UnifiedWorkspace Indexer (@modelscript/spice)", () => {
  it("should index subcircuits, models, and components across multiple files", () => {
    const ws = new UnifiedWorkspace(spiceLanguage);
    ws.setDocument("file:///workspace/opamp.lib", FILE_LIB);
    ws.setDocument("file:///workspace/main.cir", FILE_MAIN);

    assert.strictEqual(ws.fileCount, 2);

    // 1. Symbol Search
    const opampSyms = findSpiceSymbols(ws, "OPAMP_IDEAL");
    assert.ok(opampSyms.length >= 1, "Should find OPAMP_IDEAL symbol");
    assert.strictEqual(opampSyms[0]?.kind, "Class");
    assert.strictEqual(opampSyms[0]?.ruleName, "spice_subcircuit");

    const diodeSyms = findSpiceSymbols(ws, "DIODE_FAST");
    assert.ok(diodeSyms.length >= 1, "Should find DIODE_FAST model symbol");
    assert.strictEqual(diodeSyms[0]?.ruleName, "spice_model");

    // 2. Qualified Resolution
    const resolvedOpAmp = resolveSpiceQualified(ws, "OPAMP_IDEAL", "file:///workspace/main.cir");
    assert.ok(resolvedOpAmp);
    assert.strictEqual(resolvedOpAmp.name, "OPAMP_IDEAL");

    // 3. Cross-file references
    if (opampSyms[0]) {
      const refs = findSpiceReferencesTo(ws, opampSyms[0].id);
      // X1 in main.cir references OPAMP_IDEAL
      assert.ok(refs.length >= 1, "Should find references from X1 to OPAMP_IDEAL");
      assert.strictEqual(refs[0]?.uri, "file:///workspace/main.cir");
    }
  });

  it("uses CST-first indexing from compiled WASM SPICE CST with exact spans and fieldRanges", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { createWasmParser } = await import("../src-gen/bindings.js");

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const wasmBytes = fs.readFileSync(path.join(__dirname, "../dist/parser.wasm"));
    const { parser } = await createWasmParser(wasmBytes);

    const cstNetlist = `* RC Filter Netlist
.SUBCKT AMP_STAGE n1 n2
R1 n1 n2 1k
C1 n2 0 10n
.ENDS AMP_STAGE
.MODEL NMOD NPN (BF=100)
V1 n1 0 DC 5
R_load n2 0 10k
X1 n1 n2 AMP_STAGE
`;
    const makeNode = (
      type: string,
      startIndex: number,
      endIndex: number,
      fields: Record<string, any> = {},
      namedChildren: any[] = [],
    ) => ({
      type,
      startIndex,
      endIndex,
      hasError: false,
      isError: false,
      text: cstNetlist.slice(startIndex, endIndex),
      children: namedChildren,
      namedChildren,
      childForFieldName: (f: string) => {
        const v = fields[f];
        return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
      },
      childrenForFieldName: (f: string) => {
        const v = fields[f];
        return Array.isArray(v) ? v : v ? [v] : [];
      },
    });

    const spanOf = (needle: string) => {
      const s = cstNetlist.indexOf(needle);
      return [s, s + needle.length] as const;
    };

    const [subS, subE] = [
      cstNetlist.indexOf(".SUBCKT"),
      cstNetlist.indexOf(".ENDS AMP_STAGE") + ".ENDS AMP_STAGE".length,
    ];
    const [subNameS, subNameE] = spanOf("AMP_STAGE");
    const subNode = makeNode("SubcktDef", subS, subE, {
      name: makeNode("Identifier", subNameS, subNameE),
      port: [makeNode("Node", ...spanOf("n1")), makeNode("Node", ...spanOf("n2"))],
    });

    const [modS, modE] = spanOf(".MODEL NMOD NPN (BF=100)");
    const [modNameS, modNameE] = spanOf("NMOD");
    const [modKindS, modKindE] = spanOf("NPN");
    const modelNode = makeNode("ModelDirective", modS, modE, {
      name: makeNode("Identifier", modNameS, modNameE),
      kind: makeNode("Identifier", modKindS, modKindE),
    });

    const [rS, rE] = spanOf("R_load n2 0 10k");
    const [rNameS, rNameE] = spanOf("R_load");
    const compNode = makeNode("TwoTerminalComponent", rS, rE, {
      name: makeNode("TwoTerminalId", rNameS, rNameE),
      positiveNode: makeNode("Node", ...spanOf("n2")),
      negativeNode: makeNode("Node", rS + 10, rS + 11),
      value: makeNode("Value", ...spanOf("10k")),
    });

    const cleanTree = {
      rootNode: makeNode("Circuit", 0, cstNetlist.length, {}, [subNode, modelNode, compNode]),
    };

    const ws = new UnifiedWorkspace(spiceLanguage);
    ws.indexDocumentText("file:///workspace/rc.cir", cstNetlist, "spice", cleanTree);
    const idx = ws.getFileIndex("file:///workspace/rc.cir")!;
    assert.ok(idx);

    const subSym = Array.from(idx.symbols.values()).find((s) => s.name === "AMP_STAGE");
    assert.ok(subSym, "Expected SubcktDef symbol AMP_STAGE");
    assert.strictEqual(
      cstNetlist.slice(subSym.fieldRanges!.name!.startOffset, subSym.fieldRanges!.name!.endOffset),
      "AMP_STAGE",
    );
    assert.strictEqual(subSym.startOffset, subS);
    assert.strictEqual(subSym.endOffset, subE);

    const modelSym = Array.from(idx.symbols.values()).find((s) => s.name === "NMOD");
    assert.ok(modelSym, "Expected ModelDirective symbol NMOD");
    assert.strictEqual(
      cstNetlist.slice(modelSym.fieldRanges!.name!.startOffset, modelSym.fieldRanges!.name!.endOffset),
      "NMOD",
    );

    const compSym = Array.from(idx.symbols.values()).find((s) => s.name === "R_load");
    assert.ok(compSym, "Expected Component symbol R_load");
    assert.strictEqual(
      cstNetlist.slice(compSym.fieldRanges!.name!.startOffset, compSym.fieldRanges!.name!.endOffset),
      "R_load",
    );

    // Error CST (including WASM parser output with hasError) should fall back gracefully to parseSpice
    const parsedTree = parser.parse(FILE_MAIN);
    ws.indexDocumentText("file:///workspace/fallback.cir", FILE_MAIN, "spice", parsedTree);
    const fbIdx = ws.getFileIndex("file:///workspace/fallback.cir")!;
    assert.ok(fbIdx.byName.has("R_in"));
  });
});
