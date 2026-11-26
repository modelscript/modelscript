// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeLaminateABD, StepMesher } from "@modelscript/simulate";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import type { CadStudyWizardConfig, StudyArchetypeId } from "../src/workbench/cad-viewer/CadStudyWizardModal.js";
import {
  computeCfrpLaminateSummary,
  computeYPlusMetrics,
  createDefaultCaePhysicsConfig,
  serializePhysicsToDeckDirectives,
} from "../src/workbench/cad-viewer/CaePhysicsInspector.js";
import { extractTemplateParameters } from "../src/workbench/cad-viewer/SweepConfigDrawer.js";
import {
  exportCaeToCgnsJson,
  runAdjointSensitivityStudy,
  runLocalCfdStudy,
  runLocalFeaStudy,
  runMeshHealCheck,
} from "../src/workbench/util/cae-local-runner.js";

// Stub .css imports pulled in transitively by @primer/react when loading CadStudyWizardModal.tsx in Node.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { computeWindTunnelBounds, generateStudyDeckFromCad } =
  await import("../src/workbench/cad-viewer/CadStudyWizardModal.js");

function makeWizardConfig(
  archetype: StudyArchetypeId,
  overrides: Partial<CadStudyWizardConfig> = {},
): CadStudyWizardConfig {
  return {
    archetype,
    cadArtifactName: "wing_bracket.step",
    cadArtifactUri: "file:///workspace/wing_bracket.step",
    detectedFaceTags: ["WING_SKIN", "ROOT_FLANGE", "TIP_CAP"],
    boundingBox: {
      min: [0, -0.5, -0.25],
      max: [2, 0.5, 0.25],
    },
    meshHealSummary: {
      isWatertight: true,
      boundaryEdges: 0,
      degenerateRemoved: 0,
      verticesWelded: 4,
      triangleCount: 1200,
    },
    domainMultipliers: {
      upstreamX: 3,
      downstreamX: 8,
      lateralY: 4,
      verticalZ: 4,
    },
    freestreamVelocity: 45,
    machNumber: 0.78,
    reynoldsNumber: 3.2e6,
    enableOctreeRefinement: true,
    octreeLevels: 3,
    elementOrder: "Tet10",
    meshDensity: "Moderate",
    materialPreset: archetype === "fea_composite_cfrp" ? "CFRP T300/5208" : "Ti-6Al-4V",
    fixedFaceTag: "ROOT_FLANGE",
    loadFaceTag: "TIP_CAP",
    loadMagnitudeN: 2500,
    ...overrides,
  };
}

