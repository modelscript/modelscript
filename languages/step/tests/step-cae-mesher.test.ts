// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeMeshMassProperties,
  extractStepAssembly,
  generateConformingStepMesh,
  stepLanguage,
  tessellateStepSolid,
} from "../src/index.js";

/**
 * Closed 6-face B-Rep rectangular solid over [1, 3] x [-2, 2] x [0, 6]
 * Dimensions: Lx = 2, Ly = 4, Lz = 6 -> Volume = 48 m³, CoM = (2, 0, 3)
 * Named ADVANCED_FACE topological boundary patches:
 *   - 'inlet' (x = 1, normal -X)
 *   - 'outlet' (x = 3, normal +X)
 *   - 'wall_front' (y = -2, normal -Y)
 *   - 'wall_back' (y = 2, normal +Y)
 *   - 'wall_bottom' (z = 0, normal -Z)
 *   - 'wall_top' (z = 6, normal +Z)
 */
const CLOSED_BOX_BREP_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Closed 6-face B-Rep box solid with named topological faces'),'2;1');
FILE_NAME('closed_box.step','2026-03-30T00:00:00',('ModelScript'),('ModelScript'),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('automotive design');
#2 = PRODUCT_CONTEXT('',#1,'mechanical');
#3 = PRODUCT('DUCT_BODY','Aerodynamic Duct Body','',(#2));
#4 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('1','',#3,.NOT_KNOWN.);
#5 = PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#6 = PRODUCT_DEFINITION('design','',#4,#5);

/* 8 Corner Vertices: [1..3] x [-2..2] x [0..6] */
#10 = CARTESIAN_POINT('v000',(1.0,-2.0,0.0));
#11 = CARTESIAN_POINT('v100',(3.0,-2.0,0.0));
#12 = CARTESIAN_POINT('v110',(3.0,2.0,0.0));
#13 = CARTESIAN_POINT('v010',(1.0,2.0,0.0));
#14 = CARTESIAN_POINT('v001',(1.0,-2.0,6.0));
#15 = CARTESIAN_POINT('v101',(3.0,-2.0,6.0));
#16 = CARTESIAN_POINT('v111',(3.0,2.0,6.0));
#17 = CARTESIAN_POINT('v011',(1.0,2.0,6.0));

#20 = VERTEX_POINT('',#10);
#21 = VERTEX_POINT('',#11);
#22 = VERTEX_POINT('',#12);
#23 = VERTEX_POINT('',#13);
#24 = VERTEX_POINT('',#14);
#25 = VERTEX_POINT('',#15);
#26 = VERTEX_POINT('',#16);
#27 = VERTEX_POINT('',#17);

/* 12 Straight Edges */
#30 = LINE('',#10,#11);
#31 = LINE('',#11,#12);
#32 = LINE('',#12,#13);
#33 = LINE('',#13,#10);
#34 = LINE('',#14,#15);
#35 = LINE('',#15,#16);
#36 = LINE('',#16,#17);
#37 = LINE('',#17,#14);
#38 = LINE('',#10,#14);
#39 = LINE('',#11,#15);
#40 = LINE('',#12,#16);
#41 = LINE('',#13,#17);

#50 = EDGE_CURVE('',#20,#21,#30,.T.);
#51 = EDGE_CURVE('',#21,#22,#31,.T.);
#52 = EDGE_CURVE('',#22,#23,#32,.T.);
#53 = EDGE_CURVE('',#23,#20,#33,.T.);
#54 = EDGE_CURVE('',#24,#25,#34,.T.);
#55 = EDGE_CURVE('',#25,#26,#35,.T.);
#56 = EDGE_CURVE('',#26,#27,#36,.T.);
#57 = EDGE_CURVE('',#27,#24,#37,.T.);
#58 = EDGE_CURVE('',#20,#24,#38,.T.);
#59 = EDGE_CURVE('',#21,#25,#39,.T.);
#60 = EDGE_CURVE('',#22,#26,#40,.T.);
#61 = EDGE_CURVE('',#23,#27,#41,.T.);

/* Face 1: wall_bottom (z = 0, normal -Z) */
#70 = DIRECTION('dir_neg_z',(0.0,0.0,-1.0));
#71 = DIRECTION('dir_x',(1.0,0.0,0.0));
#72 = AXIS2_PLACEMENT_3D('',#10,#70,#71);
#73 = PLANE('',#72);
#74 = ORIENTED_EDGE('',*,*,#53,.F.);
#75 = ORIENTED_EDGE('',*,*,#52,.F.);
#76 = ORIENTED_EDGE('',*,*,#51,.F.);
#77 = ORIENTED_EDGE('',*,*,#50,.F.);
#78 = EDGE_LOOP('',(#74,#75,#76,#77));
#79 = FACE_OUTER_BOUND('',#78,.T.);
#80 = ADVANCED_FACE('wall_bottom',(#79),#73,.T.);

/* Face 2: wall_top (z = 6, normal +Z) */
#81 = DIRECTION('dir_pos_z',(0.0,0.0,1.0));
#82 = AXIS2_PLACEMENT_3D('',#14,#81,#71);
#83 = PLANE('',#82);
#84 = ORIENTED_EDGE('',*,*,#54,.T.);
#85 = ORIENTED_EDGE('',*,*,#55,.T.);
#86 = ORIENTED_EDGE('',*,*,#56,.T.);
#87 = ORIENTED_EDGE('',*,*,#57,.T.);
#88 = EDGE_LOOP('',(#84,#85,#86,#87));
#89 = FACE_OUTER_BOUND('',#88,.T.);
#90 = ADVANCED_FACE('wall_top',(#89),#83,.T.);

/* Face 3: inlet (x = 1, normal -X) */
#91 = DIRECTION('dir_neg_x',(-1.0,0.0,0.0));
#92 = DIRECTION('dir_y',(0.0,1.0,0.0));
#93 = AXIS2_PLACEMENT_3D('',#10,#91,#92);
#94 = PLANE('',#93);
#95 = ORIENTED_EDGE('',*,*,#58,.T.);
#96 = ORIENTED_EDGE('',*,*,#57,.F.);
#97 = ORIENTED_EDGE('',*,*,#61,.F.);
#98 = ORIENTED_EDGE('',*,*,#53,.T.);
#99 = EDGE_LOOP('',(#95,#96,#97,#98));
#100 = FACE_OUTER_BOUND('',#99,.T.);
#101 = ADVANCED_FACE('inlet',(#100),#94,.T.);

/* Face 4: outlet (x = 3, normal +X) */
#102 = AXIS2_PLACEMENT_3D('',#11,#71,#92);
#103 = PLANE('',#102);
#104 = ORIENTED_EDGE('',*,*,#51,.T.);
#105 = ORIENTED_EDGE('',*,*,#60,.T.);
#106 = ORIENTED_EDGE('',*,*,#55,.F.);
#107 = ORIENTED_EDGE('',*,*,#59,.F.);
#108 = EDGE_LOOP('',(#104,#105,#106,#107));
#109 = FACE_OUTER_BOUND('',#108,.T.);
#110 = ADVANCED_FACE('outlet',(#109),#103,.T.);

/* Face 5: wall_front (y = -2, normal -Y) */
#111 = DIRECTION('dir_neg_y',(0.0,-1.0,0.0));
#112 = AXIS2_PLACEMENT_3D('',#10,#111,#71);
#113 = PLANE('',#112);
#114 = ORIENTED_EDGE('',*,*,#50,.T.);
#115 = ORIENTED_EDGE('',*,*,#59,.T.);
#116 = ORIENTED_EDGE('',*,*,#54,.F.);
#117 = ORIENTED_EDGE('',*,*,#58,.F.);
#118 = EDGE_LOOP('',(#114,#115,#116,#117));
#119 = FACE_OUTER_BOUND('',#118,.T.);
#120 = ADVANCED_FACE('wall_front',(#119),#113,.T.);

/* Face 6: wall_back (y = 2, normal +Y) */
#121 = AXIS2_PLACEMENT_3D('',#13,#92,#71);
#122 = PLANE('',#121);
#123 = ORIENTED_EDGE('',*,*,#52,.T.);
#124 = ORIENTED_EDGE('',*,*,#61,.T.);
#125 = ORIENTED_EDGE('',*,*,#56,.F.);
#126 = ORIENTED_EDGE('',*,*,#60,.F.);
#127 = EDGE_LOOP('',(#123,#124,#125,#126));
#128 = FACE_OUTER_BOUND('',#127,.T.);
#129 = ADVANCED_FACE('wall_back',(#128),#122,.T.);

#130 = CLOSED_SHELL('',(#80,#90,#101,#110,#120,#129));
#131 = MANIFOLD_SOLID_BREP('DuctSolid',#130);
ENDSEC;
END-ISO-10303-21;`;

describe("STEP Conforming B-Rep Surface-to-Volume CAE Mesher & Polyhedral Mass Properties", () => {
  it("computes exact divergence-theorem volume, center of mass, and 3x3 inertia tensor on a closed B-Rep solid", () => {
    const solidMesh = tessellateStepSolid(CLOSED_BOX_BREP_STEP);
    assert.equal(solidMesh.faceCount, 6);
    assert.equal(solidMesh.triangleCount, 12);

    const density = 1000.0; // kg/m³
    const props = computeMeshMassProperties(solidMesh, density);

    // Dimensions: Lx = 2, Ly = 4, Lz = 6 -> Volume = 48 m³, Mass = 48000 kg
    assert.ok(Math.abs(props.volume - 48.0) < 1e-6, `Expected volume 48.0 m³, got ${props.volume}`);
    assert.ok(Math.abs(props.mass - 48000.0) < 1e-3, `Expected mass 48000 kg, got ${props.mass}`);
    // Surface area: 2*(2*4 + 2*6 + 4*6) = 2*(8 + 12 + 24) = 88 m²
    assert.ok(Math.abs(props.surfaceArea - 88.0) < 1e-6, `Expected surface area 88.0 m², got ${props.surfaceArea}`);

    // Center of mass: [2.0, 0.0, 3.0]
    assert.ok(Math.abs(props.centerOfMass[0] - 2.0) < 1e-6, `Expected CoM.x = 2.0, got ${props.centerOfMass[0]}`);
    assert.ok(Math.abs(props.centerOfMass[1] - 0.0) < 1e-6, `Expected CoM.y = 0.0, got ${props.centerOfMass[1]}`);
    assert.ok(Math.abs(props.centerOfMass[2] - 3.0) < 1e-6, `Expected CoM.z = 3.0, got ${props.centerOfMass[2]}`);

    // Analytical principal moments of inertia about CoM:
    // I_11 = (1/12) * m * (Ly^2 + Lz^2) = (48000 / 12) * (16 + 36) = 4000 * 52 = 208000
    // I_22 = (1/12) * m * (Lx^2 + Lz^2) = (48000 / 12) * (4 + 36)  = 4000 * 40 = 160000
    // I_33 = (1/12) * m * (Lx^2 + Ly^2) = (48000 / 12) * (4 + 16)  = 4000 * 20 = 80000
    assert.ok(
      Math.abs(props.inertiaTensor.I_11 - 208000.0) < 1e-3,
      `Expected I_11 = 208000, got ${props.inertiaTensor.I_11}`,
    );
    assert.ok(
      Math.abs(props.inertiaTensor.I_22 - 160000.0) < 1e-3,
      `Expected I_22 = 160000, got ${props.inertiaTensor.I_22}`,
    );
    assert.ok(
      Math.abs(props.inertiaTensor.I_33 - 80000.0) < 1e-3,
      `Expected I_33 = 80000, got ${props.inertiaTensor.I_33}`,
    );
    assert.ok(Math.abs(props.inertiaTensor.I_21) < 1e-5);
    assert.ok(Math.abs(props.inertiaTensor.I_31) < 1e-5);
    assert.ok(Math.abs(props.inertiaTensor.I_32) < 1e-5);

    // Projected cross-section areas: yz = 4*6 = 24, xz = 2*6 = 12, xy = 2*4 = 8
    assert.ok(Math.abs(props.crossSectionArea.yz - 24.0) < 1e-6);
    assert.ok(Math.abs(props.crossSectionArea.xz - 12.0) < 1e-6);
    assert.ok(Math.abs(props.crossSectionArea.xy - 8.0) < 1e-6);
  });

  it("prevents false-positive centerOfMass matching on CARTESIAN_POINT names like 'combustor_inlet' or 'component_origin'", () => {
    const stepWithCombustor = `${CLOSED_BOX_BREP_STEP.replace("ENDSEC;\nEND-ISO-10303-21;", "")}
#200 = CARTESIAN_POINT('combustor_inlet',(999.0,-888.0,777.0));
#201 = CARTESIAN_POINT('component_origin',(-555.0,444.0,-333.0));
#202 = CARTESIAN_POINT('telecommunications_port',(123.0,456.0,789.0));
ENDSEC;
END-ISO-10303-21;`;

    const assembly = extractStepAssembly(stepWithCombustor);
    const massProp = assembly.massProperties.get("#3");
    assert.ok(massProp, "Expected mass properties for #3 (DUCT_BODY)");
    // Must equal the B-Rep polyhedral center of mass (2, 0, 3), NOT (999, -888, 777) or (-555, 444, -333)
    assert.ok(
      Math.abs(massProp.centerOfMass[0] - 2.0) < 1e-4 &&
        Math.abs(massProp.centerOfMass[1] - 0.0) < 1e-4 &&
        Math.abs(massProp.centerOfMass[2] - 3.0) < 1e-4,
      `Expected B-Rep CoM (2, 0, 3), got (${massProp.centerOfMass.join(", ")})`,
    );
    assert.ok(Math.abs((massProp.volume ?? 0) - 48.0) < 1e-4);

    // Verify explicit 'centre of mass' point still overrides when intentionally specified
    const stepWithExplicitCom = `${stepWithCombustor.replace("ENDSEC;\nEND-ISO-10303-21;", "")}
#203 = CARTESIAN_POINT('centre of mass',(2.25,0.15,3.05));
ENDSEC;
END-ISO-10303-21;`;
    const assemblyExplicit = extractStepAssembly(stepWithExplicitCom);
    const explicitProp = assemblyExplicit.massProperties.get("#3");
    assert.ok(explicitProp);
    assert.deepEqual(explicitProp.centerOfMass, [2.25, 0.15, 3.05]);
  });

  it("subdivides tessellated B-Rep solid into positive-Jacobian C3D4 tetrahedra and preserves ADVANCED_FACE boundary patches", () => {
    const mesh = generateConformingStepMesh(CLOSED_BOX_BREP_STEP, {
      layers: 2,
      filename: "closed_box.step",
      baseName: "closed_box",
    });

    assert.equal(mesh.elementType, "C3D4");
    assert.ok(mesh.tetrahedra.length >= 36, `Expected >= 36 C3D4 tetrahedra, got ${mesh.tetrahedra.length}`);
    assert.equal(mesh.boundaryPatches.length, 6);

    // Every C3D4 tetrahedron must have strictly positive Jacobian determinant
    let totalTetVol = 0;
    for (let i = 0; i < mesh.tetrahedra.length; i++) {
      const [n0, n1, n2, n3] = mesh.tetrahedra[i]!;
      const p0 = mesh.nodes[n0]!;
      const p1 = mesh.nodes[n1]!;
      const p2 = mesh.nodes[n2]!;
      const p3 = mesh.nodes[n3]!;
      const ax = p1[0] - p0[0],
        ay = p1[1] - p0[1],
        az = p1[2] - p0[2];
      const bx = p2[0] - p0[0],
        by = p2[1] - p0[1],
        bz = p2[2] - p0[2];
      const cx = p3[0] - p0[0],
        cy = p3[1] - p0[1],
        cz = p3[2] - p0[2];
      const detJ = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      assert.ok(detJ > 1e-9, `Tetrahedron ${i} has non-positive Jacobian detJ=${detJ}`);
      totalTetVol += detJ / 6.0;
    }

    // Sum of all interior C3D4 tetrahedral volumes must equal the closed B-Rep volume (48.0 m³)
    assert.ok(
      Math.abs(totalTetVol - 48.0) < 1e-5,
      `Sum of C3D4 tetrahedral volumes (${totalTetVol}) must match B-Rep volume (48.0)`,
    );

    // Named ADVANCED_FACE patches must be preserved in CalculiX .inp (*NSET / *ELSET) and SU2 (.su2 MARKER_TAG=)
    const patchNames = mesh.boundaryPatches.map((p) => p.name);
    assert.ok(patchNames.includes("inlet"));
    assert.ok(patchNames.includes("outlet"));
    assert.ok(patchNames.includes("wall_bottom"));
    assert.ok(patchNames.includes("wall_top"));

    assert.ok(mesh.inpDeck.includes("*ELEMENT, TYPE=C3D4, ELSET=ESOLID"));
    assert.ok(mesh.inpDeck.includes("*NSET, NSET=INLET"));
    assert.ok(mesh.inpDeck.includes("*ELSET, ELSET=ELSET_INLET"));
    assert.ok(mesh.inpDeck.includes("*NSET, NSET=OUTLET"));

    assert.ok(mesh.su2Mesh.includes("MARKER_TAG= inlet"));
    assert.ok(mesh.su2Mesh.includes("MARKER_TAG= outlet"));
    assert.ok(mesh.su2Mesh.includes("MARKER_TAG= wall_bottom"));
    assert.ok(mesh.su2Config.includes("REF_AREA= 24"));
    assert.ok(mesh.su2Config.includes("REF_LENGTH= 6"));
  });

  it("executes stepLanguage CAE actions (generate_fea_mesh, generate_cfd_mesh, create_fea_setup, create_cfd_setup) using B-Rep meshing", async () => {
    const actions = stepLanguage.actions ?? [];
    const genFea = actions.find((a) => a.id === "generate_fea_mesh");
    const genCfd = actions.find((a) => a.id === "generate_cfd_mesh");
    const setupFea = actions.find((a) => a.id === "create_fea_setup");
    const setupCfd = actions.find((a) => a.id === "create_cfd_setup");

    assert.ok(genFea && genCfd && setupFea && setupCfd);

    const feaRes = (await genFea.execute(
      { uri: "file:///workspace/duct.step" },
      { documentText: CLOSED_BOX_BREP_STEP },
    )) as {
      success: boolean;
      deckText: string;
      elementType: string;
      elementCount: number;
      boundaryPatches: Array<{ name: string }>;
      totalVolume: number;
    };
    assert.equal(feaRes.success, true);
    assert.equal(feaRes.elementType, "C3D4");
    assert.ok(feaRes.elementCount >= 36);
    assert.ok(Math.abs(feaRes.totalVolume - 48.0) < 1e-5);
    assert.ok(feaRes.deckText.includes("*ELEMENT, TYPE=C3D4, ELSET=ESOLID"));
    assert.ok(feaRes.boundaryPatches.some((p) => p.name === "inlet"));

    const cfdRes = (await genCfd.execute(
      { uri: "file:///workspace/duct.step" },
      { documentText: CLOSED_BOX_BREP_STEP },
    )) as {
      success: boolean;
      meshText: string;
      configText: string;
      boundaryPatches: Array<{ name: string; triangleCount: number }>;
    };
    assert.equal(cfdRes.success, true);
    assert.ok(cfdRes.meshText.includes("MARKER_TAG= inlet"));
    assert.ok(cfdRes.meshText.includes("MARKER_TAG= outlet"));
    assert.ok(cfdRes.boundaryPatches.every((p) => p.triangleCount >= 2));

    const feaStudy = (await setupFea.execute(
      { uri: "file:///workspace/duct.step" },
      { documentText: CLOSED_BOX_BREP_STEP },
    )) as {
      success: boolean;
      source: string;
      volume: number;
      surfaceArea: number;
      sectionModulus: number;
    };
    assert.equal(feaStudy.success, true);
    assert.ok(Math.abs(feaStudy.volume - 48.0) < 1e-5);
    assert.ok(Math.abs(feaStudy.surfaceArea - 88.0) < 1e-5);
    assert.ok(feaStudy.sectionModulus > 0);
    assert.ok(feaStudy.source.includes("parameter Real V = 48"));

    const cfdStudy = (await setupCfd.execute(
      { uri: "file:///workspace/duct.step" },
      { documentText: CLOSED_BOX_BREP_STEP },
    )) as {
      success: boolean;
      source: string;
      crossSectionArea: number;
      wettedArea: number;
    };
    assert.equal(cfdStudy.success, true);
    assert.equal(cfdStudy.crossSectionArea, 24);
    assert.equal(cfdStudy.wettedArea, 88);
    assert.ok(cfdStudy.source.includes("parameter Real A_ref = 24"));
    assert.ok(cfdStudy.source.includes("parameter Real A_wet = 88"));
  });
});
