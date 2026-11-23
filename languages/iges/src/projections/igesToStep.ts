// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Projection from IGES 5.3 to ISO 10303-21 STEP AP214 (`AUTOMOTIVE_DESIGN`).
 */

import { applyTransform124, evaluateCircularArc, resolveEntityTransform } from "../cad/evaluator.js";
import { parseIges } from "../parser/iges-parser.js";
import type { IgesDocument, Point3D } from "../types.js";

export interface IgesToStepOptions {
  fileName?: string;
  author?: string;
  organization?: string;
  schema?: "AUTOMOTIVE_DESIGN" | "AP214" | "AP242_MANAGED_MODEL_BASED_3D_ENGINEERING";
}

function fmtNum(n: number): string {
  if (Object.is(n, -0) || Math.abs(n) < 1e-15) return "0.0";
  const s = Number(n.toFixed(9)).toString();
  return s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
}

function escapeStepStr(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Project an IGES 5.3 document to an ISO 10303-21 STEP AP214 file string.
 */
export function igesToStep(input: IgesDocument | string, options: IgesToStepOptions = {}): string {
  const doc = typeof input === "string" ? parseIges(input) : input;
  const fileName = escapeStepStr(options.fileName ?? doc.global?.fileName ?? "iges_export.stp");
  const author = escapeStepStr(options.author ?? doc.global?.authorName ?? "ModelScript");
  const org = escapeStepStr(options.organization ?? doc.global?.authorOrganization ?? "ModelScript");
  const schema = options.schema ?? "AUTOMOTIVE_DESIGN";

  const dataLines: string[] = [];
  let nextId = 1;
  const alloc = (body: string): number => {
    const id = nextId++;
    dataLines.push(`#${id}=${body};`);
    return id;
  };

  const emitPoint = (name: string, p: Point3D): number =>
    alloc(`CARTESIAN_POINT('${escapeStepStr(name)}',(${fmtNum(p[0])},${fmtNum(p[1])},${fmtNum(p[2])}))`);

  const emitDir = (name: string, d: Point3D): number => {
    const len = Math.hypot(d[0], d[1], d[2]);
    const u: Point3D = len > 1e-15 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, 1];
    return alloc(`DIRECTION('${escapeStepStr(name)}',(${fmtNum(u[0])},${fmtNum(u[1])},${fmtNum(u[2])}))`);
  };

  const shapeItemIds: number[] = [];

  for (const entity of doc.entities) {
    const tf = resolveEntityTransform(doc, entity);
    const label = entity.label || `D${entity.deNumber}`;

    if ("rawParams" in entity) continue;

    switch (entity.entityType) {
      case 116: {
        const p = applyTransform124(entity.point, tf);
        shapeItemIds.push(emitPoint(label, p));
        break;
      }

      case 110: {
        const p0 = applyTransform124(entity.start, tf);
        const p1 = applyTransform124(entity.end, tf);
        const dx = p1[0] - p0[0];
        const dy = p1[1] - p0[1];
        const dz = p1[2] - p0[2];
        const mag = Math.hypot(dx, dy, dz);
        const ptId = emitPoint(`${label}_START`, p0);
        const dirId = emitDir(`${label}_DIR`, [dx, dy, dz]);
        const vecId = alloc(`VECTOR('${escapeStepStr(label)}_VEC',#${dirId},${fmtNum(mag)})`);
        const lineId = alloc(`LINE('${escapeStepStr(label)}',#${ptId},#${vecId})`);
        shapeItemIds.push(lineId);
        break;
      }

      case 100: {
        const arc = evaluateCircularArc(entity, tf, 1.0, 16);
        const centerId = emitPoint(`${label}_CENTER`, arc.center);
        const zAxis: Point3D = [tf.rotation[0][2], tf.rotation[1][2], tf.rotation[2][2]];
        const xAxis: Point3D = [tf.rotation[0][0], tf.rotation[1][0], tf.rotation[2][0]];
        const zId = emitDir(`${label}_Z`, zAxis);
        const xId = emitDir(`${label}_X`, xAxis);
        const axisId = alloc(`AXIS2_PLACEMENT_3D('${escapeStepStr(label)}_AX',#${centerId},#${zId},#${xId})`);
        const circleId = alloc(`CIRCLE('${escapeStepStr(label)}',#${axisId},${fmtNum(arc.radius)})`);
        shapeItemIds.push(circleId);
        break;
      }

      case 126: {
        const ctrlIds = entity.controlPoints.map((pt, idx) =>
          emitPoint(`${label}_CP${idx}`, applyTransform124(pt, tf)),
        );
        // Group unique knots and multiplicities
        const uniqueKnots: number[] = [];
        const mults: number[] = [];
        for (const k of entity.knots) {
          if (uniqueKnots.length > 0 && Math.abs(uniqueKnots[uniqueKnots.length - 1]! - k) < 1e-12) {
            mults[mults.length - 1] = mults[mults.length - 1]! + 1;
          } else {
            uniqueKnots.push(k);
            mults.push(1);
          }
        }
        const ctrlRefs = ctrlIds.map((id) => `#${id}`).join(",");
        const multStr = mults.join(",");
        const knotStr = uniqueKnots.map(fmtNum).join(",");
        const weightStr = entity.weights.map(fmtNum).join(",");
        const closed = entity.closed ? ".T." : ".F.";
        const curveId = alloc(
          `(` +
            `BOUNDED_CURVE()` +
            `B_SPLINE_CURVE(${entity.m},(${ctrlRefs}),.UNSPECIFIED.,${closed},.F.)` +
            `B_SPLINE_CURVE_WITH_KNOTS((${multStr}),(${knotStr}),.UNSPECIFIED.)` +
            `CURVE()` +
            `GEOMETRIC_REPRESENTATION_ITEM()` +
            `RATIONAL_B_SPLINE_CURVE((${weightStr}))` +
            `REPRESENTATION_ITEM('${escapeStepStr(label)}')` +
            `)`,
        );
        shapeItemIds.push(curveId);
        break;
      }

      case 128: {
        const stride = entity.k1 + 1;
        const rows: string[] = [];
        for (let i = 0; i <= entity.k1; i++) {
          const rowIds: number[] = [];
          for (let j = 0; j <= entity.k2; j++) {
            const pt = entity.controlPoints[j * stride + i] ?? [0, 0, 0];
            rowIds.push(emitPoint(`${label}_CP_${i}_${j}`, applyTransform124(pt, tf)));
          }
          rows.push(`(${rowIds.map((id) => `#${id}`).join(",")})`);
        }
        const groupKnots = (knots: number[]): { u: number[]; m: number[] } => {
          const u: number[] = [];
          const m: number[] = [];
          for (const k of knots) {
            if (u.length > 0 && Math.abs(u[u.length - 1]! - k) < 1e-12) {
              m[m.length - 1] = m[m.length - 1]! + 1;
            } else {
              u.push(k);
              m.push(1);
            }
          }
          return { u, m };
        };
        const ku = groupKnots(entity.knotsU);
        const kv = groupKnots(entity.knotsV);
        const surfId = alloc(
          `B_SPLINE_SURFACE_WITH_KNOTS('${escapeStepStr(label)}',${entity.m1},${entity.m2},(${rows.join(",")}),.UNSPECIFIED.,${entity.closedU ? ".T." : ".F."},${entity.closedV ? ".T." : ".F."},.F.,(${ku.m.join(",")}),(${kv.m.join(",")}),(${ku.u.map(fmtNum).join(",")}),(${kv.u.map(fmtNum).join(",")}),.UNSPECIFIED.)`,
        );
        shapeItemIds.push(surfId);
        break;
      }

      case 186: {
        const shellId = alloc(`CLOSED_SHELL('${escapeStepStr(label)}_SHELL',())`);
        const brepId = alloc(`MANIFOLD_SOLID_BREP('${escapeStepStr(label)}',#${shellId})`);
        shapeItemIds.push(brepId);
        break;
      }

      default:
        break;
    }
  }

  const originId = emitPoint("ORIGIN", [0, 0, 0]);
  const zId = emitDir("AXIS_Z", [0, 0, 1]);
  const xId = emitDir("AXIS_X", [1, 0, 0]);
  const placementId = alloc(`AXIS2_PLACEMENT_3D('WORLD',#${originId},#${zId},#${xId})`);
  const ctxId = alloc(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${alloc(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.0E-6),#${alloc("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")},'distance_accuracy_value','IGES tolerance')`)}))GLOBAL_UNIT_ASSIGNED_CONTEXT((#${alloc("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))")}))REPRESENTATION_CONTEXT('IGES','3D'))`,
  );
  const allItems = [placementId, ...shapeItemIds].map((id) => `#${id}`).join(",");
  alloc(`SHAPE_REPRESENTATION('IGES_MODEL',(${allItems}),#${ctxId})`);

  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('Projected from IGES 5.3 by @modelscript/iges'),'2;1');`,
    `FILE_NAME('${fileName}','2026-01-01T00:00:00',('${author}'),('${org}'),'@modelscript/iges','ModelScript','');`,
    `FILE_SCHEMA(('${schema}'));`,
    "ENDSEC;",
    "DATA;",
  ];

  return [...header, ...dataLines, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
}