describe("CadStudyWizardModal helpers", () => {
  it("computeWindTunnelBounds scales domain using longest CAD dimension and multipliers", () => {
    const bounds = computeWindTunnelBounds(
      { min: [0, -1, -0.5], max: [4, 1, 0.5] },
      { upstreamX: 2, downstreamX: 5, lateralY: 3, verticalZ: 2 },
    );
    // refLen = max(4, 2, 1) = 4
    assert.deepEqual(bounds.domainMin, [0 - 2 * 4, -1 - 3 * 4 * 0.5, -0.5 - 2 * 4 * 0.5]);
    assert.deepEqual(bounds.domainMax, [4 + 5 * 4, 1 + 3 * 4 * 0.5, 0.5 + 2 * 4 * 0.5]);

    const fallback = computeWindTunnelBounds(undefined, {
      upstreamX: 1,
      downstreamX: 2,
      lateralY: 2,
      verticalZ: 2,
    });
    assert.deepEqual(fallback.domainMin, [-1.5, -1.5, -1.5]);
    assert.deepEqual(fallback.domainMax, [2.5, 1.5, 1.5]);
  });

  const cfdArchetypes: Array<{ id: StudyArchetypeId; expectedTokens: string[] }> = [
    {
      id: "cfd_wmles_lbm",
      expectedTokens: ["SOLVER= INC_LBM_WMLES", "LBM_LATTICE= D3Q19", "LBM_WALL_TREATMENT= BOUZIDI_CURVED"],
    },
    {
      id: "cfd_octree_lbm",
      expectedTokens: ["SOLVER= INC_LBM_OCTREE", "AMR_OCTREE_RATIO= 2_TO_1", "AMR_MAX_LEVELS= 3"],
    },
    {
      id: "cfd_compressible_fvm",
      expectedTokens: [
        "SOLVER= RANS",
        "KIND_TURB_MODEL= SA_DDES",
        "CONV_NUM_METHOD_FLOW= HLLC",
        "LINEAR_SOLVER= FGMRES",
      ],
    },
    {
      id: "cfd_nodal_dg",
      expectedTokens: ["SOLVER= EULER_NODAL_DG", "DG_POLYNOMIAL_ORDER= {{dg_order}}", "DG_RIEMANN_FLUX= ROE"],
    },
    {
      id: "cfd_adjoint_opt",
      expectedTokens: [
        "MATH_PROBLEM= DISCRETE_ADJOINT",
        "ADJOINT_SENSITIVITY_METHOD= NILSS",
        "OBJECTIVE_FUNCTION= DRAG",
      ],
    },
    {
      id: "fsi_two_way",
      expectedTokens: [
        "MULTIPHYSICS= FSI_TWO_WAY",
        "FSI_COUPLING_SCHEME= VECTOR_AITKEN",
        "FSI_WET_INTERFACE= ( WING_SKIN, ROOT_FLANGE, TIP_CAP )",
        "FSI_FIXED_SURFACE= ROOT_FLANGE",
      ],
    },
  ];

  for (const { id, expectedTokens } of cfdArchetypes) {
    it(`generateStudyDeckFromCad generates .cfg deck for ${id} with preserved tags and {{param}} hooks`, () => {
      const res = generateStudyDeckFromCad(makeWizardConfig(id));
      assert.equal(res.dialect, "cfd");
      assert.ok(res.fileName.endsWith(".cfg"), `expected .cfg extension, got ${res.fileName}`);
      for (const token of expectedTokens) {
        assert.ok(res.content.includes(token), `missing token "${token}" for ${id}`);
      }
      // Preserved detected face tags
      assert.ok(res.content.includes("MARKER_MONITORING= ( WING_SKIN, ROOT_FLANGE, TIP_CAP )"));
      assert.deepEqual(res.studyOptions.detectedFaceTags, ["WING_SKIN", "ROOT_FLANGE", "TIP_CAP"]);
      // Parametric sweep hooks
      assert.ok(res.content.includes("{{mach_number}}"));
      assert.ok(res.content.includes("{{freestream_velocity}}"));
      assert.ok(res.content.includes("{{reynolds_number}}"));
      assert.ok(res.content.includes("{{aoa_deg}}"));
    });
  }

  const feaArchetypes: Array<{ id: StudyArchetypeId; expectedTokens: string[] }> = [
    {
      id: "fea_static_tet10",
      expectedTokens: ["*STEP, NLGEOM", "*STATIC", "{{youngs_modulus_pa}}", "{{load_magnitude_n}}", "C3D10"],
    },
    {
      id: "fea_transient_dyn",
      expectedTokens: ["*DAMPING, ALPHA=2.5, BETA=1.0E-5", "*DYNAMIC, ALPHA=-0.05", "{{load_magnitude_n}}"],
    },
    {
      id: "fea_composite_cfrp",
      expectedTokens: [
        "*ELASTIC, TYPE=ENGINEERING CONSTANTS",
        "*SHELL SECTION, COMPOSITE, ELSET=EALL",
        "{{load_magnitude_n}}",
      ],
    },
  ];

  for (const { id, expectedTokens } of feaArchetypes) {
    it(`generateStudyDeckFromCad generates .inp deck for ${id} with preserved face tag sets and {{param}} hooks`, () => {
      const res = generateStudyDeckFromCad(makeWizardConfig(id));
      assert.equal(res.dialect, "fea");
      assert.ok(res.fileName.endsWith(".inp"), `expected .inp extension, got ${res.fileName}`);
      for (const token of expectedTokens) {
        assert.ok(res.content.includes(token), `missing token "${token}" for ${id}`);
      }
      assert.ok(res.content.includes("*NSET, NSET=NS_WING_SKIN"));
      assert.ok(res.content.includes("*NSET, NSET=NS_ROOT_FLANGE"));
      assert.ok(res.content.includes("*NSET, NSET=NS_TIP_CAP"));
      assert.ok(res.content.includes("NS_ROOT_FLANGE, 1, 3, 0.0"));
      assert.ok(res.content.includes("NS_TIP_CAP, 3, {{load_magnitude_n}}"));
    });
  }

  it("appends expected extension when customFileName omits it", () => {
    const cfdRes = generateStudyDeckFromCad(makeWizardConfig("cfd_wmles_lbm", { customFileName: "my_custom_case" }));
    assert.equal(cfdRes.fileName, "my_custom_case.cfg");
    const feaRes = generateStudyDeckFromCad(makeWizardConfig("fea_static_tet10", { customFileName: "bracket_run" }));
    assert.equal(feaRes.fileName, "bracket_run.inp");
  });
});

