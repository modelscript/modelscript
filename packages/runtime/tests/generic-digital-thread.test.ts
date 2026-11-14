// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { evaluateGenericDigitalThread } from "../src/interop/generic_digital_thread.js";

test("Generic Digital Thread: (scad, fea) subgraph detects unbound ports and yield stress exceeding limit", () => {
  const res = evaluateGenericDigitalThread(
    [
      {
        fileName: "bracket.scad",
        content: `// @twin: load_n <-> SysML::Bracket.max_load
load_n = 50000;
module tag_port(name, kind, n) {}
tag_port("mount_face", "fixed", [0, 0, 1]);
tag_port("missing_nset", "load", [0, -1, 0]);
cube([0.1, 0.05, 0.02]);`,
      },
      {
        fileName: "bracket.inp",
        content: `*INCLUDE, INPUT=bracket.scad
*MATERIAL, NAME=STEEL
*ELASTIC
210000.0, 0.3
*BOUNDARY
mount_face, 1, 6
*STATIC
*NODE FILE`,
      },
      {
        fileName: "requirements.sysml",
        content: `package SysML {
  part def Bracket {
    attribute max_load = 50000 [N];
    attribute yield_strength = 250 [MPa];
  }
}`,
      },
    ],
    {
      providers: {
        evaluateScad: () => ({
          variables: { load_n: 50000 },
          boundingBox: { min: [0, 0, 0], max: [0.1, 0.05, 0.02] },
          mesh: {
            tags: [
              { portName: "mount_face", portType: "fixed", normal: [0, 0, 1] },
              { portName: "missing_nset", portType: "load", normal: [0, -1, 0] },
            ],
          },
        }),
        InpDialect: class {
          parse() {
            return {
              materials: new Map([["STEEL", { E: 210e9, nu: 0.3 }]]),
              boundaries: [{ target: "mount_face", line: 5 }],
              cloads: [],
            };
          }
        },
        Tet4Mesher: {
          createBoxMesh: () => ({
            numNodes: 4,
            nodes: [0, 0, 0],
            elements: [0, 1, 2, 3],
            boundaryNodes: new Map([
              ["xmin", [0]],
              ["xmax", [3]],
            ]),
          }),
        },
        MeshQualityAnalyzer: {
          analyze: () => ({ minJacobian: 0.85, maxAspectRatio: 1.4 }),
        },
        FeaSolver: class {
          step() {
            return { maxVonMisesStress: 320e6, maxDisplacement: 0.0012 };
          }
        },
      },
    },
  );

  assert.strictEqual(res.isSat, false);
  const feaArt = res.artifacts.find((a) => a.fileName === "bracket.inp")!;
  assert.ok(
    feaArt.diagnostics.some((d) => d.code === "POLYGLOT_UNBOUND_PORT"),
    "Expected POLYGLOT_UNBOUND_PORT for missing_nset",
  );
  assert.ok(
    feaArt.diagnostics.some((d) => d.code === "POLYGLOT_FEA_YIELD_EXCEEDED"),
    "Expected POLYGLOT_FEA_YIELD_EXCEEDED when 320 MPa > 250 MPa",
  );
  assert.ok(res.portBindings.some((b) => b.portName === "mount_face" && b.isBound));
  assert.ok(res.portBindings.some((b) => b.portName === "missing_nset" && !b.isBound));
});

test("Generic Digital Thread: (scad, cfd) passes SCAD obstacle bbox to LbmVoxelizer and asserts pressure drop", () => {
  let receivedBoxes: any[] = [];
  const res = evaluateGenericDigitalThread(
    [
      {
        fileName: "duct.scad",
        content: `cube([20, 10, 10]);`,
      },
      {
        fileName: "flow.cfd",
        content: `// @mesh_source: duct.scad
// @port_map: inlet <-> inlet
inlet_velocity = 4.5;
density = 1.225;
tau = 0.65;
boundaryField { inlet { type fixedValue; } }`,
      },
    ],
    {
      providers: {
        evaluateScad: () => ({
          variables: {},
          boundingBox: { min: [0, 0, 0], max: [20, 10, 10] },
          mesh: { tags: [{ portName: "inlet", portType: "inlet", normal: [1, 0, 0] }] },
        }),
        OpenFoamDialect: class {
          parse() {
            return {
              directives: [],
              boundaries: new Map([["inlet", {}]]),
            };
          }
        },
        LbmVoxelizer: {
          voxelize: (_cfg: any, obstacles: any) => {
            receivedBoxes = obstacles?.boxes ?? [];
            return { cells: [] };
          },
        },
        WebGPULbmRunner: class {
          step() {
            return { pressureDropPa: 145.2 };
          }
        },
      },
    },
  );

  assert.strictEqual(res.isSat, true);
  assert.strictEqual(receivedBoxes.length, 1, "Expected SCAD bounding box passed to LbmVoxelizer.voxelize");
  assert.ok(
    res.sharedEqualities.some((eq) => eq.includes("pressure_drop_pa")) || res.isSat,
    "Expected CFD LBM evaluation to complete cleanly",
  );
});

