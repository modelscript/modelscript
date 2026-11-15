// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { getStepAssemblyModel, indexStepDocument, stepLanguage } from "../src/index.js";

describe("STEP UnifiedWorkspace Indexing and STEP LSP Handlers", () => {
  const sampleUri = "memfs:/drone-meshing/drone.step";
  const sampleText = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Sample Drone'), '2;1');
FILE_NAME('drone.step', '2026-09-30', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10 = PRODUCT('DroneChassis', 'DroneChassis', '', (#11));
#20 = MANIFOLD_SOLID_BREP('CentralBody', #30);
ENDSEC;
END-ISO-10303-21;`;

  it("indexes STEP products, shapes, and assembly models into UnifiedWorkspace via getIndex()", async () => {
    const ws = new UnifiedWorkspace(stepLanguage);

    assert.strictEqual(ws.hasDocument(sampleUri), false);
    assert.strictEqual(ws.getFileIndex(sampleUri), undefined);

    const initialRev = ws.version;
    ws.setDocument(sampleUri, sampleText);
    assert.ok(ws.version > initialRev);
    assert.strictEqual(ws.hasDocument(sampleUri), true);

    const fileIndex = ws.getFileIndex(sampleUri);
    assert.ok(fileIndex);
    assert.ok(fileIndex.symbols.size > 0);
    assert.ok(ws.getIndex().byName.has("DroneChassis"));
    assert.ok(ws.getIndex().byName.has("CentralBody"));
    assert.ok(getStepAssemblyModel(ws, sampleUri));

    const buffer = new TextEncoder().encode(sampleText);
    const asyncIndex = await indexStepDocument(ws, sampleUri, buffer);
    assert.ok(asyncIndex.symbols.size > 0);
  });

  it("returns meshes from modelscript/getStepMeshes handler for STEP files", async () => {
    const ws = new UnifiedWorkspace(stepLanguage);
    ws.setDocument(sampleUri, sampleText);
    const mockContext = {
      workspaceManager: {
        unifiedWorkspace: ws,
      },
      documentManager: {
        documentTrees: new Map([[sampleUri, { text: sampleText }]]),
      },
    };

    const handler = (stepLanguage as any)?.lsp?.handlers?.["modelscript/getStepMeshes"];
    assert.strictEqual(typeof handler, "function");

    const meshes = await handler(mockContext, { uri: sampleUri });
    assert.ok(Array.isArray(meshes));
    assert.ok(meshes.length > 0, "Expected at least one mesh to be returned");
    assert.strictEqual(meshes[0].name, "CentralBody");
    assert.ok(meshes[0].vertices.length > 0);
    assert.ok(meshes[0].indices.length > 0);
  });

  it("propagates OCCT root PRODUCT name onto unnamed B-Rep meshes and invalidates stale cache on documentText change", async () => {
    const makeAp242CylinderStep = (productName: string, r: number, hh: number): string => `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ModelScript AP242'), '2;1');
FILE_NAME('${productName}.step', '2026-11-15T12:00:00Z', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
#11 = ( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) );
#12 = ( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() );
#13 = UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-6), #10, 'DISTANCE_ACCURACY_VALUE', '');
#14 = ( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#13)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#10,#11,#12)) REPRESENTATION_CONTEXT('','3D') );
#15 = APPLICATION_CONTEXT('managed model based 3d engineering');
#16 = PRODUCT_CONTEXT('part definition', #15, 'mechanical');
#17 = PRODUCT('${productName}', '${productName}', $, (#16));
#18 = PRODUCT_DEFINITION_FORMATION('', $, #17);
#19 = PRODUCT_DEFINITION_CONTEXT('part definition', #15, 'design');
#20 = PRODUCT_DEFINITION('${productName}', '${productName}', #18, #19);
#21 = PRODUCT_DEFINITION_SHAPE('', $, #20);
#22 = CARTESIAN_POINT('', (0.0, 0.0, 0.0));
#23 = DIRECTION('', (0.0, 0.0, 1.0));
#24 = DIRECTION('', (1.0, 0.0, 0.0));
#25 = AXIS2_PLACEMENT_3D('placement', #22, #23, #24);
#26 = VERTEX_POINT('v0', #27);
#27 = CARTESIAN_POINT('', (-${r.toFixed(1)}, 0.0, -${hh.toFixed(1)}));
#28 = VERTEX_POINT('v1', #29);
#29 = CARTESIAN_POINT('', (${r.toFixed(1)}, 0.0, -${hh.toFixed(1)}));
#30 = VERTEX_POINT('v2', #31);
#31 = CARTESIAN_POINT('', (-${r.toFixed(1)}, 0.0, ${hh.toFixed(1)}));
#32 = VERTEX_POINT('v3', #33);
#33 = CARTESIAN_POINT('', (${r.toFixed(1)}, 0.0, ${hh.toFixed(1)}));
#34 = CARTESIAN_POINT('', (0.0, 0.0, -${hh.toFixed(1)}));
#35 = AXIS2_PLACEMENT_3D('', #34, #23, #24);
#36 = CIRCLE('', #35, ${r.toFixed(1)});
#37 = CARTESIAN_POINT('', (0.0, 0.0, ${hh.toFixed(1)}));
#38 = AXIS2_PLACEMENT_3D('', #37, #23, #24);
#39 = CIRCLE('', #38, ${r.toFixed(1)});
#40 = EDGE_CURVE('', #26, #28, #36, .T.);
#41 = EDGE_CURVE('', #28, #26, #36, .T.);
#42 = EDGE_CURVE('', #30, #32, #39, .T.);
#43 = EDGE_CURVE('', #32, #30, #39, .T.);
#44 = VECTOR('', #23, ${(2 * hh).toFixed(1)});
#45 = LINE('', #27, #44);
#46 = EDGE_CURVE('', #26, #30, #45, .T.);
#47 = LINE('', #29, #44);
#48 = EDGE_CURVE('', #28, #32, #47, .T.);
#49 = DIRECTION('', (0.0, 0.0, -1.0));
#50 = AXIS2_PLACEMENT_3D('', #34, #49, #24);
#51 = PLANE('', #50);
#52 = ORIENTED_EDGE('', *, *, #41, .F.);
#53 = ORIENTED_EDGE('', *, *, #40, .F.);
#54 = EDGE_LOOP('', (#52, #53));
#55 = FACE_OUTER_BOUND('', #54, .T.);
#56 = ADVANCED_FACE('', (#55), #51, .T.);
#57 = PLANE('', #38);
#58 = ORIENTED_EDGE('', *, *, #42, .T.);
#59 = ORIENTED_EDGE('', *, *, #43, .T.);
#60 = EDGE_LOOP('', (#58, #59));
#61 = FACE_OUTER_BOUND('', #60, .T.);
#62 = ADVANCED_FACE('', (#61), #57, .T.);
#63 = CYLINDRICAL_SURFACE('', #35, ${r.toFixed(1)});
#64 = ORIENTED_EDGE('', *, *, #40, .T.);
#65 = ORIENTED_EDGE('', *, *, #48, .T.);
#66 = ORIENTED_EDGE('', *, *, #42, .F.);
#67 = ORIENTED_EDGE('', *, *, #46, .F.);
#68 = EDGE_LOOP('', (#64, #65, #66, #67));
#69 = FACE_OUTER_BOUND('', #68, .T.);
#70 = ADVANCED_FACE('', (#69), #63, .T.);
#71 = ORIENTED_EDGE('', *, *, #41, .T.);
#72 = ORIENTED_EDGE('', *, *, #46, .T.);
#73 = ORIENTED_EDGE('', *, *, #43, .F.);
#74 = ORIENTED_EDGE('', *, *, #48, .F.);
#75 = EDGE_LOOP('', (#71, #72, #73, #74));
#76 = FACE_OUTER_BOUND('', #75, .T.);
#77 = ADVANCED_FACE('', (#76), #63, .T.);
#78 = CLOSED_SHELL('', (#56, #62, #70, #77));
#79 = MANIFOLD_SOLID_BREP('', #78);
#80 = ADVANCED_BREP_SHAPE_REPRESENTATION('', (#79), #14);
#81 = SHAPE_REPRESENTATION('', (#25), #14);
#82 = SHAPE_REPRESENTATION_RELATIONSHIP('SRR', 'None', #81, #80);
#83 = SHAPE_DEFINITION_REPRESENTATION(#21, #81);
ENDSEC;
END-ISO-10303-21;`;

    const ws = new UnifiedWorkspace(stepLanguage);
    const cacheUri = "memfs:/occt-cache/nacelle.step";
    const stepV1 = makeAp242CylinderStep("intake_nacelle", 1.0, 0.5);
    ws.setDocument(cacheUri, stepV1);

    const mockContext = {
      workspaceManager: { unifiedWorkspace: ws },
      documentManager: { documentTrees: new Map([[cacheUri, { text: stepV1 }]]) },
    };
    const handler = (stepLanguage as any)?.lsp?.handlers?.["modelscript/getStepMeshes"];
    assert.strictEqual(typeof handler, "function");

    const meshesV1 = await handler(mockContext, { uri: cacheUri, documentText: stepV1 });
    assert.ok(meshesV1.length >= 1);
    assert.strictEqual(meshesV1[0].fromOcct, true, "Expected OCCT tessellation");
    assert.strictEqual(meshesV1[0].unit, "m", "Expected SI_UNIT(.METRE.) detection");
    assert.strictEqual(
      meshesV1[0].name,
      "intake_nacelle",
      "Expected OCCT root PRODUCT name propagated onto unnamed solid",
    );

    // Mutate only documentText in request (stale cache & stale documentManager) -> handler must re-index and return updated mesh
    const stepV2 = makeAp242CylinderStep("fan_lp_stage", 2.0, 0.5);
    const meshesV2 = await handler(mockContext, { uri: cacheUri, documentText: stepV2 });
    assert.ok(meshesV2.length >= 1);
    assert.strictEqual(meshesV2[0].name, "fan_lp_stage");
    const maxCoordV1 = Math.max(...meshesV1[0].vertices.map((v: number) => Math.abs(v)));
    const maxCoordV2 = Math.max(...meshesV2[0].vertices.map((v: number) => Math.abs(v)));
    assert.ok(maxCoordV2 > maxCoordV1 * 1.5, `Expected updated geometry extent V2=${maxCoordV2} > V1=${maxCoordV1}`);
  });
});
