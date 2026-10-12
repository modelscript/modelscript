// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerCodeLensProvider } from "../src/providers/codeLensProvider.js";
import { ValidationService } from "../src/services/validation-service.js";
import { WorkspaceManager } from "../src/services/workspace-manager.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str), `Expected ${val} to contain ${str}`),
  toBeGreaterThan: (n: number) => assert.ok(val > n),
});

describe("Multi-Domain Drone Reachability: LSP CodeLens & Lint Verification", () => {
  const moCode = `model DroneSimulation "Drone flight dynamics linked to SysML v2, CAD, FEA, and CFD"
  parameter Real m = 1.2 "Total mass [kg] (FEA structural oracle)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalMass");
  parameter Real A = 0.03 "Frontal area [m²] (CAD procedural geometry)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalFrontalArea");
  parameter Real Cd = 0.80 "Drag coefficient (CFD surface pressure simulation)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.aeroDragCoeff");
  parameter Real rho = 1.225 "Air density [kg/m³]";
  parameter Real z_target = 11.0 "Ceiling altitude setpoint [m]";
  parameter Real kz = 3.1 "Altitude feedback gain [N/m]";
  parameter Real kv = 1.35 "Velocity damping gain [N/(m/s)]";
  Real z(start = 0.0, fixed = true) "Altitude [m]";
  Real v(start = 0.0, fixed = true) "Vertical climb velocity [m/s]";
  input Real w(min = -0.50, max = 0.50, start = 0.0) "Wind gust disturbance force in [-w_max, w_max] [N]";
equation
  der(z) = v;
  der(v) = (kz * (z_target - z) - kv * v - 0.5 * Cd * rho * A * v * abs(v) + w) / m;
end DroneSimulation;
`;

  const sysmlCode = `package DroneReachabilitySystem {
  part def DroneAssembly {
    attribute totalMass : Real = 1.20;
    attribute totalFrontalArea : Real = 0.030;
    attribute aeroDragCoeff : Real = 0.80;
  }
  requirement def FlightCeilingRequirement {
    attribute v_climb : Real;
    attribute v_climb_max : Real = 12.0;
    require constraint { v_climb <= v_climb_max }
  }
  verification def FlightReachabilityVerification {
    verify FlightCeilingRequirement;
  }
}
`;

  const scadCode = `// Drone Procedural Airframe
arm_thickness = 4.2;
tag_port("fixed_hub", "fixed_support", [0, 0, 1]) {
  cylinder(r = 35, h = 28, center = true);
}
tag_port("rotor_stream", "fluid_inlet", [0, 0, -1]) {
  cylinder(r = 65, h = 25, center = true);
}
`;

  const feaCode = `*HEADING
ModelScript Drone Chassis Carbon-Composite Arm Stress
*SOLID SECTION, ELSET=ECHASSIS, MATERIAL=CARBON_EPOXY
*STEP, PERTURBATION
*STATIC
*CLOAD
5, 3, 8.500
*END STEP
`;

  const cfdCode = `SOLVER= INC_RANS
REF_LENGTH= 0.360
REF_AREA= 0.030
MARKER_INLET= ( rotor_stream, 293.15, 12.0, 0.0, 0.0, -1.0 )
`;

  const stepCode = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ModelScript B-Rep Solid'),'2;1');
ENDSEC;
DATA;
#10=SHAPE_REPRESENTATION('',(#11),#12);
ENDSEC;
END-ISO-10303-21;
`;

  it("1. CodeLens: generates rich multi-domain actions across all 6 artifact types", () => {
    let capturedHandler: any = null;
    const mockConnection: any = {
      onRequest: (method: string, handler: any) => {
        if (method === "textDocument/codeLens") {
          capturedHandler = handler;
        }
      },
    };

    const docMap = new Map<string, TextDocument>();
    docMap.set(
      "file:///workspace/cad/drone.scad",
      TextDocument.create("file:///workspace/cad/drone.scad", "scad", 1, scadCode),
    );
    docMap.set(
      "file:///workspace/cad/drone.step",
      TextDocument.create("file:///workspace/cad/drone.step", "step", 1, stepCode),
    );
    docMap.set(
      "file:///workspace/cae/drone_chassis.inp",
      TextDocument.create("file:///workspace/cae/drone_chassis.inp", "fea", 1, feaCode),
    );
    docMap.set(
      "file:///workspace/cae/drone_aero.cfg",
      TextDocument.create("file:///workspace/cae/drone_aero.cfg", "cfd", 1, cfdCode),
    );
    docMap.set(
      "file:///workspace/modelica/DroneSimulation.mo",
      TextDocument.create("file:///workspace/modelica/DroneSimulation.mo", "modelica", 1, moCode),
    );
    docMap.set(
      "file:///workspace/sysml/drone_specs.sysml",
      TextDocument.create("file:///workspace/sysml/drone_specs.sysml", "sysml2", 1, sysmlCode),
    );

    const mockContext: any = {
      connection: mockConnection,
      documents: { get: (uri: string) => docMap.get(uri) },
      workspaceManager: new WorkspaceManager(),
      validationService: {
        modelicaProofResultsByUri: new Map(),
        modelicaDaeVerificationResultsByUri: new Map(),
      },
    };

    registerCodeLensProvider(mockContext);
    expect(capturedHandler).toBeDefined();

    // 1.1 Modelica CodeLens
    const moLenses = capturedHandler({ textDocument: { uri: "file:///workspace/modelica/DroneSimulation.mo" } });
    expect(moLenses.length).toBeGreaterThan(3);
    const moTitles = moLenses.map((l: any) => l.command.title);
    expect(
      moTitles.some((t: string) => t.includes("Estimate Reachability Envelope") && t.includes("non-rigorous")),
    ).toBe(true);
    expect(moTitles.some((t: string) => /\b11\.42\b/.test(t))).toBe(false);
    expect(moTitles.some((t: string) => t.includes("Simulate Model"))).toBe(true);
    expect(moTitles.some((t: string) => t.includes("Digital Thread Parity: m = 1.20 kg"))).toBe(true);
    expect(moTitles.some((t: string) => t.includes("Aerodynamic Twin: Cd = 0.80"))).toBe(true);

    // 1.2 SysML v2 CodeLens
    const sysmlLenses = capturedHandler({ textDocument: { uri: "file:///workspace/sysml/drone_specs.sysml" } });
    expect(sysmlLenses.length).toBeGreaterThan(3);
    const sysmlTitles = sysmlLenses.map((l: any) => l.command.title);
    expect(sysmlTitles.some((t: string) => t.includes("5 Domains Linked"))).toBe(true);
    expect(sysmlTitles.some((t: string) => t.includes("Estimate Requirement Reachability"))).toBe(true);
    expect(sysmlTitles.some((t: string) => t.includes("Requirement SAT"))).toBe(false);
    expect(sysmlTitles.some((t: string) => t.includes("Nelson-Oppen / Salsa"))).toBe(true);

    // 1.3 OpenSCAD CodeLens
    const scadLenses = capturedHandler({ textDocument: { uri: "file:///workspace/cad/drone.scad" } });
    expect(scadLenses.length).toBeGreaterThan(4);
    const scadTitles = scadLenses.map((l: any) => l.command.title);
    expect(scadTitles.some((t: string) => t.includes("Frontal Area: A = 0.030 m²"))).toBe(true);
    expect(scadTitles.some((t: string) => t.includes("Compile to STEP CAD"))).toBe(true);
    expect(scadTitles.some((t: string) => t.includes("FEA Mesh"))).toBe(true);
    expect(scadTitles.some((t: string) => t.includes("CFD Mesh"))).toBe(true);
    expect(scadTitles.some((t: string) => t.includes("fixed_hub"))).toBe(true);

    // 1.4 FEA CodeLens
    const feaLenses = capturedHandler({ textDocument: { uri: "file:///workspace/cae/drone_chassis.inp" } });
    expect(feaLenses.length).toBeGreaterThan(2);
    const feaTitles = feaLenses.map((l: any) => l.command.title);
    expect(feaTitles.some((t: string) => t.includes("FEA Structural Invariant") && t.includes("172.4 MPa"))).toBe(true);
    expect(feaTitles.some((t: string) => t.includes("Calibrated Mass: m = 1.20 kg"))).toBe(true);

    // 1.5 CFD CodeLens
    const cfdLenses = capturedHandler({ textDocument: { uri: "file:///workspace/cae/drone_aero.cfg" } });
    expect(cfdLenses.length).toBeGreaterThan(1);
    const cfdTitles = cfdLenses.map((l: any) => l.command.title);
    expect(cfdTitles.some((t: string) => t.includes("CFD Aerodynamics: Cd = 0.80"))).toBe(true);
    expect(cfdTitles.some((t: string) => t.includes("Parity Check: Ref Area matches OpenSCAD"))).toBe(true);

    // 1.6 STEP CAD CodeLens
    const stepLenses = capturedHandler({ textDocument: { uri: "file:///workspace/cad/drone.step" } });
    expect(stepLenses.length).toBeGreaterThan(2);
    const stepTitles = stepLenses.map((l: any) => l.command.title);
    expect(stepTitles.some((t: string) => t.includes("3D B-Rep Solid Geometry"))).toBe(true);
  });

  it("2. Lints & Diagnostics: checks cross-domain drift, SAT margins, and structural limits", async () => {
    const sentDiags = new Map<string, any[]>();
    const mockConnection: any = {
      console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiags.set(params.uri, params.diagnostics);
      },
      sendNotification: () => {},
    };

    const wm = new WorkspaceManager();
    const mockDocManager: any = {
      documents: new Map(),
      documentTrees: new Map(),
    };
    const mockParserService: any = {
      getSharedCstTreeWrapper: () => null,
      facade: null,
      sharedContext: null,
    };

    const vs = new ValidationService(mockConnection, mockDocManager, wm, mockParserService);

    // 2.1 Modelica validation (nominal mass m = 1.2)
    const moNominalDoc = TextDocument.create("file:///workspace/modelica/DroneSimulation.mo", "modelica", 1, moCode);
    await vs.runUnifiedSemanticPipeline({
      uri: moNominalDoc.uri,
      text: moCode,
      tree: { rootNode: { text: moCode } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "modelica",
      textDocument: moNominalDoc,
    });
    const moNominalDiags = sentDiags.get(moNominalDoc.uri) || [];
    // Reachability verdicts must never be produced by text matching
    expect(moNominalDiags.some((d: any) => d.source === "modelscript-reachability")).toBe(false);
    expect(moNominalDiags.some((d: any) => d.message.includes("Digital Thread In Parity"))).toBe(true);

    // 2.2 Modelica validation (drifted mass m = 1.50)
    const driftedMoCode = moCode.replace("Real m = 1.2", "Real m = 1.5");
    const moDriftDoc = TextDocument.create(
      "file:///workspace/modelica/DroneSimulation.mo",
      "modelica",
      2,
      driftedMoCode,
    );
    await vs.runUnifiedSemanticPipeline({
      uri: moDriftDoc.uri,
      text: driftedMoCode,
      tree: { rootNode: { text: driftedMoCode } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "modelica",
      textDocument: moDriftDoc,
    });
    const moDriftDiags = sentDiags.get(moDriftDoc.uri) || [];
    const driftDiag = moDriftDiags.find((d: any) => d.message.includes("Digital Thread Drift"));
    expect(driftDiag).toBeDefined();
    expect(driftDiag.severity).toBe(DiagnosticSeverity.Warning);
    expect(driftDiag.message).toContain("drifts from FEA calibrated structural mass (1.20 kg)");

    // 2.3 SysML v2 validation (nominal v_climb_max = 12.0)
    const sysmlNominalDoc = TextDocument.create("file:///workspace/sysml/drone_specs.sysml", "sysml2", 1, sysmlCode);
    await vs.runUnifiedSemanticPipeline({
      uri: sysmlNominalDoc.uri,
      text: sysmlCode,
      tree: { rootNode: { text: sysmlCode } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "sysml2",
      textDocument: sysmlNominalDoc,
    });
    const sysmlNominalDiags = sentDiags.get(sysmlNominalDoc.uri) || [];
    expect(sysmlNominalDiags.some((d: any) => d.source === "modelscript-reachability")).toBe(false);
    expect(sysmlNominalDiags.some((d: any) => d.message.includes("Multi-Domain Digital Thread"))).toBe(true);

    // 2.4 SysML v2 validation (violating v_climb_max = 10.0)
    const violatingSysmlCode = sysmlCode.replace("v_climb_max : Real = 12.0", "v_climb_max : Real = 10.0");
    const sysmlViolatingDoc = TextDocument.create(
      "file:///workspace/sysml/drone_specs.sysml",
      "sysml2",
      2,
      violatingSysmlCode,
    );
    await vs.runUnifiedSemanticPipeline({
      uri: sysmlViolatingDoc.uri,
      text: violatingSysmlCode,
      tree: { rootNode: { text: violatingSysmlCode } },
      baseDiagnostics: [],
      revisionAtStart: null,
      langId: "sysml2",
      textDocument: sysmlViolatingDoc,
    });
    const sysmlViolatingDiags = sentDiags.get(sysmlViolatingDoc.uri) || [];
    // Lowering the limit must not produce a fabricated UNSAT verdict either
    expect(sysmlViolatingDiags.some((d: any) => d.source === "modelscript-reachability")).toBe(false);

    // 2.5 OpenSCAD validation (nominal vs thin arm)
    const scadDoc = TextDocument.create("file:///workspace/cad/drone.scad", "scad", 1, scadCode);
    await vs.validateTextDocument(scadDoc);
    const scadDiags = sentDiags.get(scadDoc.uri) || [];
    expect(
      scadDiags.some((d: any) => d.message.includes("Digital Thread CAD Port") && d.message.includes("fixed_hub")),
    ).toBe(true);
    expect(scadDiags.some((d: any) => d.message.includes("Structural Feasibility Verified"))).toBe(true);

    const thinScadCode = scadCode.replace("arm_thickness = 4.2;", "arm_thickness = 3.2;");
    const thinScadDoc = TextDocument.create("file:///workspace/cad/drone.scad", "scad", 2, thinScadCode);
    await vs.validateTextDocument(thinScadDoc);
    const thinScadDiags = sentDiags.get(thinScadDoc.uri) || [];
    const thinDiag = thinScadDiags.find((d: any) => d.message.includes("Structural Feasibility Warning"));
    expect(thinDiag).toBeDefined();
    expect(thinDiag.severity).toBe(DiagnosticSeverity.Warning);

    // 2.6 FEA Deck validation
    const feaDoc = TextDocument.create("file:///workspace/cae/drone_chassis.inp", "fea", 1, feaCode);
    await vs.validateTextDocument(feaDoc);
    const feaDiags = sentDiags.get(feaDoc.uri) || [];
    expect(
      feaDiags.some((d: any) => d.message.includes("FEA Structural Invariant") && d.message.includes("172.4 MPa")),
    ).toBe(true);

    // 2.7 CFD Config validation
    const cfdDoc = TextDocument.create("file:///workspace/cae/drone_aero.cfg", "cfd", 1, cfdCode);
    await vs.validateTextDocument(cfdDoc);
    const cfdDiags = sentDiags.get(cfdDoc.uri) || [];
    expect(cfdDiags.some((d: any) => d.message.includes("CFD Aerodynamic Polar") && d.message.includes("0.8000"))).toBe(
      true,
    );
  });
});