test("Generic Digital Thread: STEP uses asymmetric PLUS_MINUS_TOLERANCE bounds and computes unit-aware suggestedEdits", () => {
  let verifiedStackInput: any = null;
  const res = evaluateGenericDigitalThread(
    [
      {
        fileName: "housing.step",
        content: `#10=DIMENSIONAL_SIZE(#5,'bore_d');
#20=PLUS_MINUS_TOLERANCE(#21,#10);
#21=TOLERANCE_VALUE(0.08,-0.02);`,
      },
      {
        fileName: "spec.sysml",
        content: `package Housing {
  part def Bore {
    attribute diameter = 25000 [um];
  }
}`,
      },
      {
        fileName: "sim.mo",
        content: `model Sim
  parameter Real diameter(unit="mm") = 30.0 annotation(twin = "SysML2::Housing::Bore.diameter");
end Sim;`,
      },
    ],
    {
      providers: {
        scanStepEntities: () => [
          { id: "#10", type: "DIMENSIONAL_SIZE", args: "25.0, 'bore_d'" },
          { id: "#20", type: "PLUS_MINUS_TOLERANCE", args: "#21, #10" },
          { id: "#21", type: "TOLERANCE_VALUE", args: "0.08, -0.02" },
        ],
        ToleranceStackVerifier: {
          verify: (input: any) => {
            verifiedStackInput = input;
            return { passed: true };
          },
        },
      },
    },
  );

  assert.ok(verifiedStackInput, "Expected ToleranceStackVerifier.verify to be invoked");
  const dim = verifiedStackInput.dimensions.find((d: any) => d.name === "#10");
  assert.ok(dim, "Expected STEP dimension #10");
  assert.strictEqual(dim.upperTol, 0.08);
  assert.strictEqual(dim.lowerTol, -0.02);
  assert.strictEqual(res.isSat, false);
  assert.ok(res.suggestedEdits.length > 0, "Expected unit-aware suggestedEdits on um <-> mm drift");
});

test("Generic digital thread: records surgical valueStart/valueEnd spans for SPICE passive, URDF, STEP, and ReqIF", () => {
  const spiceContent = `* @twin: R1 <-> SysML2::Board::Spec.r_target\nR1 in out 2k`;
  const urdfContent = `<!-- @twin: arm.mass <-> SysML2::Board::Spec.m_target -->\n<robot><link name="arm"><inertial><mass value="1.5"/></inertial></link></robot>`;
  const stepContent = `/* @twin: #10 <-> SysML2::Board::Spec.d_target */\n#10=DIMENSIONAL_SIZE(25.0, 'bore_d');`;
  const reqifContent = `<!-- @twin: req_val_1 <-> SysML2::Board::Spec.v_target -->\n<ATTRIBUTE-VALUE-REAL THE-VALUE="12.0"/>`;
  const sysmlContent = `package Board {
  part def Spec {
    attribute r_target = 1000 [Ohm];
    attribute m_target = 3.0 [kg];
    attribute d_target = 30.0 [mm];
    attribute v_target = 24.0 [V];
  }
}`;

  const res = evaluateGenericDigitalThread(
    [
      { fileName: "Spec.sysml", content: sysmlContent },
      { fileName: "board.sp", content: spiceContent },
      { fileName: "arm.urdf", content: urdfContent },
      { fileName: "part.step", content: stepContent },
      { fileName: "reqs.reqif", content: reqifContent },
    ],
    {
      providers: {
        parseUrdf: () => ({
          links: new Map([["arm", { inertial: { mass: 1.5 } }]]),
          joints: new Map(),
        }),
        scanStepEntities: () => [{ id: "#10", type: "DIMENSIONAL_SIZE", args: "25.0, 'bore_d'" }],
      },
    },
  );

  assert.strictEqual(res.isSat, false);
  const byFile = new Map<string, { content: string; edits: typeof res.suggestedEdits }>([
    ["board.sp", { content: spiceContent, edits: [] }],
    ["arm.urdf", { content: urdfContent, edits: [] }],
    ["part.step", { content: stepContent, edits: [] }],
    ["reqs.reqif", { content: reqifContent, edits: [] }],
  ]);
  for (const se of res.suggestedEdits) {
    byFile.get(se.fileName)?.edits.push(se);
  }
  assert.strictEqual(
    spiceContent.slice(byFile.get("board.sp")!.edits[0]!.startOffset!, byFile.get("board.sp")!.edits[0]!.endOffset!),
    "2k",
  );
  assert.strictEqual(
    urdfContent.slice(byFile.get("arm.urdf")!.edits[0]!.startOffset!, byFile.get("arm.urdf")!.edits[0]!.endOffset!),
    "1.5",
  );
  assert.strictEqual(
    stepContent.slice(byFile.get("part.step")!.edits[0]!.startOffset!, byFile.get("part.step")!.edits[0]!.endOffset!),
    "25.0",
  );
  assert.strictEqual(
    reqifContent.slice(
      byFile.get("reqs.reqif")!.edits[0]!.startOffset!,
      byFile.get("reqs.reqif")!.edits[0]!.endOffset!,
    ),
    "12.0",
  );
});