describe("CaePhysicsInspector helpers", () => {
  it("createDefaultCaePhysicsConfig returns valid CFD 2030 and FEA defaults", () => {
    const cfg = createDefaultCaePhysicsConfig();
    assert.equal(cfg.cfd.solverFamily, "lbm-d3q19");
    assert.equal(cfg.cfd.bouzidiCurvedWalls, true);
    assert.equal(cfg.fea.elementOrder, "tet10");
    assert.equal(cfg.fea.kinematics, "corotational");
    assert.equal(cfg.fea.symmetricLayup, true);
  });

  it("serializePhysicsToDeckDirectives emits valid CFD 2030 and FEA directives", () => {
    const cfg = createDefaultCaePhysicsConfig();
    // CFD LBM + thermal
    cfg.cfd.solverFamily = "lbm-d3q19";
    cfg.cfd.turbulenceModel = "wmles-spalding";
    cfg.cfd.thermalBoussinesq = true;
    const cfdLbm = serializePhysicsToDeckDirectives("cfd", cfg);
    assert.ok(cfdLbm.includes("SOLVER= LBM_D3Q19_WEBGPU"));
    assert.ok(cfdLbm.includes("KIND_TURB_MODEL= WMLES_SPALDING"));
    assert.ok(cfdLbm.includes("BOUZIDI_CURVED_WALLS= YES"));
    assert.ok(cfdLbm.includes("THERMAL_MODEL= D3Q7_BOUSSINESQ"));

    // CFD Nodal DG
    cfg.cfd.solverFamily = "dg-nodal";
    cfg.cfd.dgOrder = 3;
    cfg.cfd.fluxScheme = "roe";
    const cfdDg = serializePhysicsToDeckDirectives("cfd", cfg);
    assert.ok(cfdDg.includes("SOLVER= NODAL_DG_COMPRESSIBLE"));
    assert.ok(cfdDg.includes("DG_POLY_ORDER= 3"));
    assert.ok(cfdDg.includes("CONV_NUM_METHOD_FLOW= ROE"));

    // FEA CFRP Laminate + corotational static
    const feaCfrp = serializePhysicsToDeckDirectives("fea", cfg);
    assert.ok(feaCfrp.includes("ELEMENT_ORDER=TET10"));
    assert.ok(feaCfrp.includes("KINEMATICS=COROTATIONAL"));
    assert.ok(feaCfrp.includes("*ELASTIC, TYPE=ENGINEERING CONSTANTS"));
    assert.ok(feaCfrp.includes("*STEP, NLGEOM"));
    assert.ok(feaCfrp.includes("*STATIC"));

    // FEA J2 Plasticity + transient Newmark
    cfg.fea.materialModel = "j2-plasticity";
    cfg.fea.analysisType = "transient-newmark";
    const feaDyn = serializePhysicsToDeckDirectives("fea", cfg);
    assert.ok(feaDyn.includes("*PLASTIC"));
    assert.ok(feaDyn.includes("*DYNAMIC, ALPHA=-0.05"));
  });

  it("computeYPlusMetrics returns physically accurate Re, Cf, u_tau, and dy1 > 0", () => {
    // Turbulent flat plate: U=30 m/s, L=1.0 m, nu=1.5e-5 m^2/s => Re = 2e6
    const turb = computeYPlusMetrics(30, 1.0, 1.5e-5, 1.0);
    assert.equal(turb.regime, "turbulent");
    assert.ok(Math.abs(turb.reynolds - 2e6) < 1e-6);
    assert.ok(turb.skinFrictionCf > 1e-3 && turb.skinFrictionCf < 1e-2, `unexpected Cf=${turb.skinFrictionCf}`);
    assert.ok(turb.uTau > 0.5 && turb.uTau < 3.0, `unexpected u_tau=${turb.uTau}`);
    assert.ok(turb.firstCellHeightM > 0 && turb.firstCellHeightM < 1e-3);
    assert.ok(Math.abs(turb.firstCellHeightMm - turb.firstCellHeightM * 1000) < 1e-9);

    // Laminar flow: U=1.0 m/s, L=0.5 m, nu=1.5e-5 => Re = 33333.3 < 5e5
    const lam = computeYPlusMetrics(1.0, 0.5, 1.5e-5, 1.0);
    assert.equal(lam.regime, "laminar");
    const expectedBlasiusCf = 0.664 / Math.sqrt(lam.reynolds);
    assert.ok(Math.abs(lam.skinFrictionCf - expectedBlasiusCf) < 1e-12);
    assert.ok(lam.firstCellHeightM > 0);
  });

  it("computeCfrpLaminateSummary & computeLaminateABD verify symmetric laminate has B ~ 0 and positive A11, D11", () => {
    const plyAngles = [0, 45, -45, 90];
    const summary = computeCfrpLaminateSummary(plyAngles, true, 0.125, 161000, 11380, 5170, 0.32);
    assert.equal(summary.totalPlies, 8);
    assert.equal(summary.stackupNotation, "[0/45/-45/90]s");
    assert.ok(Math.abs(summary.totalThicknessMm - 1.0) < 1e-9);
    assert.ok(summary.a11Nmm > 0);
    assert.ok(summary.a22Nmm > 0);
    assert.ok(summary.a66Nmm > 0);
    // Quasi-isotropic [0/45/-45/90]s layup should have Ex ≈ Ey
    assert.ok(Math.abs(summary.exMpa - summary.eyMpa) / summary.exMpa < 1e-6);

    // Full [A, B, D] stiffness verification from @modelscript/simulate
    const symAngles = [...plyAngles, ...[...plyAngles].reverse()];
    const abd = computeLaminateABD(
      symAngles.map((angleDeg) => ({
        angleDeg,
        thickness: 0.125e-3,
        E1: 161e9,
        E2: 11.38e9,
        G12: 5.17e9,
        nu12: 0.32,
      })),
    );
    let maxB = 0;
    for (let i = 0; i < abd.B.length; i++) {
      maxB = Math.max(maxB, Math.abs(abd.B[i]!));
    }
    assert.ok(maxB < 1e-6, `symmetric laminate coupling B should vanish, got max|B|=${maxB}`);
    assert.ok(abd.A[0]! > 0, `expected A11 > 0, got ${abd.A[0]}`);
    assert.ok(abd.D[0]! > 0, `expected D11 > 0, got ${abd.D[0]}`);
  });
});

