import assert from "node:assert";
import { describe, it } from "node:test";
import { GenericModelicaBridge } from "../../../languages/sysml2/transformers/generic-modelica-bridge.js";
import { ParameterInversionEngine, RomLoadPipeline } from "../../../packages/cad/src/index.js";
import { ThreadDiagnosticsProvider } from "../../../packages/lsp/src/providers/threadDiagnosticsProvider.js";
import {
  DigitalThreadHypergraph,
  PolyglotTransformer,
  ProvenanceGraph,
  ReqIfParser,
  ThreadDomain,
  ThreadSerializer,
  VCycleVerifier,
} from "../src/index.js";

describe("Complete Cyber-Physical Digital Thread Implementation Suite", () => {
  // ── Pillar 1: Thread Fabric & Hypergraph Integration ──────────────────────
  describe("Pillar 1: Thread Fabric & Hypergraph Integration", () => {
    it("should manage multi-way alignments in linear-memory DigitalThreadHypergraph", () => {
      const hg = new DigitalThreadHypergraph();
      const slot = hg.createThread(101, 1);
      assert.strictEqual(slot, 0);

      // Bind domains
      hg.bindDomainNode(slot, ThreadDomain.SysML2, 201);
      hg.bindDomainNode(slot, ThreadDomain.Modelica, 301);
      hg.bindDomainNode(slot, ThreadDomain.CAD, 401);
      hg.bindDomainNode(slot, ThreadDomain.Requirements, 501);

      // Verify domain retrieval
      assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.SysML2), 201);
      assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Modelica), 301);
      assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.CAD), 401);
      assert.strictEqual(hg.getDomainNode(slot, ThreadDomain.Requirements), 501);

      // Reverse lookup
      assert.strictEqual(hg.findThreadByDomainNode(ThreadDomain.Modelica, 301), 101);
      assert.strictEqual(hg.findThreadByDomainNode(ThreadDomain.CAD, 401), 101);

      // Staleness & Conflict Lifecycle
      assert.strictEqual(hg.isStale(slot), false);
      hg.markStale(slot);
      assert.strictEqual(hg.isStale(slot), true);
      hg.clearStale(slot);
      assert.strictEqual(hg.isStale(slot), false);

      hg.markConflict(slot);
      assert.strictEqual(hg.isConflicted(slot), true);
      hg.clearConflict(slot);
      assert.strictEqual(hg.isConflicted(slot), false);

      const record = hg.getRecord(slot);
      assert.ok(record);
      assert.strictEqual(record?.threadId, 101);
      assert.strictEqual(record?.domainNodes[ThreadDomain.Modelica], 301);
    });

    it("should serialize and deserialize threads to W3C JSON-LD (.ms-thread)", () => {
      const hg = new DigitalThreadHypergraph();
      const s1 = hg.createThread(500, 2);
      hg.bindDomainNode(s1, ThreadDomain.SysML2, 10);
      hg.bindDomainNode(s1, ThreadDomain.Modelica, 20);
      hg.bindDomainNode(s1, ThreadDomain.CAD, 30);
      hg.markStale(s1);

      const jsonStr = ThreadSerializer.serialize(hg, { project: "DroneSystem" });
      assert.ok(jsonStr.includes("DroneSystem"));
      assert.ok(jsonStr.includes("ms:DigitalThreadCollection"));
      assert.ok(jsonStr.includes("stale"));

      const restored = ThreadSerializer.deserialize(jsonStr);
      assert.strictEqual(restored.getThreadCount(), 1);
      const slot = restored.findSlotByThreadId(500);
      assert.notStrictEqual(slot, undefined);
      assert.strictEqual(restored.getDomainNode(slot!, ThreadDomain.Modelica), 20);
      assert.strictEqual(restored.isStale(slot!), true);
    });

    it("should synchronize PolyglotTransformer with internal hypergraph", () => {
      const transformer = new PolyglotTransformer();
      transformer.registerThread("THREAD-EV-99", {
        sysml: { name: "Inverter", id: 1001 },
        modelica: { name: "Inverter", id: 1002 },
        cad: { name: "Inverter_CAD", id: 1003 },
      });

      const hg = transformer.getHypergraph();
      assert.strictEqual(hg.getThreadCount(), 1);
      const thread = transformer.getThread("THREAD-EV-99");
      assert.ok(thread);
      assert.strictEqual(thread?.sysml?.name, "Inverter");
    });
  });

  // ── Pillar 2: Requirements & Modelica <-> SysML v2 ────────────────────────
  describe("Pillar 2: Requirements & Modelica <-> SysML v2", () => {
    it("should parse OMG ReqIF XML and generate SysML v2 requirements", () => {
      const sampleReqIf = `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF>
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="hdr">
      <TITLE>Powertrain Safety Requirements</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-TORQUE-01" LONG-NAME="Launch Torque Requirement">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="Description">
              <THE-VALUE>Peak torque must exceed 350.0 Nm during launch</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-STRING ATTRIBUTE-DEFINITION="ASIL">
              <THE-VALUE>ASIL-D</THE-VALUE>
            </ATTRIBUTE-VALUE-STRING>
            <ATTRIBUTE-VALUE-REAL ATTRIBUTE-DEFINITION="LimitValue">
              <THE-VALUE>350.0</THE-VALUE>
            </ATTRIBUTE-VALUE-REAL>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`;

      const spec = ReqIfParser.parse(sampleReqIf);
      assert.strictEqual(spec.title, "Powertrain Safety Requirements");
      assert.strictEqual(spec.requirements.length, 1);
      const req = spec.requirements[0];
      assert.strictEqual(req.id, "REQ-TORQUE-01");
      assert.strictEqual(req.limitValue, 350.0);
      assert.strictEqual(req.comparator, ">");
      assert.strictEqual(req.asilLevel, "ASIL-D");

      // Test round-trip XML emission
      const emittedXml = ReqIfParser.emit(spec);
      assert.ok(emittedXml.includes("<REQ-IF"));
      assert.ok(emittedXml.includes("REQ-TORQUE-01"));

      // Test SysML v2 generation
      const sysml = ReqIfParser.toSysML2(spec);
      assert.ok(sysml.includes("package PowertrainSafetyRequirements"));
      assert.ok(sysml.includes("requirement def REQ_TORQUE_01"));
      assert.ok(sysml.includes("attribute limitValue : Real = 350;"));
      assert.ok(sysml.includes('attribute asil : String = "ASIL-D";'));
    });

    it("should bidirectionally translate between SysML v2 part def and Modelica model", () => {
      const sysmlDef = {
        name: "ElectricMotor",
        kind: "part def" as const,
        attributes: [
          { name: "R", type: "Real", defaultValue: 0.5, isParameter: true },
          { name: "L", type: "Real", defaultValue: 0.001, isParameter: true },
        ],
        ports: [
          { name: "p", type: "Pin" },
          { name: "n", type: "Pin" },
          { name: "flange", type: "Flange" },
        ],
        connections: [{ source: "p", target: "internal_resistor.p" }],
        constraints: ["v = p.v - n.v"],
      };

      // 1. SysML v2 -> Modelica
      const modelicaCode = GenericModelicaBridge.emitModelica(sysmlDef);
      assert.ok(modelicaCode.includes("model ElectricMotor"));
      assert.ok(modelicaCode.includes("parameter Real R = 0.5;"));
      assert.ok(modelicaCode.includes("Modelica.Electrical.Analog.Interfaces.Pin p;"));
      assert.ok(modelicaCode.includes("connect(p, internal_resistor.p);"));
      assert.ok(modelicaCode.includes("v = p.v - n.v;"));

      // 2. Modelica -> SysML v2
      const parsedSysml = GenericModelicaBridge.parseModelicaToSysML2(modelicaCode);
      assert.strictEqual(parsedSysml.name, "ElectricMotor");
      assert.strictEqual(parsedSysml.attributes.find((a) => a.name === "R")?.defaultValue, "0.5");
      assert.strictEqual(parsedSysml.connections.length, 1);
    });

    it("should execute closed-loop V-cycle verification against simulation trajectory", () => {
      const simulation = {
        t: [0.0, 0.5, 1.0, 1.5, 2.0],
        states: ["motor.tau", "motor.speed"],
        y: [
          [0.0, 200.0, 365.0, 370.0, 350.0], // peak = 370.0 (satisfies >= 350.0)
          [0.0, 100.0, 200.0, 300.0, 350.0],
        ],
      };

      const requirements = [
        {
          requirementId: "REQ-01",
          name: "LaunchTorque",
          constrainedVariable: "motor.tau",
          operator: ">=" as const,
          limitValue: 350.0,
        },
        {
          requirementId: "REQ-02",
          name: "MaxSpeed",
          constrainedVariable: "motor.speed",
          operator: "<=" as const,
          limitValue: 250.0, // violated: peak is 350.0
        },
      ];

      const verdicts = VCycleVerifier.verifyRequirements(requirements, simulation);
      assert.strictEqual(verdicts.length, 2);

      const v1 = verdicts[0];
      assert.strictEqual(v1.status, "Verified");
      assert.strictEqual(v1.peakValue, 370.0);
      assert.strictEqual(v1.isSatisfied, true);
      assert.ok(v1.marginPercent > 0);

      const v2 = verdicts[1];
      assert.strictEqual(v2.status, "Violated");
      assert.strictEqual(v2.isSatisfied, false);

      const backAnnotation = VCycleVerifier.generateSysML2BackAnnotation(verdicts);
      assert.ok(backAnnotation.includes("[PASSED] Requirement REQ-01"));
      assert.ok(backAnnotation.includes("[FAILED] Requirement REQ-02"));
    });
  });

  // ── Pillar 3: CAD / CAE Multiphysics Loop ──────────────────────────────────
  describe("Pillar 3: CAD / CAE Multiphysics Loop", () => {
    it("should invert parameters and patch procedural MCAD source code", () => {
      const originalMcad = `
const ARM_LENGTH = 7.0;
const ARM_WIDTH = 1.6;
const BODY_WIDTH = 10;
`;
      const { updatedSource, appliedUpdates } = ParameterInversionEngine.patchMcadSource(originalMcad, {
        ARM_LENGTH: 8.45,
        ARM_WIDTH: 2.0,
      });

      assert.strictEqual(appliedUpdates.length, 2);
      assert.strictEqual(appliedUpdates[0].parameterName, "ARM_LENGTH");
      assert.strictEqual(appliedUpdates[0].previousValue, 7.0);
      assert.strictEqual(appliedUpdates[0].newValue, 8.45);

      assert.ok(updatedSource.includes("const ARM_LENGTH = 8.45;"));
      assert.ok(updatedSource.includes("const ARM_WIDTH = 2;"));

      // Target mass inversion
      const solvedLength = ParameterInversionEngine.solveLengthForMass(1.5, 2700, 0.02, 0.01);
      assert.ok(solvedLength > 0);
    });

    it("should extract transient peak loads and generate boundary FEA deck and ROM block", () => {
      const trajectory = {
        t: [0.0, 0.1, 0.2, 0.3],
        states: ["chassis.flange_a.f", "motor.thrust"],
        y: [
          [0.0, 5.2, 14.8, 12.0], // peak = 14.8
          [0.0, 10.0, 20.0, 15.0], // peak = 20.0
        ],
      };

      const loads = RomLoadPipeline.extractPeakTransientLoads(trajectory);
      assert.strictEqual(loads.length, 2);
      assert.strictEqual(loads[0].peakMagnitude, 14.8);
      assert.strictEqual(loads[0].timeOfPeak, 0.2);

      const conditions = RomLoadPipeline.distributeLoadOverFasteners(20.0, 4);
      assert.strictEqual(conditions.length, 4);
      assert.strictEqual(conditions[0].appliedForce[1], 5.0);

      const deck = RomLoadPipeline.generateCalculixDeck("DroneArm", conditions);
      assert.ok(deck.includes("*HEADING"));
      assert.ok(deck.includes("*CLOAD"));
      assert.ok(deck.includes("mount_hole_1, 2, 5.00"));

      const romBlock = RomLoadPipeline.generateModelicaRomBlock(
        "AeroDragSurrogate",
        ["airspeed", "angle_of_attack"],
        ["drag_force", "lift_force"],
        "surrogate_rom.wasm",
      );
      assert.ok(romBlock.includes("block AeroDragSurrogate"));
      assert.ok(romBlock.includes("input Real airspeed"));
      assert.ok(romBlock.includes('__modelscript_rom(type="surrogate_fmu", file="surrogate_rom.wasm")'));
    });
  });

  // ── Pillar 4: Governance & Provenance (W3C PROV-O) ────────────────────────
  describe("Pillar 4: Governance & Provenance (W3C PROV-O)", () => {
    it("should build causal provenance graphs and serialize to W3C PROV-O JSON-LD", () => {
      const prov = new ProvenanceGraph();

      // Add agents
      prov.addAgent({ id: "engineer:omar", type: "Person", name: "Omar" });
      prov.addAgent({ id: "tool:modelscript", type: "SoftwareAgent", name: "ModelScript Compiler v1.2" });

      // Add entities
      const hReq = ProvenanceGraph.hashContent("MaxTorque >= 350");
      const hSysml = ProvenanceGraph.hashContent("part def Powertrain { attribute torque = 350; }");
      const hSim = ProvenanceGraph.hashContent("trajectory: t=[0,1], y=[0,370]");

      prov.addEntity({ id: "req:torque_01", type: "Requirement", contentHash: hReq });
      prov.addEntity({ id: "model:sysml_powertrain", type: "SysMLPartDef", contentHash: hSysml });
      prov.addEntity({ id: "data:sim_trajectory", type: "SimulationResult", contentHash: hSim });
      prov.addEntity({
        id: "verdict:pass",
        type: "VerificationVerdict",
        attributes: { status: "Verified", peakValue: 370.0 },
      });

      // Record activities
      prov.recordActivity(
        "act:simulation_run_1",
        "NumericalSimulation",
        "tool:modelscript",
        ["model:sysml_powertrain"],
        ["data:sim_trajectory"],
        { solver: "DOPRI5", tolerance: 1e-6 },
      );

      prov.recordActivity(
        "act:verification_check",
        "RequirementVerification",
        "engineer:omar",
        ["req:torque_01", "data:sim_trajectory"],
        ["verdict:pass"],
      );

      // Verify lineage chain
      const lineage = prov.verifyLineage("verdict:pass");
      assert.strictEqual(lineage.isValid, true);
      assert.ok(lineage.chain.includes("verdict:pass"));
      assert.ok(lineage.rootEntities.includes("req:torque_01"));

      // JSON-LD serialization
      const jsonLd = prov.toJsonLd();
      assert.ok(jsonLd.includes("http://www.w3.org/ns/prov#"));
      assert.ok(jsonLd.includes("prov:Agent"));
      assert.ok(jsonLd.includes("prov:Activity"));
      assert.ok(jsonLd.includes("prov:wasDerivedFrom"));
      assert.ok(jsonLd.includes(hReq));
    });
  });

  // ── Pillar 5: Cross-Domain Diagnostics ────────────────────────────────────
  describe("Pillar 5: Cross-Domain Diagnostics", () => {
    it("should detect CAD vs Modelica mass divergence and unverified requirements", () => {
      const elements = [
        {
          domain: "modelica",
          name: "Chassis",
          line: 14,
          column: 5,
          properties: { mass: 1.0 }, // 1.0 kg
        },
        {
          domain: "cad",
          name: "Chassis_Assembly",
          line: 1,
          column: 1,
          properties: { mass: 1.35 }, // 1.35 kg -> 35% divergence
        },
        {
          domain: "requirements",
          name: "REQ-01",
          status: "unverified" as const,
        },
        {
          domain: "sysml2",
          name: "Powertrain",
          status: "stale" as const,
        },
      ];

      const diagnostics = ThreadDiagnosticsProvider.diagnoseThread("THREAD-EV-001", elements, 0.05);
      assert.strictEqual(diagnostics.length, 3);

      const massDiag = diagnostics.find((d) => d.message.includes("Mass divergence"));
      assert.ok(massDiag);
      assert.strictEqual(massDiag?.severity, "warning");
      assert.strictEqual(massDiag?.line, 14);

      const reqDiag = diagnostics.find((d) => d.message.includes("lacks an automated dynamic simulation"));
      assert.ok(reqDiag);

      const staleDiag = diagnostics.find((d) => d.message.includes("is stale"));
      assert.ok(staleDiag);
    });
  });
});
