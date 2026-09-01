import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/dsl/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl/language.js";
import { TableauReasoner } from "../src/runtime/wasm_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDsl = language({
  name: "HybridReasonerTestLang",
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

describe("Hybrid Full OWL 2 DL + SHACL Reasoning Suite", () => {
  const tmpDir = path.join(__dirname, "scratch_build_reasoner_hybrid");
  let facade: any;

  beforeAll(async () => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const result = buildParser(testDsl as any);
    for (const file of result.assemblyScriptFiles) {
      fs.writeFileSync(path.join(tmpDir, file.filename), file.content);
    }

    const ascPath = path.resolve(__dirname, "../../../node_modules/.bin/asc");
    const parserTs = path.join(tmpDir, "parser.ts");
    const outWasm = path.join(tmpDir, "parser.wasm");

    const ascCmd = `${ascPath} ${parserTs} -o ${outWasm} --exportRuntime --enable threads --enable simd --debug --runtime stub`;
    try {
      childProcess.execSync(ascCmd, { stdio: "pipe" });
    } catch (e: any) {
      console.error("ASC STDOUT:", e.stdout?.toString());
      console.error("ASC STDERR:", e.stderr?.toString());
      throw e;
    }

    const wasm = fs.readFileSync(outWasm);
    const wasmModule = await WebAssembly.compile(wasm);

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
    if (instance.exports.initCompiler) {
      instance.exports.initCompiler();
    }
    const wrapperSrc =
      result.javascriptWrapper.js.replace(/export default /g, "").replace(/export /g, "") + "\nreturn { LspFacade };";
    const { LspFacade } = new Function(wrapperSrc)();
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Tier 1: Symmetric, Inverse, and Self Restrictions in WASM", () => {
    test("should deduce reverse edges for symmetric properties", () => {
      facade.clearOntology();
      const AXIOM_SYMMETRIC_PROP = 20;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      // Assert Sym(connectedTo) and connectedTo(PortA, PortB)
      facade.addOntologyAxiom(AXIOM_SYMMETRIC_PROP, LANG_MODELICA, 0, "connectedTo", 0);
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "PortA", "connectedTo", "PortB");

      facade.runHybridFixpoint();

      // Query if PortB connectedTo PortA was inferred
      const triples = facade.queryOntologyTriples("PortB", "connectedTo", "PortA");
      expect(triples.length).toBeGreaterThanOrEqual(1);
    });

    test("should deduce inverse property edges", () => {
      facade.clearOntology();
      const AXIOM_INVERSE_PROP = 21;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      // Assert Inv(hasPart, partOf) and hasPart(Car, Engine)
      facade.addOntologyAxiom(AXIOM_INVERSE_PROP, LANG_MODELICA, 0, "hasPart", "partOf");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Car", "hasPart", "Engine");

      facade.runHybridFixpoint();

      const triples = facade.queryOntologyTriples("Engine", "partOf", "Car");
      expect(triples.length).toBeGreaterThanOrEqual(1);
    });

    test("should deduce self-loops for self-restricted classes", () => {
      facade.clearOntology();
      const AXIOM_SELF_RESTRICTION = 26;
      const AXIOM_CLASS_ASSERT = 11;
      const LANG_MODELICA = 1;

      // SelfRegulator ⊑ ∃controls.Self, v1 : SelfRegulator
      facade.addOntologyAxiom(AXIOM_SELF_RESTRICTION, LANG_MODELICA, "SelfRegulator", "controls", 0);
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "v1", 0, "SelfRegulator");

      facade.runHybridFixpoint();

      const triples = facade.queryOntologyTriples("v1", "controls", "v1");
      expect(triples.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Tier 1: Universal Restrictions (∀R.C) & Unit Resolution Disjunction", () => {
    test("should forward-propagate universal restrictions across outgoing edges", () => {
      facade.clearOntology();
      const AXIOM_UNIVERSAL_RESTRICTION = 17;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const AXIOM_CLASS_ASSERT = 11;
      const LANG_MODELICA = 1;

      // EV ⊑ ∀hasMotor.ElectricMotor, ev1 : EV, ev1 hasMotor m1
      facade.addOntologyAxiom(AXIOM_UNIVERSAL_RESTRICTION, LANG_MODELICA, "EV", "hasMotor", "ElectricMotor");
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "ev1", 0, "EV");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "ev1", "hasMotor", "m1");

      facade.runHybridFixpoint();

      expect(facade.isInstanceOf("m1", "ElectricMotor")).toBe(true);
    });

    test("should resolve disjunction via unit resolution with disjoint classes", () => {
      facade.clearOntology();
      const AXIOM_DISJUNCTIVE_CLASS = 18;
      const AXIOM_DISJOINT_CLASSES = 4;
      const AXIOM_CLASS_ASSERT = 11;
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // PowerSource ⊑ Battery ⊔ SolarPanel
      // Battery and ThermalGenerator are disjoint
      // ps1 : PowerSource, ps1 : ThermalGenerator (so ps1 cannot be Battery)
      // ⇒ ps1 : SolarPanel
      const d1Hash = facade.hashString("Battery");
      const d2Hash = facade.hashString("SolarPanel");
      facade.addOntologyAxiom(AXIOM_DISJUNCTIVE_CLASS, LANG_MODELICA, "PowerSource", 0, "Battery", d2Hash);
      facade.addOntologyAxiom(AXIOM_DISJOINT_CLASSES, LANG_MODELICA, "Battery", 0, "ThermalGenerator");

      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "ps1", 0, "PowerSource");
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "ps1", 0, "ThermalGenerator");

      facade.runHybridFixpoint();

      expect(facade.isInstanceOf("ps1", "SolarPanel")).toBe(true);
    });
  });

  describe("Tier 1: SHACL-AF Rules & Interleaved Deductive Fixpoint", () => {
    test("should evaluate degree counting SHACL rule and classify drone", () => {
      facade.clearOntology();
      const AXIOM_SHACL_RULE = 27;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const AXIOM_CLASS_ASSERT = 11;
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // SHACL Rule: If device has >= 4 containsComponent pointing to Rotor, derive MultiRotorDrone
      // MultiRotorDrone ⊑ AerialVehicle
      const minCount = 4;
      const maxCount = 0; // unbounded
      const flags = (minCount << 16) | (maxCount & 0xffff);
      const derivedClassHash = facade.hashString("MultiRotorDrone");

      facade.addOntologyAxiom(
        AXIOM_SHACL_RULE,
        LANG_MODELICA,
        "Device",
        "containsComponent",
        "Rotor",
        flags,
        derivedClassHash,
      );
      // Set subclass: MultiRotorDrone ⊑ AerialVehicle
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "MultiRotorDrone", 0, "AerialVehicle");

      // Assert uav1 : Device and 4 Rotors
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "uav1", 0, "Device");
      for (let i = 1; i <= 4; i++) {
        facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, `r${i}`, 0, "Rotor");
        facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "uav1", "containsComponent", `r${i}`);
      }

      // Run interleaved fixpoint
      const inferences = facade.runHybridFixpoint();
      expect(inferences).toBeGreaterThanOrEqual(1);

      // Verify that uav1 is now classified as MultiRotorDrone and inherits AerialVehicle
      expect(facade.isInstanceOf("uav1", "MultiRotorDrone")).toBe(true);
      expect(facade.isInstanceOf("uav1", "AerialVehicle")).toBe(true);
    });
  });

  describe("Tier 1: Advanced Constraint Validation (Asymmetry, Irreflexivity, Disjoint)", () => {
    test("should detect asymmetric property violations", () => {
      facade.clearOntology();
      const AXIOM_ASYMMETRIC_PROP = 22;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      facade.addOntologyAxiom(AXIOM_ASYMMETRIC_PROP, LANG_MODELICA, 0, "strictlyDependsOn", 0);
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "A", "strictlyDependsOn", "B");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "B", "strictlyDependsOn", "A");

      const violations = facade.validateAdvancedConstraints();
      expect(violations.length).toBeGreaterThanOrEqual(1);
    });

    test("should detect irreflexive property violations", () => {
      facade.clearOntology();
      const AXIOM_IRREFLEXIVE_PROP = 23;
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      facade.addOntologyAxiom(AXIOM_IRREFLEXIVE_PROP, LANG_MODELICA, 0, "directChildOf", 0);
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Node1", "directChildOf", "Node1");

      const violations = facade.validateAdvancedConstraints();
      expect(violations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Tier 2: WASM Branching Tableau Subsumption Solver", () => {
    test("should solve ungrounded disjunctive case-analysis via Tableau fallback", () => {
      facade.clearOntology();
      const AXIOM_DISJUNCTIVE_CLASS = 18;
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // PowerSource ⊑ Battery ⊔ SolarPanel
      // Battery ⊑ DirectCurrentDevice
      // SolarPanel ⊑ DirectCurrentDevice
      // Query: Is PowerSource ⊑ DirectCurrentDevice?
      const d2Hash = facade.hashString("SolarPanel");
      facade.addOntologyAxiom(AXIOM_DISJUNCTIVE_CLASS, LANG_MODELICA, "PowerSource", 0, "Battery", d2Hash);
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Battery", 0, "DirectCurrentDevice");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "SolarPanel", 0, "DirectCurrentDevice");

      const tableauResult = facade.runTableauSubsumption("PowerSource", "DirectCurrentDevice");
      expect(tableauResult).toBe(true);

      const invalidResult = facade.runTableauSubsumption("PowerSource", "AlternatingCurrentDevice");
      expect(invalidResult).toBe(false);
    });
  });

  describe("High-Level TypeScript TableauReasoner Integration", () => {
    test("should handle symmetric and inverse properties in pure TS", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "SymmetricObjectProperty", propertyIri: "mo:connectedTo" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:connectedTo", subjectIri: "mo:p1", objectIri: "mo:p2" },
        { type: "InverseObjectProperty", propertyIri: "mo:hasPart", inversePropertyIri: "mo:partOf" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:hasPart", subjectIri: "mo:Car", objectIri: "mo:Engine" },
      ]);

      const q1 = reasoner.query({ type: "property-values", iri: "mo:connectedTo" });
      expect(q1.pairs?.some((p) => p.subject === "mo:p2" && p.object === "mo:p1")).toBe(true);

      const q2 = reasoner.query({ type: "property-values", iri: "mo:partOf" });
      expect(q2.pairs?.some((p) => p.subject === "mo:Engine" && p.object === "mo:Car")).toBe(true);
    });

    test("should handle universal and self restrictions in pure TS", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "UniversalRestriction", propertyIri: "mo:hasEngine", targetClassIri: "mo:ElectricEngine" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:hasEngine", subjectIri: "mo:car1", objectIri: "mo:eng1" },
        { type: "ClassDeclaration", iri: "mo:SelfRegulator" },
        { type: "ClassAssertion", individualIri: "mo:v1", classIri: "mo:SelfRegulator" },
        { type: "SelfRestriction", classIri: "mo:SelfRegulator", propertyIri: "mo:controls" },
      ]);

      const cls = reasoner.classifyIndividual("mo:eng1");
      expect(cls.allTypes).toContain("mo:ElectricEngine");

      const q = reasoner.query({ type: "property-values", iri: "mo:controls" });
      expect(q.pairs?.some((p) => p.subject === "mo:v1" && p.object === "mo:v1")).toBe(true);
    });
  });
});
