// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildParser } from "@modelscript/dsl";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { scaleDeckGrammar } from "../src/grammar/scale-grammar.js";
import { scaleLanguage } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("SCALE @modelscript/dsl Native WASM GLR Parser", () => {
  it("defines formal declarative SCALE grammar conforming to @modelscript/dsl spec", () => {
    assert.equal(scaleDeckGrammar.name, "ScaleDeck");
    assert.equal(scaleLanguage.name, "scale");
    const rules = scaleDeckGrammar.rules;
    assert.ok(rules);
    assert.ok(rules["Deck"]);
    assert.ok(rules["SequenceCard"]);
    assert.ok(rules["CompBlock"]);
    assert.ok(rules["CellDataBlock"]);
    assert.ok(rules["ParamBlock"]);
    assert.ok(rules["GeomBlock"]);
    assert.ok(rules["BoundsBlock"]);
    assert.ok(rules["ArrayBlock"]);
    assert.ok(rules["KenoUnitBlock"]);
    assert.ok(rules["OrigenCaseBlock"]);
  });

  it("compiles SCALE grammar via buildParser into AssemblyScript & JS bindings", () => {
    const result = buildParser(scaleDeckGrammar as Parameters<typeof buildParser>[0]);
    assert.ok(result);
    assert.ok(result.assemblyScriptFiles.length > 0);
    const parserFile = result.assemblyScriptFiles.find((f) => f.filename === "parser.ts");
    assert.ok(parserFile);
    assert.ok(result.javascriptWrapper.js.length > 0);
  });

  it("instantiates dist/parser.wasm and parses CSAS6 & ORIGEN decks into linear CST", async () => {
    const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    const { parser } = await createWasmParser(wasmBytes);
    assert.ok(parser);

    const csasDeck = `' Pin Cell Example
=csas6
read comp
  uo2 1 den=10.4 1 900 end
end comp
read geom
  global unit 1
  cylinder 1 0.41 10.0 -10.0
  media 1 1 1
  boundary 1
end geom
read bounds
  all=mirror
end bounds
end
`;
    const tree1 = parser.parse(csasDeck);
    assert.ok(tree1?.rootNode);
    assert.equal(tree1.rootNode.type, "Deck");
    assert.equal(tree1.rootNode.hasError, false);

    const origenDeck = `' ORIGEN Decay Chain
=origen
case(c1) {
  lib { file="pwr.f33" }
  mat { units=atoms iso=[ i135=1.0e15 ] }
  time { units=hours t=[ 1 6 12 ] }
  flux=[ 0 0 0 ]
  save
}
end
`;
    const tree2 = parser.parse(origenDeck);
    assert.ok(tree2?.rootNode);
    assert.equal(tree2.rootNode.type, "Deck");
    assert.equal(tree2.rootNode.hasError, false);
  });
});
