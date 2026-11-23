// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIgesFile,
  formatHollerith,
  formatIgesLine,
  parseHollerith,
  parseIges,
  parseIgesNumber,
} from "../src/index.js";

describe("@modelscript/iges — Fixed 80-Column IGES 5.3 Parser & Serializer", () => {
  it("parses Hollerith strings and Fortran D-exponent numbers accurately", () => {
    assert.deepEqual(parseHollerith("5HModel"), { value: "Model", valid: true });
    assert.deepEqual(parseHollerith("1H,"), { value: ",", valid: true });
    assert.equal(parseHollerith("4HHello").valid, false);
    assert.equal(parseHollerith("ABC").valid, false);
    assert.equal(formatHollerith("IGES 5.3"), "8HIGES 5.3");

    assert.equal(parseIgesNumber("1.25D+02"), 125);
    assert.equal(parseIgesNumber("-3.5d-2"), -0.035);
    assert.equal(parseIgesNumber("  42.5  "), 42.5);
    assert.equal(parseIgesNumber("", 7), 7);
  });

  it("formats strictly 80-column IGES records", () => {
    const line = formatIgesLine("Start comment", "S", 1);
    assert.equal(line.length, 80);
    assert.equal(line[72], "S");
    assert.equal(line.slice(73, 80), "      1");
  });

  it("parses Start, Global, Directory Entry, Parameter Data, and Terminate sections", () => {
    const iges = buildIgesFile({
      startComment: "Bracket Geometry IGES 5.3",
      productId: "BRACKET_01",
      fileName: "bracket.igs",
      author: "Ada Lovelace",
      organization: "Analytical CAD",
      unitFlag: 2, // millimeters
      entities: [
        { entityType: 116, label: "PT1", params: [10.0, 20.0, 30.0, 0] },
        { entityType: 110, label: "EDGE1", params: [0.0, 0.0, 0.0, 100.0, 0.0, 0.0] },
        { entityType: 100, label: "HOLE1", params: [0.0, 50.0, 25.0, 60.0, 25.0, 60.0, 25.0] },
      ],
    });

    const doc = parseIges(iges);
    assert.equal(doc.parseIssues.length, 0);
    assert.equal(doc.startLines.length, 1);
    assert.ok(doc.startLines[0]!.includes("Bracket Geometry IGES 5.3"));

    assert.ok(doc.global);
    assert.equal(doc.global.parameterDelimiter, ",");
    assert.equal(doc.global.recordDelimiter, ";");
    assert.equal(doc.global.productIdSender, "BRACKET_01");
    assert.equal(doc.global.fileName, "bracket.igs");
    assert.equal(doc.global.unitFlag, 2);
    assert.equal(doc.global.unitName, "MM");
    assert.equal(doc.global.authorName, "Ada Lovelace");

    assert.equal(doc.directoryEntries.size, 3);
    assert.equal(doc.entities.length, 3);

    const pt = doc.entitiesByDe.get(1);
    assert.ok(pt && !("rawParams" in pt) && pt.entityType === 116);
    assert.deepEqual(pt.point, [10, 20, 30]);
    assert.equal(pt.label, "PT1");

    const line = doc.entitiesByDe.get(3);
    assert.ok(line && !("rawParams" in line) && line.entityType === 110);
    assert.deepEqual(line.start, [0, 0, 0]);
    assert.deepEqual(line.end, [100, 0, 0]);

    const arc = doc.entitiesByDe.get(5);
    assert.ok(arc && !("rawParams" in arc) && arc.entityType === 100);
    assert.deepEqual(arc.center, [50, 25]);
    assert.deepEqual(arc.start, [60, 25]);
    assert.deepEqual(arc.end, [60, 25]);

    assert.ok(doc.terminate);
    assert.equal(doc.terminate.startCount, doc.sectionCounts.S);
    assert.equal(doc.terminate.globalCount, doc.sectionCounts.G);
    assert.equal(doc.terminate.directoryCount, doc.sectionCounts.D);
    assert.equal(doc.terminate.parameterCount, doc.sectionCounts.P);
  });

  it("decodes multi-line Parameter Data for Type 124, 126 NURBS curve, 128 NURBS surface, and 186 B-Rep", () => {
    const w = Math.SQRT1_2;
    const iges = buildIgesFile({
      unitFlag: 6,
      entities: [
        // D1: Type 124 Transform Matrix (translation [1, 2, 3])
        {
          entityType: 124,
          label: "XFRM1",
          params: [1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3],
        },
        // D3: Type 126 Quadratic NURBS quarter-circle
        {
          entityType: 126,
          label: "QARC",
          transformMatrixPointer: 1,
          params: [2, 2, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, w, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        },
        // D5: Type 128 Bilinear NURBS unit square surface
        {
          entityType: 128,
          label: "PATCH",
          params: [
            1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0,
            1,
          ],
        },
        // D7: Type 102 Composite Curve referencing D3
        {
          entityType: 102,
          label: "COMP",
          params: [1, 3],
        },
        // D9: Type 186 Manifold Solid B-Rep
        {
          entityType: 186,
          label: "SOLID1",
          params: [5, 1, 0],
        },
      ],
    });

    const doc = parseIges(iges);
    assert.equal(doc.parseIssues.length, 0);
    assert.equal(doc.entities.length, 5);

    const xfrm = doc.entitiesByDe.get(1);
    assert.ok(xfrm && !("rawParams" in xfrm) && xfrm.entityType === 124);
    assert.deepEqual(xfrm.translation, [1, 2, 3]);

    const nurbs = doc.entitiesByDe.get(3);
    assert.ok(nurbs && !("rawParams" in nurbs) && nurbs.entityType === 126);
    assert.equal(nurbs.k, 2);
    assert.equal(nurbs.m, 2);
    assert.equal(nurbs.transformMatrixPointer, 1);
    assert.equal(nurbs.knots.length, 6);
    assert.equal(nurbs.controlPoints.length, 3);
    assert.ok(Math.abs(nurbs.weights[1]! - Math.SQRT1_2) < 1e-12);

    const surf = doc.entitiesByDe.get(5);
    assert.ok(surf && !("rawParams" in surf) && surf.entityType === 128);
    assert.equal(surf.k1, 1);
    assert.equal(surf.k2, 1);
    assert.equal(surf.controlPoints.length, 4);

    const comp = doc.entitiesByDe.get(7);
    assert.ok(comp && !("rawParams" in comp) && comp.entityType === 102);
    assert.deepEqual(comp.constituentPointers, [3]);

    const brep = doc.entitiesByDe.get(9);
    assert.ok(brep && !("rawParams" in brep) && brep.entityType === 186);
    assert.equal(brep.outerShellPointer, 5);
    assert.equal(brep.outerShellOrientation, true);
  });

  it("decodes Copious Data (106), Plane (108), Surface of Revolution (120), Tabulated Cylinder (122), and Trimmed Surface (142/144)", () => {
    const iges = buildIgesFile({
      entities: [
        { entityType: 106, params: [2, 3, 0, 0, 0, 1, 0, 0, 1, 1, 0] },
        { entityType: 108, params: [0, 0, 1, 0, 0, 0, 0, 0, 1] },
        { entityType: 110, params: [0, 0, 0, 0, 0, 1] },
        { entityType: 120, params: [5, 1, 0, Math.PI] },
        { entityType: 122, params: [1, 0, 0, 2] },
        { entityType: 142, params: [0, 7, 1, 1, 1] },
        { entityType: 144, params: [7, 1, 0, 11] },
      ],
    });

    const doc = parseIges(iges);
    assert.equal(doc.parseIssues.length, 0);

    const copious = doc.entitiesByDe.get(1);
    assert.ok(copious && !("rawParams" in copious) && copious.entityType === 106);
    assert.equal(copious.points.length, 3);

    const plane = doc.entitiesByDe.get(3);
    assert.ok(plane && !("rawParams" in plane) && plane.entityType === 108);
    assert.equal(plane.c, 1);

    const rev = doc.entitiesByDe.get(7);
    assert.ok(rev && !("rawParams" in rev) && rev.entityType === 120);
    assert.equal(rev.axisPointer, 5);

    const tab = doc.entitiesByDe.get(9);
    assert.ok(tab && !("rawParams" in tab) && tab.entityType === 122);
    assert.deepEqual(tab.directionEnd, [0, 0, 2]);

    const cos = doc.entitiesByDe.get(11);
    assert.ok(cos && !("rawParams" in cos) && cos.entityType === 142);
    assert.equal(cos.surfacePointer, 7);

    const trim = doc.entitiesByDe.get(13);
    assert.ok(trim && !("rawParams" in trim) && trim.entityType === 144);
    assert.equal(trim.outerBoundaryPointer, 11);
  });
});
