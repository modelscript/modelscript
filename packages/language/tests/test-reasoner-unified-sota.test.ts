// SPDX-License-Identifier: AGPL-3.0-or-later
import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildParser } from "../src/api.js";
import { field, language, repeat, semanticToken, seq } from "../src/dsl.js";
import { executeDLQuery, parseDLQuery, TableauReasoner } from "../src/reasoner/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testDsl = language({
  name: "ReasonerUnifiedSotaTestLang",
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

describe("Unified SOTA Semantic Reasoner (4-Part Roadmap)", () => {
  const tmpDir = path.join(__dirname, "scratch_build_reasoner_unified_sota");
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
    // keep tmpDir for inspection if needed
  });

  // --------------------------------------------------------------------------
  // Part 1: DRed (Delete/Rederive) Incremental Maintenance
  // --------------------------------------------------------------------------
  describe("Part 1: DRed (Delete/Rederive) Incremental Maintenance", () => {
    test("should retract axiom and preserve alternative derivation paths in WASM", () => {
      facade.clearOntology();
      const AXIOM_SUBCLASS_OF = 2;
      const LANG_MODELICA = 1;

      // Two paths from A to D:
      // Path 1: A -> B -> C -> D
      // Path 2: A -> E -> D
      const ax1 = facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ClassA", "", "ClassB");
      const ax2 = facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ClassB", "", "ClassC");
      const ax3 = facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ClassC", "", "ClassD");

      const ax4 = facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ClassA", "", "ClassE");
      const ax5 = facade.addOntologyAxiom(AXIOM_SUBCLASS_OF, LANG_MODELICA, "ClassE", "", "ClassD");

      const res1 = facade.isSubClassOf("ClassA", "ClassC");
      const res2 = facade.isSubClassOf("ClassA", "ClassD");
      expect(res1).toBe(true);
      expect(res2).toBe(true);

      // Retract B -> C via delta
      facade.applyOntologyDelta(
        [],
        [{ axiomType: AXIOM_SUBCLASS_OF, subject: "ClassB", predicate: "", object: "ClassC" }],
      );

      // Path 1 consequence (A -> C) must be over-deleted and gone
      expect(facade.isSubClassOf("ClassA", "ClassC")).toBe(false);
      // Path 2 consequence (A -> D) must be preserved via Rederivation through E!
      expect(facade.isSubClassOf("ClassA", "ClassD")).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Part 2: Functional & Max-1 Cardinality Constraints (ELF)
  // --------------------------------------------------------------------------
  describe("Part 2: ELF Functional Properties & Individual Equivalence", () => {
    test("should merge individuals under functional properties and detect disjointness conflicts", () => {
      const reasoner = new TableauReasoner();
      const axioms: any[] = [
        { type: "FunctionalObjectProperty", propertyIri: "mo:hasPowerSource" },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasPowerSource",
          subjectIri: "mo:M1",
          objectIri: "mo:Battery1",
        },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "mo:hasPowerSource",
          subjectIri: "mo:M1",
          objectIri: "mo:Battery2",
        },
        { type: "ClassDeclaration", iri: "mo:LithiumBattery" },
        { type: "ClassDeclaration", iri: "mo:LeadAcidBattery" },
        { type: "DisjointClasses", classIris: ["mo:LithiumBattery", "mo:LeadAcidBattery"] },
        { type: "ClassAssertion", individualIri: "mo:Battery1", classIri: "mo:LithiumBattery" },
        { type: "ClassAssertion", individualIri: "mo:Battery2", classIri: "mo:LeadAcidBattery" },
      ];

      reasoner.loadOntology(axioms);
      const consistency = reasoner.checkConsistency();
      expect(consistency.isConsistent).toBe(false);
      expect(consistency.minimalConflictCore).toBeDefined();

      const core = consistency.minimalConflictCore || [];
      const coreJson = JSON.stringify(core);
      expect(coreJson).toContain("mo:hasPowerSource");
      expect(coreJson).toContain("mo:Battery1");
      expect(coreJson).toContain("mo:Battery2");
    });
  });

  // --------------------------------------------------------------------------
  // Part 3: All-MUS Multi-Conflict Extraction (Reiter's HST)
  // --------------------------------------------------------------------------
  describe("Part 3: All-MUS Multi-Conflict Isolation via Reiter's Hitting Set Tree", () => {
    test("should isolate multiple orthogonal minimal conflict cores simultaneously", () => {
      const reasoner = new TableauReasoner();
      const axioms: any[] = [
        // Irrelevant background noise
        { type: "ClassDeclaration", iri: "mo:Resistor" },
        { type: "ClassDeclaration", iri: "mo:Capacitor" },
        { type: "SubClassOf", subClassIri: "mo:Resistor", superClassIri: "mo:ElectricalDevice" },
        { type: "ClassAssertion", individualIri: "mo:r1", classIri: "mo:Resistor" },

        // Conflict 1: Sensor ⊓ Actuator ⊑ ⊥, s1 is asserted as both
        { type: "ClassDeclaration", iri: "mo:Sensor" },
        { type: "ClassDeclaration", iri: "mo:Actuator" },
        { type: "DisjointClasses", classIris: ["mo:Sensor", "mo:Actuator"] },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Sensor" },
        { type: "ClassAssertion", individualIri: "mo:s1", classIri: "mo:Actuator" },

        // Conflict 2: ACSource ⊓ DCSource ⊑ ⊥, p1 is asserted as both
        { type: "ClassDeclaration", iri: "mo:ACSource" },
        { type: "ClassDeclaration", iri: "mo:DCSource" },
        { type: "DisjointClasses", classIris: ["mo:ACSource", "mo:DCSource"] },
        { type: "ClassAssertion", individualIri: "mo:p1", classIri: "mo:ACSource" },
        { type: "ClassAssertion", individualIri: "mo:p1", classIri: "mo:DCSource" },
      ];

      reasoner.loadOntology(axioms);
      const consistency = reasoner.checkConsistency();
      expect(consistency.isConsistent).toBe(false);

      const allCores = reasoner.allMus(8);
      expect(allCores.length).toBeGreaterThanOrEqual(2);

      const core1Json = JSON.stringify(allCores[0]);
      const core2Json = JSON.stringify(allCores[1]);

      // Verify that Core 1 and Core 2 isolate their respective orthogonal conflict sets
      const hasSensorConflict =
        (core1Json.includes("mo:Sensor") && core1Json.includes("mo:Actuator")) ||
        (core2Json.includes("mo:Sensor") && core2Json.includes("mo:Actuator"));
      const hasSourceConflict =
        (core1Json.includes("mo:ACSource") && core1Json.includes("mo:DCSource")) ||
        (core2Json.includes("mo:ACSource") && core2Json.includes("mo:DCSource"));

      expect(hasSensorConflict).toBe(true);
      expect(hasSourceConflict).toBe(true);

      // Verify noise axioms do NOT contaminate either core
      expect(core1Json.includes("mo:Resistor")).toBe(false);
      expect(core2Json.includes("mo:Resistor")).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Part 4: Unified TypeScript SDK Facade & Full API Parity
  // --------------------------------------------------------------------------
  describe("Part 4: Unified TypeScript SDK Facade & Full API Parity", () => {
    test("TableauReasoner should evaluate taxonomy, property chains, and DL queries", () => {
      const reasoner = new TableauReasoner();
      reasoner.loadOntology([
        { type: "ClassDeclaration", iri: "mo:Component" },
        { type: "ClassDeclaration", iri: "mo:ElectricalComponent" },
        { type: "SubClassOf", subClassIri: "mo:ElectricalComponent", superClassIri: "mo:Component" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:connectedTo", subjectIri: "mo:R1", objectIri: "mo:C1" },
        { type: "ObjectPropertyAssertion", propertyIri: "mo:connectedTo", subjectIri: "mo:C1", objectIri: "mo:GND" },
        { type: "ClassAssertion", individualIri: "mo:R1", classIri: "mo:ElectricalComponent" },
      ]);

      const sub = reasoner.isSubClassOf("mo:ElectricalComponent", "mo:Component");
      expect(sub.holds).toBe(true);

      const taxonomy = reasoner.getTaxonomy();
      expect(taxonomy.length).toBeGreaterThanOrEqual(2);

      const classification = reasoner.classifyIndividual("mo:R1");
      expect(classification.allTypes).toContain("mo:Component");

      const closure = reasoner.getTransitiveClosure("mo:connectedTo", "mo:R1");
      expect(closure.reachable).toContain("mo:C1");
      expect(closure.reachable).toContain("mo:GND");

      const dlQ = parseDLQuery("subclasses(mo:Component)");
      if (dlQ) {
        const dlRes = executeDLQuery(reasoner, dlQ);
        expect(dlRes.bindings).toContain("mo:ElectricalComponent");
      }
    });
  });
});
