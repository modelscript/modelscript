import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dsl = language({
  name: "OntologyTestLang",
  rules: {
    Program: ($: any) => repeat($.ModelDef),
    ModelDef: ($: any) =>
      seq(
        semanticToken("keyword", "model"),
        field("name", $.Identifier),
        repeat($.Decl),
        semanticToken("keyword", "end"),
        ";",
      ),
    Decl: ($: any) => seq("Real", field("name", $.Identifier), ";"),
    Identifier: ($: any) => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
  },
  symbols: {
    ModelDef: { name: "name", kind: "model", scope: true },
    Decl: { name: "name", kind: "Variable", scope: false },
  },
  extras: ($: any) => [/\s+/],
});

describe("Phase 3: Knowledge Stores, Semantic Projections & Synthetic Deduplication", () => {
  const tmpDir = path.join(__dirname, "scratch_build_ontology");
  let facade: any;
  let wasmExports: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(dsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    childProcess.execSync(ascCmd, { stdio: "inherit" });

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

    const createInstance = async () => {
      const memory = new WebAssembly.Memory({ initial: 64, maximum: 1024, shared: true });
      const imports = {
        env: {
          memory,
          abort: (msg: any, file: any, line: any, col: any) => {
            console.error(`WASM ABORT: line ${line}, col ${col}`);
          },
        },
        JavaScript: { debugLog: () => {}, logNode: () => {} },
        engine: { debugLog: () => {} },
        parser: { logInt: () => {} },
        recovery: {},
        host: { runHostQuery: () => {} },
      };

      const instance = await WebAssembly.instantiate(wasmModule, imports);
      wasmExports = instance.exports;
      if (instance.exports.initCompiler) {
        instance.exports.initCompiler();
      }
      const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };";
      const { LspFacade } = new Function(wrapperSrc)();
      return new LspFacade(instance.exports.memory, instance.exports);
    };

    facade = await createInstance();
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("should assert OWL 2 axioms and query indexed triples via SPO / POS / OSP patterns", () => {
    facade.clearOntology();

    // AXIOM_CLASS_DECL = 1, AXIOM_SUBCLASS_OF = 2, AXIOM_OBJ_PROP_ASSERT = 7
    const AXIOM_CLASS_DECL = 1;
    const AXIOM_SUBCLASS_OF = 2;
    const AXIOM_OBJ_PROP_ASSERT = 7;
    const LANG_MODELICA = 1;

    // Assert Class Declarations
    facade.addOntologyAxiom(AXIOM_CLASS_DECL, LANG_MODELICA, "Motor");
    facade.addOntologyAxiom(AXIOM_CLASS_DECL, LANG_MODELICA, "ElectricalDevice");
    facade.addOntologyAxiom(AXIOM_CLASS_DECL, LANG_MODELICA, "Device");

    // Assert SubClassOf
    facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Motor", "", "ElectricalDevice");
    facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ElectricalDevice", "", "Device");

    // Assert Object Property Assertion: Motor hasPart Rotor
    facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Motor", "hasPart", "Rotor");

    expect(facade.getOntologyAxiomCount()).toBe(6);

    // 1. SPO Pattern Query: Subject = "Motor", Predicate = "hasPart"
    const spoResults = facade.queryOntologyTriples("Motor", "hasPart", "");
    expect(spoResults.length).toBe(1);
    expect(spoResults[0].axiomType).toBe(AXIOM_OBJ_PROP_ASSERT);

    // 2. POS Pattern Query: Predicate = "hasPart"
    const posResults = facade.queryOntologyTriples("", "hasPart", "");
    expect(posResults.length).toBe(1);

    // 3. OSP Pattern Query: Object = "Device"
    const ospResults = facade.queryOntologyTriples("", "", "Device");
    expect(ospResults.length).toBe(1);
    expect(ospResults[0].axiomType).toBe(AXIOM_SUBCLASS_OF);
  });

  test("should perform transitive SubClassOf subsumption directly in WASM memory", () => {
    facade.clearOntology();

    const AXIOM_SUBCLASS_OF = 2;
    const LANG_MODELICA = 1;

    // Motor -> ElectricalDevice -> Device -> PhysicalEntity
    facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Motor", "", "ElectricalDevice");
    facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ElectricalDevice", "", "Device");
    facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Device", "", "PhysicalEntity");

    // Direct SubClassOf
    expect(facade.isSubClassOf("Motor", "ElectricalDevice")).toBe(true);
    expect(facade.isSubClassOf("ElectricalDevice", "Device")).toBe(true);

    // Transitive Subsumption (2-hop and 3-hop)
    expect(facade.isSubClassOf("Motor", "Device")).toBe(true);
    expect(facade.isSubClassOf("Motor", "PhysicalEntity")).toBe(true);

    // Negative & Reverse cases
    expect(facade.isSubClassOf("Device", "Motor")).toBe(false);
    expect(facade.isSubClassOf("Motor", "SoftwareComponent")).toBe(false);
  });

  test("should automatically project declaration stubs into OWL 2 ontology axioms", () => {
    facade.clearStubs();
    facade.clearOntology();

    // Register Stubs:
    // Stub 1: Resistor (Class)
    // Stub 2: ResistorChild (Class, child of Stub 1)
    facade.registerStub(1, 1, 0, 1, 0, "Resistor", 0, 100);
    facade.registerStub(1, 2, 1, 1, 0, "ResistorChild", 100, 200);

    // Project stubs to ontology
    const projectedCount = facade.projectStubsToOntology(1);
    expect(projectedCount).toBeGreaterThanOrEqual(3);

    // Verify projected axioms enabled subsumption
    expect(facade.isSubClassOf("ResistorChild", "Resistor")).toBe(true);
    expect(facade.isSubClassOf("Resistor", "ResistorChild")).toBe(false);
  });

  test("should perform synthetic symbol projection with conflict deduplication against real declarations", () => {
    facade.clearStubs();

    // 1. Register a real (non-synthetic) code symbol in file 5
    const realStubId = facade.registerStub(5, 10, 0, 1, 0, "RealPumpModel", 0, 150);
    expect(realStubId).toBeGreaterThan(0);

    // 2. An ontology projector tries to project a synthetic stub with name "RealPumpModel"
    const deduplicatedStubId = facade.projectSyntheticSymbol(999, 1, 0, 1, "RealPumpModel");

    // Must return the existing real stub ID (Conflict Deduplication)
    expect(deduplicatedStubId).toBe(realStubId);

    // 3. Project a new synthetic stub with no existing real declaration
    const syntheticStubId = facade.projectSyntheticSymbol(999, 2, 0, 1, "VirtualOwlClass");
    expect(syntheticStubId).toBeGreaterThan(0);
    expect(syntheticStubId).not.toBe(realStubId);

    // Verify it is queryable by name
    const matches = facade.findStubsByName("VirtualOwlClass");
    expect(matches.length).toBe(1);
    expect(matches[0].fileId).toBe(999);
    expect(matches[0].flags & 0x0100).toBe(0x0100); // FLAG_IS_SYNTHETIC
  });
});
