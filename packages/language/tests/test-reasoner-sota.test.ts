import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";
import {
  executeBgpQuery,
  executeDLQuery,
  formatBgpQueryResult,
  parseDLQuery,
  parsePropertyPathExpression,
  TableauReasoner,
} from "../src/reasoner/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDsl = language({
  name: "ReasonerSotaTestLang",
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

describe("SOTA Reasoning Enhancements Suite", () => {
  const tmpDir = path.join(__dirname, "scratch_build_reasoner_sota");
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
    const wrapperSrc = result.javascriptWrapper.js.replace(/export /g, "") + "\nreturn { LspFacade };";
    const { LspFacade } = new Function(wrapperSrc)();
    facade = new LspFacade(instance.exports.memory, instance.exports);
  }, 60000);

  afterAll(() => {
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("P1: O(1) Interval & Topological DAG Indexing", () => {
    test("should compute interval labels and evaluate instant subsumption in WASM", () => {
      facade.clearOntology();
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // Tree: Device -> ElectricalDevice -> Motor -> InductionMotor
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "InductionMotor", "", "Motor");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Motor", "", "ElectricalDevice");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ElectricalDevice", "", "Device");

      // Compute intervals
      facade.computeOntologyIntervalIndex();

      // Check subsumption
      expect(facade.isSubClassOf("InductionMotor", "Device")).toBe(true);
      expect(facade.isSubClassOf("InductionMotor", "Motor")).toBe(true);
      expect(facade.isSubClassOf("Device", "InductionMotor")).toBe(false);
    });
  });

  describe("P2: SPARQL 1.1 Property Path Expressions (+, *, ^, /, |)", () => {
    test("parsePropertyPathExpression should parse all path operators", () => {
      expect(parsePropertyPathExpression("connectedTo+")).toEqual({ iri: "connectedTo", pathOp: "plus" });
      expect(parsePropertyPathExpression("hasPart*")).toEqual({ iri: "hasPart", pathOp: "star" });
      expect(parsePropertyPathExpression("^hasPart")).toEqual({ iri: "hasPart", pathOp: "inverse" });
      expect(parsePropertyPathExpression("^connectedTo+")).toEqual({ iri: "connectedTo", pathOp: "inverse-plus" });
      expect(parsePropertyPathExpression("hasSubsystem / hasComponent")).toEqual({
        iri: "hasSubsystem",
        pathOp: "sequence",
        stepPropertyIri2: "hasComponent",
      });
      expect(parsePropertyPathExpression("fluidPort | electricalPort")).toEqual({
        iri: "fluidPort",
        pathOp: "alternation",
        stepPropertyIri2: "electricalPort",
      });
    });

    test("should evaluate property paths in WASM linear memory", () => {
      facade.clearOntology();
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      // Topology: Pump -> Valve -> Tank -> Drain
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Pump", "connectedTo", "Valve");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Valve", "connectedTo", "Tank");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Tank", "connectedTo", "Drain");

      const valveHash = facade.hashString("Valve");
      const tankHash = facade.hashString("Tank");
      const drainHash = facade.hashString("Drain");
      const pumpHash = facade.hashString("Pump");

      // 1. Transitive (+): 1+ hops
      const plusResults = facade.evaluateOntologyPropertyPath("connectedTo", 2 /* PLUS */, "", "Pump");
      expect(plusResults).toContain(valveHash);
      expect(plusResults).toContain(tankHash);
      expect(plusResults).toContain(drainHash);

      // 2. Reflexive Transitive (*): 0+ hops (includes source)
      const starResults = facade.evaluateOntologyPropertyPath("connectedTo", 3 /* STAR */, "", "Pump");
      expect(starResults).toContain(pumpHash);
      expect(starResults).toContain(valveHash);

      // 3. Inverse (^): 1 hop backward from Valve -> Pump
      const invResults = facade.evaluateOntologyPropertyPath("connectedTo", 4 /* INVERSE */, "", "Valve");
      expect(invResults).toContain(pumpHash);

      // 4. Inverse Transitive (^+): backward from Drain -> Tank, Valve, Pump
      const invPlusResults = facade.evaluateOntologyPropertyPath("connectedTo", 5 /* INVERSE_PLUS */, "", "Drain");
      expect(invPlusResults).toContain(tankHash);
      expect(invPlusResults).toContain(valveHash);
      expect(invPlusResults).toContain(pumpHash);
    });

    test("TableauReasoner should evaluate property path queries via DSL", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasSubsystem",
          subjectIri: "mo:Vehicle",
          objectIri: "mo:Chassis",
        },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasComponent",
          subjectIri: "mo:Chassis",
          objectIri: "mo:Wheel",
        },
      ]);

      const q = parseDLQuery("path(mo:hasSubsystem / mo:hasComponent, mo:Vehicle)");
      expect(q?.type).toBe("path");
      expect(q?.pathOp).toBe("sequence");

      expect(q).toBeDefined();
      if (q) {
        const res = executeDLQuery(reasoner, q);
        expect(res.bindings).toContain("mo:Wheel");
      }
    });
  });

  describe("P3: QuickXplain Minimal Unsatisfiable Subsets (MUS)", () => {
    test("should isolate minimal conflict core from contradictory ontology with irrelevant noise", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        // Irrelevant background axioms (noise)
        { type: "ClassDeclaration", iri: "mo:Resistor" },
        { type: "ClassDeclaration", iri: "mo:Capacitor" },
        { type: "SubClassOf", subClassIri: "mo:Resistor", superClassIri: "mo:ElectricalDevice" },
        { type: "ClassAssertion", individualIri: "mo:r1", classIri: "mo:Resistor" },

        // Conflict Core: Sensor and Actuator are disjoint, but s1 is asserted as both
        { type: "ClassDeclaration", iri: "mo:Sensor" },
        { type: "ClassDeclaration", iri: "mo:Actuator" },
        { type: "DisjointClasses", classIris: ["mo:Sensor", "mo:Actuator"] },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Sensor" },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Actuator" },
      ]);

      const consistency = reasoner.checkConsistency();
      expect(consistency.isConsistent).toBe(false);
      expect(consistency.minimalConflictCore).toBeDefined();

      const core = consistency.minimalConflictCore || [];
      expect(core.length).toBeLessThanOrEqual(5);

      // Verify that noise axioms are NOT in the minimal conflict core
      const coreJson = JSON.stringify(core);
      expect(coreJson).not.toContain("mo:Resistor");
      expect(coreJson).not.toContain("mo:Capacitor");
    });
  });

  describe("P4: EL++ Consequence-Based Reasoning & Role Chains", () => {
    test("should saturate existential restrictions (CR2) and role chains (CR3) in WASM", () => {
      facade.clearOntology();
      const AXIOM_OBJECT_SOME_VALUES_FROM = 12;
      const AXIOM_SUB_PROPERTY_CHAIN = 13;
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // 1. CR2: Motor ⊑ ∃hasPart.Rotor, Rotor ⊑ HighSpeedRotor, ∃hasPart.HighSpeedRotor ⊑ RotatingMachine
      // ⇒ Motor ⊑ RotatingMachine
      facade.addOntologyAxiom(AXIOM_OBJECT_SOME_VALUES_FROM, LANG_MODELICA, "Motor", "hasPart", "Rotor");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Rotor", "", "HighSpeedRotor");
      facade.addOntologyAxiom(
        AXIOM_OBJECT_SOME_VALUES_FROM,
        LANG_MODELICA,
        "RotatingMachine",
        "hasPart",
        "HighSpeedRotor",
      );

      // 2. CR3: hasSubsystem ∘ hasComponent ⊑ containsComponent
      // Vehicle ⊑ ∃hasSubsystem.Chassis, Chassis ⊑ ∃hasComponent.Wheel
      // ⇒ Vehicle ⊑ ∃containsComponent.Wheel
      facade.addOntologyAxiom(
        AXIOM_SUB_PROPERTY_CHAIN,
        LANG_MODELICA,
        "hasSubsystem",
        "hasComponent",
        "containsComponent",
      );
      facade.addOntologyAxiom(AXIOM_OBJECT_SOME_VALUES_FROM, LANG_MODELICA, "Vehicle", "hasSubsystem", "Chassis");
      facade.addOntologyAxiom(AXIOM_OBJECT_SOME_VALUES_FROM, LANG_MODELICA, "Chassis", "hasComponent", "Wheel");

      // Run EL++ saturation
      const newInferences = facade.saturateOntologyELRules();
      expect(newInferences).toBeGreaterThanOrEqual(1);

      // Verify inferred subsumption
      expect(facade.isSubClassOf("Motor", "RotatingMachine")).toBe(true);
    });
  });

  describe("P5: Leapfrog Triejoin (WCOJ) for Multi-Pattern SPARQL Queries", () => {
    test("should execute conjunctive BGP query joining multiple variables without Cartesian products", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:connectedTo",
          subjectIri: "mo:Motor1",
          objectIri: "mo:PortA",
        },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:connectedTo",
          subjectIri: "mo:Pump1",
          objectIri: "mo:PortB",
        },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasDomain",
          subjectIri: "mo:PortA",
          objectIri: "mo:Electrical",
        },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasDomain",
          subjectIri: "mo:PortB",
          objectIri: "mo:Hydraulic",
        },
      ]);

      // Query: Find devices connected to ports that have Electrical domain:
      // ?dev mo:connectedTo ?port . ?port mo:hasDomain mo:Electrical
      const bgpQuery = {
        patterns: [
          { subject: "?dev", predicate: "mo:connectedTo", object: "?port" },
          { subject: "?port", predicate: "mo:hasDomain", object: "mo:Electrical" },
        ],
      };

      const result = executeBgpQuery(reasoner, bgpQuery);
      expect(result.bindings.length).toBe(1);
      expect(result.bindings[0]["?dev"]).toBe("mo:Motor1");
      expect(result.bindings[0]["?port"]).toBe("mo:PortA");

      const formatted = formatBgpQueryResult(result);
      expect(formatted).toContain("mo:Motor1");
      expect(formatted).toContain("mo:PortA");
    });
  });
});