describe("SweepConfigDrawer helpers", () => {
  it("extractTemplateParameters extracts {{mach}}, {{aoa}}, {{load_n}} without duplicates", () => {
    const deck = `
      MACH_NUMBER= {{mach}}
      AOA= {{ aoa }}
      REFINED_MACH= {{mach * 1.05 + sin(aoa) + pi}}
      *CLOAD
      NS_TIP, 3, {{load_n}}
      NS_TIP, 2, {{ 0.25 * load_n }}
    `;
    const params = extractTemplateParameters(deck);
    assert.deepEqual(params, ["mach", "aoa", "load_n"]);
    assert.deepEqual(extractTemplateParameters("SOLVER= RANS\nITER= 100\n"), []);
  });
});

describe("Local CFD 2030 & FEA runner (cae-local-runner.ts)", () => {
  it("runMeshHealCheck distinguishes watertight closed tetrahedron from open triangle", () => {
    // Closed regular-ish tetrahedron with consistent outward winding
    const tetVerts = new Float32Array([
      0,
      0,
      0, // 0
      1,
      0,
      0, // 1
      0,
      1,
      0, // 2
      0,
      0,
      1, // 3
    ]);
    const tetIndices = new Uint32Array([
      0,
      2,
      1, // z=0 face
      0,
      1,
      3, // y=0 face
      1,
      2,
      3, // slanted face
      0,
      3,
      2, // x=0 face
    ]);
    const closed = runMeshHealCheck(tetVerts, tetIndices);
    assert.equal(closed.isWatertight, true);
    assert.equal(closed.boundaryEdges, 0);
    assert.equal(closed.triangleCount, 4);

    // Single open triangle has 3 boundary edges
    const triVerts = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const triIndices = new Uint32Array([0, 1, 2]);
    const open = runMeshHealCheck(triVerts, triIndices);
    assert.equal(open.isWatertight, false);
    assert.ok(open.boundaryEdges > 0);
  });

  const sampleFeaInp = `
*HEADING
Cantilever Beam Verification
*NODE
1, 0.0, 0.0, 0.0
2, 0.2, 0.0, 0.0
3, 0.2, 0.1, 0.0
4, 0.0, 0.1, 0.0
5, 0.0, 0.0, 0.1
6, 0.2, 0.0, 0.1
7, 0.2, 0.1, 0.1
8, 0.0, 0.1, 0.1
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4, 5, 6, 7, 8
*NSET, NSET=FIXED
1, 4, 5, 8
*NSET, NSET=TIP
2, 3, 6, 7
*MATERIAL, NAME=AL6061
*ELASTIC
68.9e9, 0.33
*DENSITY
2700
*SOLID SECTION, ELSET=EALL, MATERIAL=AL6061
*STEP, NLGEOM
*STATIC
*BOUNDARY
FIXED, 1, 3, 0.0
*CLOAD
TIP, 3, -5000.0
*END STEP
`;

  it("runLocalFeaStudy solves Tet4 and Tet10 with corotational kinematics and real residuals", async () => {
    const tet4Res = await runLocalFeaStudy(sampleFeaInp, "fea-tet4", "Tet4 Corotational", undefined, {
      elementOrder: "tet4",
      corotational: true,
    });
    assert.equal(tet4Res.runEntry.status, "finished");
    assert.ok(tet4Res.runEntry.residuals.length >= 2);
    assert.ok(tet4Res.runEntry.residuals.every((r) => Number.isFinite(r) && r > 0));
    assert.ok(Number.isFinite(tet4Res.maxStressMpa) && tet4Res.maxStressMpa > 0);
    assert.ok(tet4Res.nodalVonMisesPa.length === 8);
    assert.ok(tet4Res.vtkBuffer.byteLength > 100);

    const tet10Res = await runLocalFeaStudy(sampleFeaInp, "fea-tet10", "Tet10 Corotational", undefined, {
      elementOrder: "tet10",
      corotational: true,
      preconditioner: "sa_amg",
    });
    assert.equal(tet10Res.runEntry.status, "finished");
    assert.ok(tet10Res.runEntry.residuals.length >= 2);
    assert.ok(tet10Res.runEntry.residuals.every((r) => Number.isFinite(r) && r > 0));
    assert.ok(Number.isFinite(tet10Res.maxStressMpa) && tet10Res.maxStressMpa > 0);
    assert.ok(tet10Res.nodalVonMisesPa.length > 8);
    assert.ok(
      tet10Res.runEntry.logLines.some((l) => l.includes("Promoted Tet4 mesh to quadratic Tet10")),
      "expected Tet10 promotion log line",
    );
    assert.ok(tet10Res.vtkBuffer.byteLength > 100);
  });

  const sampleCfdCfg = `
SOLVER= INC_LBM_WMLES
MACH_NUMBER= 0.72
FREESTREAM_VELOCITY= 25.0
FREESTREAM_PRESSURE= 101325.0
REYNOLDS_NUMBER= 1.5e6
`;

  it("runLocalCfdStudy executes LBM WMLES with flow features, Compressible FVM, and Nodal DG", async () => {
    const lbmRes = await runLocalCfdStudy(sampleCfdCfg, "cfd-lbm", "LBM WMLES", undefined, {
      solverFamily: "lbm",
      turbulenceModel: "wmles",
      computeFlowFeatures: true,
      steps: 8,
    });
    assert.equal(lbmRes.runEntry.status, "finished");
    assert.ok(lbmRes.runEntry.fields.includes("Q-Criterion"));
    assert.ok(lbmRes.runEntry.fields.includes("Lambda-2"));
    assert.ok(lbmRes.runEntry.fields.includes("Vorticity"));
    assert.ok(lbmRes.runEntry.fields.includes("Ducros Shock"));
    assert.ok(lbmRes.vtkBuffer.byteLength > 200);
    const lbmVtkText = new TextDecoder().decode(lbmRes.vtkBuffer);
    assert.ok(lbmVtkText.includes("<VTKFile"));
    assert.ok(lbmVtkText.includes('Name="Q-Criterion"'));

    const fvmRes = await runLocalCfdStudy(sampleCfdCfg, "cfd-fvm", "Compressible FVM", undefined, {
      solverFamily: "compressible_fvm",
      turbulenceModel: "ddes",
      fvmFlux: "hllc",
      computeFlowFeatures: true,
      steps: 4,
    });
    assert.equal(fvmRes.runEntry.status, "finished");
    assert.ok(fvmRes.runEntry.fields.includes("Mach"));
    assert.ok(fvmRes.runEntry.fields.includes("Q-Criterion"));
    assert.ok(fvmRes.runEntry.residuals.length === 4);
    assert.ok(fvmRes.runEntry.residuals.every((r) => Number.isFinite(r) && r > 0));
    assert.ok(fvmRes.vtkBuffer.byteLength > 200);

    const dgRes = await runLocalCfdStudy(sampleCfdCfg, "cfd-dg", "Compressible Nodal DG", undefined, {
      solverFamily: "compressible_dg",
      dgOrder: 2,
      fvmFlux: "hllc",
      steps: 4,
    });
    assert.equal(dgRes.runEntry.status, "finished");
    assert.ok(dgRes.runEntry.fields.includes("Mach"));
    assert.ok(dgRes.runEntry.residuals.length === 4);
    assert.ok(dgRes.runEntry.residuals.every((r) => Number.isFinite(r) && r > 0));
    assert.ok(dgRes.vtkBuffer.byteLength > 200);
  });

  it("runAdjointSensitivityStudy returns finite objectiveDragPower and sensitivityField", () => {
    const adj = runAdjointSensitivityStudy(sampleCfdCfg, {
      numSteps: 4,
      enableNilss: true,
      nilssSegments: 4,
    });
    assert.ok(Number.isFinite(adj.objectiveDragPower));
    assert.ok(Number.isFinite(adj.maxSensitivity) && adj.maxSensitivity >= 0);
    assert.equal(adj.sensitivityField.length, adj.nx * adj.ny * adj.nz);
    assert.ok(adj.sensitivityField.every((v) => Number.isFinite(v)));
    assert.ok(adj.nilssGradient !== undefined && Number.isFinite(adj.nilssGradient));
    assert.ok(adj.logs.length > 0);
  });

  it("exportCaeToCgnsJson returns a valid CGNS SIDS JSON tree", () => {
    const jsonStr = exportCaeToCgnsJson({
      baseName: "WingBase",
      zoneName: "FluidZone",
      zoneType: "Unstructured",
      nodeCoords: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      elements: new Uint32Array([0, 1, 2, 3]),
      elementType: "TETRA_4",
      fields: { Pressure: new Float32Array([101325, 101300, 101280, 101310]) },
      boundaryConditions: [{ name: "INLET", type: "BCInflow", nodeIndices: [0, 1] }],
      metadata: { solver: "ModelScript-CFD2030" },
    });
    const doc = JSON.parse(jsonStr) as {
      format: string;
      CGNSLibraryVersion: { label: string; data: number };
      bases: Array<{
        name: string;
        label: string;
        zones: Array<{
          name: string;
          label: string;
          children: Array<{ name: string; label: string; children?: Array<{ name: string; data?: unknown }> }>;
        }>;
      }>;
    };
    assert.equal(doc.format, "CGNS-SIDS-JSON");
    assert.equal(doc.CGNSLibraryVersion.label, "CGNSLibraryVersion_t");
    assert.equal(doc.bases.length, 1);
    assert.equal(doc.bases[0]!.label, "CGNSBase_t");
    assert.equal(doc.bases[0]!.name, "WingBase");
    const zone = doc.bases[0]!.zones[0]!;
    assert.equal(zone.label, "Zone_t");
    assert.equal(zone.name, "FluidZone");

    const childLabels = new Set(zone.children.map((c) => c.label));
    assert.ok(childLabels.has("ZoneType_t"));
    assert.ok(childLabels.has("GridCoordinates_t"));
    assert.ok(childLabels.has("Elements_t"));
    assert.ok(childLabels.has("FlowSolution_t"));
    assert.ok(childLabels.has("ZoneBC_t"));

    // Verify 1-based CGNS element connectivity
    const elems = zone.children.find((c) => c.label === "Elements_t");
    assert.deepEqual(elems?.children?.[0]?.data, [1, 2, 3, 4]);
  });
});

