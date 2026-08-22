import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";
import {
  executeBatchQueries,
  executeQueryString,
  formatQueryResult,
  OntologyBuilder,
  parseDLQuery,
  TableauReasoner,
} from "../src/reasoner/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDsl = language({
  name: "ReasonerFullTestLang",
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

describe("Complete Reasoner Feature Suite (WASM + TypeScript)", () => {
  const tmpDir = path.join(__dirname, "scratch_build_reasoner_complete");
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
    childProcess.execSync(ascCmd, { stdio: "inherit" });

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

  describe("Tier 1: WASM Linear Memory Reasoner Kernel", () => {
    test("should extract subsumption justification trail in WASM memory", () => {
      facade.clearOntology();
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "InductionMotor", "", "Motor");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Motor", "", "ElectricalDevice");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ElectricalDevice", "", "Device");

      const pathAxioms = facade.explainSubsumption("InductionMotor", "Device");
      expect(pathAxioms.length).toBe(3);
      expect(pathAxioms[0].subjectHash).toBe(facade.hashString("InductionMotor"));
      expect(pathAxioms[0].objectHash).toBe(facade.hashString("Motor"));
      expect(pathAxioms[2].objectHash).toBe(facade.hashString("Device"));
    });

    test("should audit global consistency and identify conflicting axioms in WASM", () => {
      facade.clearOntology();
      const AXIOM_SUBCLASS_OF = 2;
      const AXIOM_DISJOINT_CLASSES = 4;
      const AXIOM_CLASS_ASSERT = 11;
      const LANG_MODELICA = 1;

      // 1. Assert Disjoint: Sensor and Actuator
      facade.addOntologyAxiom(AXIOM_DISJOINT_CLASSES, LANG_MODELICA, "Sensor", "", "Actuator");

      // Consistent initially
      let result = facade.checkConsistency();
      expect(result.isConsistent).toBe(true);
      expect(result.conflictingAxioms.length).toBe(0);

      // 2. Introduce Subsumption conflict: SmartSensor SubClassOf Sensor AND SmartSensor SubClassOf Actuator
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "SmartSensor", "", "Sensor");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "SmartSensor", "", "Actuator");

      result = facade.checkConsistency();
      expect(result.isConsistent).toBe(false);
      expect(result.conflictingAxioms.length).toBeGreaterThanOrEqual(1);

      // 3. Introduce Individual assertion conflict: deviceX is both Sensor and Actuator
      facade.clearOntology();
      facade.addOntologyAxiom(AXIOM_DISJOINT_CLASSES, LANG_MODELICA, "Sensor", "", "Actuator");
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "deviceX", "", "Sensor");
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "deviceX", "", "Actuator");

      result = facade.checkConsistency();
      expect(result.isConsistent).toBe(false);
      expect(result.conflictingAxioms.length).toBe(1);
      expect(result.conflictingAxioms[0].subjectHash).toBe(facade.hashString("deviceX"));
    });

    test("should classify individuals and distinguish direct vs transitive types in WASM", () => {
      facade.clearOntology();
      const AXIOM_CLASS_ASSERT = 11;
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // DC_Motor -> Motor -> Device
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "DC_Motor", "", "Motor");
      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Motor", "", "Device");

      // Assert m1 : DC_Motor
      facade.addOntologyAxiom(AXIOM_CLASS_ASSERT, LANG_MODELICA, "m1", "", "DC_Motor");

      const classification = facade.classifyIndividual("m1");
      const dcMotorHash = facade.hashString("DC_Motor");
      const motorHash = facade.hashString("Motor");
      const deviceHash = facade.hashString("Device");

      expect(classification.directTypes).toContain(dcMotorHash);
      expect(classification.directTypes).not.toContain(motorHash);
      expect(classification.directTypes).not.toContain(deviceHash);

      expect(classification.allTypes).toContain(dcMotorHash);
      expect(classification.allTypes).toContain(motorHash);
      expect(classification.allTypes).toContain(deviceHash);
    });

    test("should compute transitive property closure with path edges in WASM", () => {
      facade.clearOntology();
      const AXIOM_OBJ_PROP_ASSERT = 7;
      const LANG_MODELICA = 1;

      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Pump", "connectedTo", "Valve");
      facade.addOntologyAxiom(AXIOM_OBJ_PROP_ASSERT, LANG_MODELICA, "Valve", "connectedTo", "Tank");

      const res = facade.getTransitiveClosureWithPath("connectedTo", "Pump");
      const valveHash = facade.hashString("Valve");
      const tankHash = facade.hashString("Tank");

      expect(res.reachable).toContain(valveHash);
      expect(res.reachable).toContain(tankHash);
      expect(res.path.length).toBe(2);
      expect(res.path[0]).toEqual({ subject: facade.hashString("Pump"), object: valveHash });
      expect(res.path[1]).toEqual({ subject: valveHash, object: tankHash });
    });

    test("should extract taxonomy nodes from WASM ontology", () => {
      facade.clearOntology();
      const AXIOM_SUBCLASS_OF = 2;
      const AXIOM_EQUIV_CLASS = 3;
      const LANG_MODELICA = 1;

      facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "Car", "", "Vehicle");
      facade.addOntologyAxiom(AXIOM_EQUIV_CLASS, LANG_MODELICA, "Automobile", "", "Car");

      const taxonomy = facade.getTaxonomy();
      expect(taxonomy.length).toBeGreaterThanOrEqual(3);

      const carNode = taxonomy.find((n: any) => n.classHash === facade.hashString("Car"));
      expect(carNode).toBeDefined();
      expect(carNode.directSuperClasses).toContain(facade.hashString("Vehicle"));
      expect(carNode.equivalentClasses).toContain(facade.hashString("Automobile"));
    });
  });

  describe("Tier 2: High-Level TypeScript Reasoner & SPARQL-DL Engine", () => {
    test("TableauReasoner should support subsumption, taxonomy, and justification paths", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "ClassDeclaration", iri: "mo:Motor" },
        { type: "ClassDeclaration", iri: "mo:ElectricalDevice" },
        { type: "ClassDeclaration", iri: "mo:Device" },
        { type: "SubClassOf", subClassIri: "mo:Motor", superClassIri: "mo:ElectricalDevice" },
        { type: "SubClassOf", subClassIri: "mo:ElectricalDevice", superClassIri: "mo:Device" },
      ]);

      const subResult = reasoner.isSubClassOf("mo:Motor", "mo:Device");
      expect(subResult.holds).toBe(true);
      expect(subResult.justification).toBeDefined();
      expect(subResult.justification?.length).toBe(2);

      const taxonomy = reasoner.getTaxonomy();
      const motorNode = taxonomy.find((t) => t.iri === "mo:Motor");
      expect(motorNode?.directSuperClasses).toContain("mo:ElectricalDevice");
    });

    test("TableauReasoner should check consistency and detect conflicting axioms", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "ClassDeclaration", iri: "mo:Sensor" },
        { type: "ClassDeclaration", iri: "mo:Actuator" },
        { type: "DisjointClasses", classIris: ["mo:Sensor", "mo:Actuator"] },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Sensor" },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Actuator" },
      ]);

      const consistency = reasoner.checkConsistency();
      expect(consistency.isConsistent).toBe(false);
      expect(consistency.conflictingAxioms?.length).toBe(1);
    });

    test("SPARQL-DL parser and query executor should execute DSL queries", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "ClassDeclaration", iri: "mo:Motor" },
        { type: "ClassDeclaration", iri: "mo:ElectricalDevice" },
        { type: "SubClassOf", subClassIri: "mo:Motor", superClassIri: "mo:ElectricalDevice" },
        { type: "ClassAssertion", individualIri: "mo:m1", classIri: "mo:Motor" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:connectedTo", subjectIri: "mo:m1", objectIri: "mo:m2" },
      ]);

      // 1. parseDLQuery
      const q1 = parseDLQuery("instances(mo:Motor)");
      expect(q1).toEqual({ type: "instances", iri: "mo:Motor", fromIri: undefined });

      const q2 = parseDLQuery("reachable(mo:connectedTo, mo:m1)");
      expect(q2).toEqual({ type: "reachable", iri: "mo:connectedTo", fromIri: "mo:m1" });

      // 2. executeQueryString
      const res1 = executeQueryString(reasoner, "instances(mo:Motor)");
      expect(res1?.bindings).toContain("mo:m1");

      const res2 = executeQueryString(reasoner, "subclasses(mo:ElectricalDevice)");
      expect(res2?.bindings).toContain("mo:Motor");

      const res3 = executeQueryString(reasoner, "reachable(mo:connectedTo, mo:m1)");
      expect(res3?.bindings).toContain("mo:m2");

      // 3. formatQueryResult
      expect(res1).toBeDefined();
      if (res1) {
        const formatted = formatQueryResult(res1);
        expect(formatted).toContain("Query: instances(mo:Motor)");
        expect(formatted).toContain("mo:m1");
      }

      // 4. executeBatchQueries
      expect(q1).toBeDefined();
      expect(q2).toBeDefined();
      if (q1 && q2) {
        const batchRes = executeBatchQueries(reasoner, [q1, q2]);
        expect(batchRes.length).toBe(2);
      }
    });

    test("OntologyBuilder should handle delta streaming and event subscriptions", async () => {
      const reasoner = new TableauReasoner();
      const mockStore: any = {
        size: 1,
        axioms: [{ type: "ClassDeclaration", iri: "mo:Battery" }],
      };

      const events: any[] = [];
      const builder = new OntologyBuilder(reasoner, mockStore, { debounceMs: 50, autoClassify: true });
      builder.on((e) => events.push(e));

      await builder.initialize();
      expect(events.some((e) => e.type === "status-changed")).toBe(true);

      builder.applyDelta({
        retractions: [],
        assertions: [
          { type: "ClassDeclaration", iri: "mo:PowerSource" },
          { type: "SubClassOf", subClassIri: "mo:Battery", superClassIri: "mo:PowerSource" },
        ],
      });

      // Wait for debounced flush
      await new Promise((r) => setTimeout(r, 100));

      expect(reasoner.isSubClassOf("mo:Battery", "mo:PowerSource").holds).toBe(true);
      expect(events.some((e) => e.type === "delta-applied")).toBe(true);
      expect(events.some((e) => e.type === "classified")).toBe(true);

      builder.dispose();
    });
  });
});
