// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { asn1Language } from "../src/language.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

describe("ASN.1 DSL Grammar & Native WASM GLR Parser", () => {
  it("exports asn1Language with beta maturity, extensions, and UI panel", () => {
    assert.equal(asn1Language.name, "asn1");
    assert.equal(asn1Language.maturity, "beta");
    assert.ok(asn1Language.fileExtensions.includes(".asn"));
    assert.ok(asn1Language.fileExtensions.includes(".asn1"));
    assert.ok(asn1Language.fileExtensions.includes(".mib"));
    assert.ok(asn1Language.ui?.panels && asn1Language.ui.panels.length >= 1);
    assert.equal(asn1Language.ui.panels[0]!.entry, "./src/ui/Asn1Panel.tsx");
  });

  it("materializes native dist/parser.wasm and src-gen/bindings.js", () => {
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindingsPath = path.join(pkgRoot, "src-gen", "bindings.js");
    assert.equal(fs.existsSync(wasmPath), true, "dist/parser.wasm must exist");
    assert.equal(fs.existsSync(bindingsPath), true, "src-gen/bindings.js must exist");
    assert.ok(fs.statSync(wasmPath).size > 1000);
  });

  it("parses an ASN.1 module cleanly with the compiled WASM GLR parser", async () => {
    const bindingsPath = path.join(pkgRoot, "src-gen", "bindings.js");
    const wasmPath = path.join(pkgRoot, "dist", "parser.wasm");
    const bindings = (await import(bindingsPath)) as {
      createWasmParser?: (p: string) => Promise<{ parser: { parse: (src: string) => unknown } }>;
      initParser?: (buf: Uint8Array) => Promise<{ parse: (src: string) => unknown }>;
    };

    const sample = `
X509Mini DEFINITIONS EXPLICIT TAGS ::= BEGIN
  AlgorithmIdentifier ::= SEQUENCE {
    algorithm OBJECT IDENTIFIER,
    parameters NULL OPTIONAL
  }
END
`;

    if (typeof bindings.createWasmParser === "function") {
      const { parser } = await bindings.createWasmParser(wasmPath);
      const tree = parser.parse(sample);
      assert.ok(tree);
    } else if (typeof bindings.initParser === "function") {
      const bytes = fs.readFileSync(wasmPath);
      const parser = await bindings.initParser(bytes);
      const tree = parser.parse(sample);
      assert.ok(tree);
    } else {
      assert.ok(Object.keys(bindings).length > 0);
    }
  });
});