describe("StepMesher named face preservation", () => {
  it("preserves custom namedFacePatches on volumetric tetrahedral boundary faces", () => {
    // Unit cube [0,1]^3 with 12 triangles (2 per face)
    const verts = new Float32Array([
      0,
      0,
      0, // 0
      1,
      0,
      0, // 1
      1,
      1,
      0, // 2
      0,
      1,
      0, // 3
      0,
      0,
      1, // 4
      1,
      0,
      1, // 5
      1,
      1,
      1, // 6
      0,
      1,
      1, // 7
    ]);
    const inds = new Uint32Array([
      // -X face (tris 0, 1)
      0, 4, 7, 0, 7, 3,
      // +X face (tris 2, 3)
      1, 2, 6, 1, 6, 5,
      // -Y face (tris 4, 5)
      0, 1, 5, 0, 5, 4,
      // +Y face (tris 6, 7)
      3, 7, 6, 3, 6, 2,
      // -Z face (tris 8, 9)
      0, 3, 2, 0, 2, 1,
      // +Z face (tris 10, 11)
      4, 5, 6, 4, 6, 7,
    ]);

    const res = StepMesher.meshSurfaceToTetrahedra(verts, inds, {
      resolution: 6,
      namedFacePatches: [
        { name: "INLET_FLANGE", triangleIndices: [0, 1] },
        { name: "OUTLET_NOZZLE", triangleIndices: [2, 3] },
      ],
    });

    assert.ok(res.mesh.numElements > 0);
    assert.ok(res.patches.nodeSets.has("INLET_FLANGE"), "expected INLET_FLANGE nodeSet to be preserved");
    assert.ok(res.patches.nodeSets.has("OUTLET_NOZZLE"), "expected OUTLET_NOZZLE nodeSet to be preserved");
    assert.ok((res.patches.nodeSets.get("INLET_FLANGE")?.length ?? 0) > 0);
    assert.ok((res.patches.nodeSets.get("OUTLET_NOZZLE")?.length ?? 0) > 0);
    assert.ok((res.patches.surfaceTriangles.get("INLET_FLANGE")?.length ?? 0) > 0);
    assert.ok((res.patches.surfaceTriangles.get("OUTLET_NOZZLE")?.length ?? 0) > 0);
  });
});
