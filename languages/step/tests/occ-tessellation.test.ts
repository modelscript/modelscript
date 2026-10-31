// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { tessellateStepSolid } from "../src/occ.js";

describe("STEP B-Rep Face Loop & Analytic/NURBS Surface Tessellation (occ.ts)", () => {
  it("traverses MANIFOLD_SOLID_BREP -> CLOSED_SHELL -> ADVANCED_FACE -> FACE_OUTER_BOUND / FACE_BOUND -> EDGE_LOOP -> ORIENTED_EDGE -> EDGE_CURVE -> VERTEX_POINT -> CARTESIAN_POINT", () => {
    const stepText = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('B-Rep Plate With Hole'), '2;1');
FILE_NAME('plate.step', '2026-10-30', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('Origin', (0.0, 0.0, 0.0));
#2 = DIRECTION('Z', (0.0, 0.0, 1.0));
#3 = DIRECTION('X', (1.0, 0.0, 0.0));
#4 = AXIS2_PLACEMENT_3D('PlaneFrame', #1, #2, #3);
#5 = PLANE('TopPlane', #4);

/* Outer square vertices (10x10) */
#10 = CARTESIAN_POINT('P0', (0.0, 0.0, 0.0));
#11 = CARTESIAN_POINT('P1', (10.0, 0.0, 0.0));
#12 = CARTESIAN_POINT('P2', (10.0, 10.0, 0.0));
#13 = CARTESIAN_POINT('P3', (0.0, 10.0, 0.0));
#20 = VERTEX_POINT('V0', #10);
#21 = VERTEX_POINT('V1', #11);
#22 = VERTEX_POINT('V2', #12);
#23 = VERTEX_POINT('V3', #13);

#30 = LINE('L0', #10, #3);
#31 = EDGE_CURVE('E0', #20, #21, #30, .T.);
#32 = EDGE_CURVE('E1', #21, #22, #30, .T.);
#33 = EDGE_CURVE('E2', #22, #23, #30, .T.);
#34 = EDGE_CURVE('E3', #23, #20, #30, .T.);

#40 = ORIENTED_EDGE('OE0', *, *, #31, .T.);
#41 = ORIENTED_EDGE('OE1', *, *, #32, .T.);
#42 = ORIENTED_EDGE('OE2', *, *, #33, .T.);
#43 = ORIENTED_EDGE('OE3', *, *, #34, .T.);
#44 = EDGE_LOOP('OuterLoop', (#40, #41, #42, #43));
#45 = FACE_OUTER_BOUND('OuterBound', #44, .T.);

/* Inner square hole (3..7 x 3..7) */
#50 = CARTESIAN_POINT('H0', (3.0, 3.0, 0.0));
#51 = CARTESIAN_POINT('H1', (7.0, 3.0, 0.0));
#52 = CARTESIAN_POINT('H2', (7.0, 7.0, 0.0));
#53 = CARTESIAN_POINT('H3', (3.0, 7.0, 0.0));
#54 = POLY_LOOP('InnerLoop', (#50, #51, #52, #53));
#55 = FACE_BOUND('InnerBound', #54, .T.);

#60 = ADVANCED_FACE('TopFaceWithHole', (#45, #55), #5, .T.);
#70 = CLOSED_SHELL('MainShell', (#60));
#80 = MANIFOLD_SOLID_BREP('PerforatedPlate', #70);
ENDSEC;
END-ISO-10303-21;`;

    const mesh = tessellateStepSolid(stepText);
    assert.strictEqual(mesh.name, "PerforatedPlate");
    assert.strictEqual(mesh.faceCount, 1);
    assert.ok(mesh.triangleCount >= 6, `Expected >= 6 triangles for square with hole, got ${mesh.triangleCount}`);
    assert.strictEqual(mesh.faces[0]!.boundaryLoopPoints.length, 2);
    assert.strictEqual(mesh.boundingBox.min[0], 0);
    assert.strictEqual(mesh.boundingBox.max[0], 10);
    assert.strictEqual(mesh.boundingBox.max[1], 10);
  });

  it("tessellates CYLINDRICAL_SURFACE, SPHERICAL_SURFACE, and TOROIDAL_SURFACE patches", () => {
    const stepText = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Curved Surfaces'), '2;1');
FILE_NAME('curved.step', '2026-10-30', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = CARTESIAN_POINT('Origin', (0.0, 0.0, 0.0));
#2 = DIRECTION('Z', (0.0, 0.0, 1.0));
#3 = DIRECTION('X', (1.0, 0.0, 0.0));
#4 = AXIS2_PLACEMENT_3D('Axis', #1, #2, #3);

#10 = CYLINDRICAL_SURFACE('CylSurf', #4, 5.0);
#11 = SPHERICAL_SURFACE('SphSurf', #4, 5.0);
#12 = TOROIDAL_SURFACE('TorSurf', #4, 10.0, 2.0);

#20 = CARTESIAN_POINT('C0', (5.0, 0.0, 0.0));
#21 = CARTESIAN_POINT('C1', (5.0, 0.0, 12.0));
#22 = VERTEX_POINT('VC0', #20);
#23 = VERTEX_POINT('VC1', #21);
#24 = CIRCLE('BaseCircle', #4, 5.0);
#25 = EDGE_CURVE('EC0', #22, #22, #24, .T.);
#26 = EDGE_CURVE('EC1', #23, #23, #24, .T.);
#27 = ORIENTED_EDGE('OEC0', *, *, #25, .T.);
#28 = ORIENTED_EDGE('OEC1', *, *, #26, .T.);
#29 = EDGE_LOOP('CylLoop', (#27, #28));
#30 = FACE_OUTER_BOUND('CylBound', #29, .T.);

#40 = ADVANCED_FACE('CylFace', (#30), #10, .T.);
#41 = ADVANCED_FACE('SphFace', (#30), #11, .T.);
#42 = ADVANCED_FACE('TorFace', (#30), #12, .T.);
#50 = CLOSED_SHELL('CurvedShell', (#40, #41, #42));
#60 = MANIFOLD_SOLID_BREP('CurvedSolid', #50);
ENDSEC;
END-ISO-10303-21;`;

    const mesh = tessellateStepSolid(stepText, { segments: 16 });
    assert.strictEqual(mesh.faceCount, 3);
    assert.ok(mesh.surfaceTypes.includes("CYLINDRICAL_SURFACE"));
    assert.ok(mesh.surfaceTypes.includes("SPHERICAL_SURFACE"));
    assert.ok(mesh.surfaceTypes.includes("TOROIDAL_SURFACE"));
    assert.ok(mesh.triangleCount > 100);
  });

  it("evaluates tensor-product B_SPLINE_SURFACE_WITH_KNOTS control point grids", () => {
    const stepText = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('NURBS Patch'), '2;1');
FILE_NAME('nurbs.step', '2026-10-30', ('ModelScript'), ('ModelScript'), '', '', '');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('P00', (0.0, 0.0, 0.0));
#11 = CARTESIAN_POINT('P01', (0.0, 5.0, 2.0));
#12 = CARTESIAN_POINT('P02', (0.0, 10.0, 0.0));
#13 = CARTESIAN_POINT('P10', (5.0, 0.0, 2.0));
#14 = CARTESIAN_POINT('P11', (5.0, 5.0, 6.0));
#15 = CARTESIAN_POINT('P12', (5.0, 10.0, 2.0));
#16 = CARTESIAN_POINT('P20', (10.0, 0.0, 0.0));
#17 = CARTESIAN_POINT('P21', (10.0, 5.0, 2.0));
#18 = CARTESIAN_POINT('P22', (10.0, 10.0, 0.0));

#20 = B_SPLINE_SURFACE_WITH_KNOTS('DomePatch', 2, 2, ((#10, #11, #12), (#13, #14, #15), (#16, #17, #18)), .UNSPECIFIED., .F., .F., .F., (3, 3), (3, 3), (0.0, 1.0), (0.0, 1.0), .UNSPECIFIED.);
#21 = POLY_LOOP('Boundary', (#10, #16, #18, #12));
#22 = FACE_OUTER_BOUND('Outer', #21, .T.);
#23 = ADVANCED_FACE('SplineFace', (#22), #20, .T.);
#24 = CLOSED_SHELL('SplineShell', (#23));
#25 = MANIFOLD_SOLID_BREP('SplineSolid', #24);
ENDSEC;
END-ISO-10303-21;`;

    const mesh = tessellateStepSolid(stepText, { segments: 16 });
    assert.strictEqual(mesh.faceCount, 1);
    assert.ok(mesh.surfaceTypes.includes("B_SPLINE_SURFACE_WITH_KNOTS"));
    assert.ok(mesh.triangleCount >= 32);
    // Peak of quadratic Bezier dome at (0.5, 0.5) should have Z > 1.5
    assert.ok(mesh.boundingBox.max[2] > 1.5, `Expected dome Z peak > 1.5, got ${mesh.boundingBox.max[2]}`);
  });
});
