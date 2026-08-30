// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterRegistry } from "../src/compiler/adapter-registry.js";
import type { SymbolEntry, SymbolIndex } from "../src/compiler/runtime.js";
import type { OWL2Axiom } from "../src/reasoner/types.js";
import { AXIOM_CLASS_DECL, AXIOM_SUBCLASS_OF, WasmOntologyStore } from "../src/runtime/wasm_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log("Testing WasmOntologyStore & WASM Runtime...");

  // 1. Test Host-side WasmOntologyStore functionality
  const registry = new AdapterRegistry();

  const mockIndex: SymbolIndex = {
    symbols: new Map([
      [
        1,
        {
          id: 1,
          name: "Resistor",
          ruleName: "model",
          namePath: "Resistor",
          startByte: 0,
          endByte: 10,
          parentId: null,
          exports: [],
          inherits: [],
          language: "modelica",
        },
      ],
    ]),
    byName: new Map([["Resistor", [1]]]),
    childrenOf: new Map(),
  };

  const mockLangConfig = {
    name: "modelica",
    rules: {
      model: (_$: any) => ({
        type: "def",
        options: {
          adapters: {
            owl2: {
              target: "ClassDeclaration",
              transform: (_db: any, entry: SymbolEntry) => {
                const name = entry.name;
                const axioms: OWL2Axiom[] = [
                  {
                    type: "ClassDeclaration",
                    iri: `mo:${name}`,
                    sourceLang: "modelica",
                  },
                ];
                if (name === "Resistor") {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: "mo:Resistor",
                    superClassIri: "mo:Component",
                    sourceLang: "modelica",
                  });
                }
                return { axioms };
              },
            },
          },
        },
      }),
    },
  };

  registry.registerLanguage(mockLangConfig, mockIndex);

  const store = new WasmOntologyStore(registry);
  store.registerSourceLanguage("modelica");

  // Project language
  const delta = store.projectLanguage("modelica");
  assert.strictEqual(delta.assertions.length, 2, "Should assert 2 axioms for Resistor");
  assert.strictEqual(delta.retractions.length, 0, "Should have 0 retractions");
  assert.strictEqual(store.size, 2, "Store size should be 2");

  // Query helpers
  const classes = store.getClassDeclarations();
  assert.strictEqual(classes.length, 1);
  assert.strictEqual((classes[0] as any).iri, "mo:Resistor");

  const superClasses = store.getSuperClasses("mo:Resistor");
  assert.strictEqual(superClasses.length, 1);
  assert.strictEqual((superClasses[0] as any).superClassIri, "mo:Component");

  const fss = store.toFunctionalSyntax();
  assert.ok(fss.includes("Declaration(Class(mo:Resistor))"));
  assert.ok(fss.includes("SubClassOf(mo:Resistor mo:Component)"));

  const syntheticIndex = store.toSyntheticSymbolEntries();
  assert.ok(syntheticIndex.symbols.size > 0, "Synthetic symbols should be generated");
  assert.ok(syntheticIndex.byName.has("mo:Resistor"));

  // Incremental update test
  const versions = new Map<string, number>();
  versions.set("modelica", 1);
  const updateDelta = store.update(versions);
  assert.ok(updateDelta !== null, "First update with version 1 should produce a delta");

  // Update without version change should be null
  const noDelta = store.update(versions);
  assert.strictEqual(noDelta, null, "Same version should not produce a delta");

  console.log("Host-side WasmOntologyStore tests passed.");

  // 2. Test WASM Ontology Store if WASM binary is compiled
  const wasmPath = path.resolve(__dirname, "../../languages/modelica/dist/parser.wasm");
  if (fs.existsSync(wasmPath)) {
    console.log("Loading compiled WASM binary:", wasmPath);
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: () => {
          throw new Error("WASM abort");
        },
      },
    });

    const exports = wasmModule.instance.exports as any;
    if (typeof exports.ontology_addAxiom === "function") {
      console.log("Testing zero-GC WASM ontology functions...");
      exports.ontology_clear();

      // String hashes (djb2 simple)
      const hash = (s: string) => {
        let h = 5381;
        for (let i = 0; i < s.length; i++) {
          h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        }
        return h;
      };

      const hResistor = hash("mo:Resistor");
      const hComponent = hash("mo:Component");
      const hDevice = hash("mo:Device");

      // Add Class declarations
      exports.ontology_addAxiom(AXIOM_CLASS_DECL, 1, hResistor, 0, 0, 0, 0);
      exports.ontology_addAxiom(AXIOM_CLASS_DECL, 1, hComponent, 0, 0, 0, 0);
      exports.ontology_addAxiom(AXIOM_CLASS_DECL, 1, hDevice, 0, 0, 0, 0);

      // Add SubClassOf: Resistor ⊑ Component, Component ⊑ Device
      exports.ontology_addAxiom(AXIOM_SUBCLASS_OF, 1, hResistor, 0, hComponent, 0, 0);
      exports.ontology_addAxiom(AXIOM_SUBCLASS_OF, 1, hComponent, 0, hDevice, 0, 0);

      // Saturate EL rules (transitive closure)
      const inferred = exports.ontology_saturateELRules();
      console.log(`WASM EL Rule saturation produced ${inferred} inferred axioms.`);

      // Check subsumption in WASM: Resistor ⊑ Device
      const isSub = exports.ontology_isSubClassOf(hResistor, hDevice);
      assert.strictEqual(isSub, 1, "Resistor should be a subclass of Device via transitive inference");

      // Check consistency
      const consistent = exports.ontology_checkConsistency();
      assert.strictEqual(consistent, 1, "Ontology should be consistent");

      console.log("Direct WASM ontology tests passed.");
    }
  }

  console.log("=== All WasmOntologyStore Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
