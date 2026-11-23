// SPDX-License-Identifier: AGPL-3.0-or-later

import { DxfErrorCode } from "../errors.js";
import type {
  Dxf3DFaceEntity,
  DxfArcEntity,
  DxfBlock,
  DxfCircleEntity,
  DxfDocument,
  DxfEllipseEntity,
  DxfEntity,
  DxfGroupPair,
  DxfHeaderVariables,
  DxfInsertEntity,
  DxfLayerRecord,
  DxfLineEntity,
  DxfLwPolylineEntity,
  DxfLwPolylineVertex,
  DxfObjectRecord,
  DxfParseError,
  DxfPoint3D,
  DxfPointEntity,
  DxfPolylineEntity,
  DxfSectionRecord,
  DxfSplineEntity,
  DxfTable,
  DxfTextEntity,
} from "../types.js";

function toFloat(v: string, fallback = 0): number {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v: string, fallback = 0): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

interface RawLine {
  text: string;
  lineNumber: number;
  startOffset: number;
  endOffset: number;
}

function splitLinesWithOffsets(source: string): RawLine[] {
  const out: RawLine[] = [];
  let offset = 0;
  let lineNum = 1;
  while (offset <= source.length) {
    let nl = source.indexOf("\n", offset);
    if (nl === -1) nl = source.length;
    const raw = source.slice(offset, nl);
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    out.push({ text, lineNumber: lineNum, startOffset: offset, endOffset: nl });
    if (nl === source.length) break;
    offset = nl + 1;
    lineNum++;
  }
  return out;
}

/**
 * Tokenizes an ASCII DXF stream into group-code / value pairs while recording
 * line numbers, byte offsets, and syntax errors for invalid group codes.
 */
export function tokenizeDxfPairs(source: string): { pairs: DxfGroupPair[]; errors: DxfParseError[] } {
  const lines = splitLinesWithOffsets(source);
  const pairs: DxfGroupPair[] = [];
  const errors: DxfParseError[] = [];

  // Trim trailing completely empty lines at EOF
  let endIdx = lines.length;
  while (endIdx > 0 && lines[endIdx - 1]!.text.trim() === "") {
    endIdx--;
  }

  let i = 0;
  while (i < endIdx) {
    const codeLine = lines[i]!;
    const trimmedCode = codeLine.text.trim();
    if (trimmedCode === "" && i === 0) {
      i++;
      continue;
    }

    if (!/^[+-]?\d+$/.test(trimmedCode)) {
      errors.push({
        code: DxfErrorCode.SYNTAX_ERROR.id,
        message: DxfErrorCode.SYNTAX_ERROR.message(
          `invalid group code '${trimmedCode}' at line ${codeLine.lineNumber}`,
        ),
        line: codeLine.lineNumber,
      });
      i++;
      continue;
    }

    const code = Number.parseInt(trimmedCode, 10);
    if (i + 1 >= endIdx) {
      errors.push({
        code: DxfErrorCode.SYNTAX_ERROR.id,
        message: DxfErrorCode.SYNTAX_ERROR.message(
          `group code '${code}' at line ${codeLine.lineNumber} is missing its value line`,
        ),
        line: codeLine.lineNumber,
      });
      break;
    }

    const valLine = lines[i + 1]!;
    // Preserve leading/trailing spaces only for text values (codes 1, 3, 300-309); trim structural/numeric values
    const isTextCode = code === 1 || code === 3 || (code >= 300 && code <= 309);
    const value = isTextCode ? valLine.text : valLine.text.trim();

    pairs.push({
      code,
      value,
      line: codeLine.lineNumber,
      startOffset: codeLine.startOffset,
      endOffset: valLine.endOffset,
    });
    i += 2;
  }

  return { pairs, errors };
}

function parseEntityFromPairs(
  entityType: string,
  pairs: DxfGroupPair[],
  startLine: number,
  startOffset: number,
  endOffset: number,
): DxfEntity | null {
  let handle: string | undefined;
  let layer = "0";
  let color: number | undefined;
  let lineType: string | undefined;
  let extrusion: DxfPoint3D | undefined;

  for (const p of pairs) {
    if (p.code === 5) handle = p.value;
    else if (p.code === 8) layer = p.value || "0";
    else if (p.code === 62) color = toInt(p.value, 256);
    else if (p.code === 6) lineType = p.value;
    else if (p.code === 210) {
      extrusion = extrusion ?? { x: 0, y: 0, z: 1 };
      extrusion.x = toFloat(p.value, 0);
    } else if (p.code === 220) {
      extrusion = extrusion ?? { x: 0, y: 0, z: 1 };
      extrusion.y = toFloat(p.value, 0);
    } else if (p.code === 230) {
      extrusion = extrusion ?? { x: 0, y: 0, z: 1 };
      extrusion.z = toFloat(p.value, 1);
    }
  }

  const base = { handle, layer, color, lineType, extrusion, line: startLine, startOffset, endOffset };

  switch (entityType) {
    case "LINE": {
      const start: DxfPoint3D = { x: 0, y: 0, z: 0 };
      const end: DxfPoint3D = { x: 0, y: 0, z: 0 };
      for (const p of pairs) {
        if (p.code === 10) start.x = toFloat(p.value);
        else if (p.code === 20) start.y = toFloat(p.value);
        else if (p.code === 30) start.z = toFloat(p.value);
        else if (p.code === 11) end.x = toFloat(p.value);
        else if (p.code === 21) end.y = toFloat(p.value);
        else if (p.code === 31) end.z = toFloat(p.value);
      }
      const ent: DxfLineEntity = { ...base, type: "LINE", start, end };
      return ent;
    }

    case "CIRCLE": {
      const center: DxfPoint3D = { x: 0, y: 0, z: 0 };
      let radius = 0;
      for (const p of pairs) {
        if (p.code === 10) center.x = toFloat(p.value);
        else if (p.code === 20) center.y = toFloat(p.value);
        else if (p.code === 30) center.z = toFloat(p.value);
        else if (p.code === 40) radius = toFloat(p.value);
      }
      const ent: DxfCircleEntity = { ...base, type: "CIRCLE", center, radius };
      return ent;
    }

    case "ARC": {
      const center: DxfPoint3D = { x: 0, y: 0, z: 0 };
      let radius = 0;
      let startAngle = 0;
      let endAngle = 360;
      for (const p of pairs) {
        if (p.code === 10) center.x = toFloat(p.value);
        else if (p.code === 20) center.y = toFloat(p.value);
        else if (p.code === 30) center.z = toFloat(p.value);
        else if (p.code === 40) radius = toFloat(p.value);
        else if (p.code === 50) startAngle = toFloat(p.value);
        else if (p.code === 51) endAngle = toFloat(p.value);
      }
      const ent: DxfArcEntity = { ...base, type: "ARC", center, radius, startAngle, endAngle };
      return ent;
    }

    case "LWPOLYLINE": {
      const vertices: DxfLwPolylineVertex[] = [];
      let current: DxfLwPolylineVertex | null = null;
      let closed = false;
      let elevation = 0;
      let constantWidth: number | undefined;
      for (const p of pairs) {
        if (p.code === 70) {
          closed = (toInt(p.value, 0) & 1) !== 0;
        } else if (p.code === 38) {
          elevation = toFloat(p.value);
        } else if (p.code === 43) {
          constantWidth = toFloat(p.value);
        } else if (p.code === 10) {
          current = { x: toFloat(p.value), y: 0, bulge: 0 };
          vertices.push(current);
        } else if (p.code === 20 && current) {
          current.y = toFloat(p.value);
        } else if (p.code === 42 && current) {
          current.bulge = toFloat(p.value);
        } else if (p.code === 40 && current) {
          current.startWidth = toFloat(p.value);
        } else if (p.code === 41 && current) {
          current.endWidth = toFloat(p.value);
        }
      }
      const ent: DxfLwPolylineEntity = {
        ...base,
        type: "LWPOLYLINE",
        vertices,
        closed,
        elevation,
        constantWidth,
      };
      return ent;
    }

    case "SPLINE": {
      let degree = 3;
      let flags = 0;
      const knots: number[] = [];
      const controlPoints: DxfPoint3D[] = [];
      const fitPoints: DxfPoint3D[] = [];
      const weights: number[] = [];
      let curCtrl: DxfPoint3D | null = null;
      let curFit: DxfPoint3D | null = null;
      for (const p of pairs) {
        if (p.code === 70) flags = toInt(p.value);
        else if (p.code === 71) degree = toInt(p.value, 3);
        else if (p.code === 40) knots.push(toFloat(p.value));
        else if (p.code === 41) weights.push(toFloat(p.value, 1));
        else if (p.code === 10) {
          curCtrl = { x: toFloat(p.value), y: 0, z: 0 };
          controlPoints.push(curCtrl);
        } else if (p.code === 20 && curCtrl) curCtrl.y = toFloat(p.value);
        else if (p.code === 30 && curCtrl) curCtrl.z = toFloat(p.value);
        else if (p.code === 11) {
          curFit = { x: toFloat(p.value), y: 0, z: 0 };
          fitPoints.push(curFit);
        } else if (p.code === 21 && curFit) curFit.y = toFloat(p.value);
        else if (p.code === 31 && curFit) curFit.z = toFloat(p.value);
      }
      const ent: DxfSplineEntity = {
        ...base,
        type: "SPLINE",
        degree,
        flags,
        closed: (flags & 1) !== 0,
        periodic: (flags & 2) !== 0,
        rational: (flags & 4) !== 0,
        knots,
        controlPoints,
        fitPoints,
        weights,
      };
      return ent;
    }

    case "ELLIPSE": {
      const center: DxfPoint3D = { x: 0, y: 0, z: 0 };
      const majorAxisEndpoint: DxfPoint3D = { x: 1, y: 0, z: 0 };
      let ratio = 1;
      let startParam = 0;
      let endParam = Math.PI * 2;
      for (const p of pairs) {
        if (p.code === 10) center.x = toFloat(p.value);
        else if (p.code === 20) center.y = toFloat(p.value);
        else if (p.code === 30) center.z = toFloat(p.value);
        else if (p.code === 11) majorAxisEndpoint.x = toFloat(p.value);
        else if (p.code === 21) majorAxisEndpoint.y = toFloat(p.value);
        else if (p.code === 31) majorAxisEndpoint.z = toFloat(p.value);
        else if (p.code === 40) ratio = toFloat(p.value);
        else if (p.code === 41) startParam = toFloat(p.value);
        else if (p.code === 42) endParam = toFloat(p.value);
      }
      const ent: DxfEllipseEntity = {
        ...base,
        type: "ELLIPSE",
        center,
        majorAxisEndpoint,
        ratio,
        startParam,
        endParam,
      };
      return ent;
    }

    case "3DFACE": {
      const v0: DxfPoint3D = { x: 0, y: 0, z: 0 };
      const v1: DxfPoint3D = { x: 0, y: 0, z: 0 };
      const v2: DxfPoint3D = { x: 0, y: 0, z: 0 };
      const v3: DxfPoint3D = { x: 0, y: 0, z: 0 };
      let hasV3 = false;
      let invisibleEdgeFlags = 0;
      for (const p of pairs) {
        if (p.code === 10) v0.x = toFloat(p.value);
        else if (p.code === 20) v0.y = toFloat(p.value);
        else if (p.code === 30) v0.z = toFloat(p.value);
        else if (p.code === 11) v1.x = toFloat(p.value);
        else if (p.code === 21) v1.y = toFloat(p.value);
        else if (p.code === 31) v1.z = toFloat(p.value);
        else if (p.code === 12) v2.x = toFloat(p.value);
        else if (p.code === 22) v2.y = toFloat(p.value);
        else if (p.code === 32) v2.z = toFloat(p.value);
        else if (p.code === 13) {
          v3.x = toFloat(p.value);
          hasV3 = true;
        } else if (p.code === 23) {
          v3.y = toFloat(p.value);
          hasV3 = true;
        } else if (p.code === 33) {
          v3.z = toFloat(p.value);
          hasV3 = true;
        } else if (p.code === 70) invisibleEdgeFlags = toInt(p.value);
      }
      const fourth = hasV3 ? v3 : { ...v2 };
      const ent: Dxf3DFaceEntity = {
        ...base,
        type: "3DFACE",
        vertices: [v0, v1, v2, fourth],
        invisibleEdgeFlags,
      };
      return ent;
    }

    case "POINT": {
      const position: DxfPoint3D = { x: 0, y: 0, z: 0 };
      for (const p of pairs) {
        if (p.code === 10) position.x = toFloat(p.value);
        else if (p.code === 20) position.y = toFloat(p.value);
        else if (p.code === 30) position.z = toFloat(p.value);
      }
      const ent: DxfPointEntity = { ...base, type: "POINT", position };
      return ent;
    }

    case "TEXT":
    case "MTEXT": {
      const position: DxfPoint3D = { x: 0, y: 0, z: 0 };
      let height = 2.5;
      let rotation = 0;
      let text = "";
      let style: string | undefined;
      for (const p of pairs) {
        if (p.code === 10) position.x = toFloat(p.value);
        else if (p.code === 20) position.y = toFloat(p.value);
        else if (p.code === 30) position.z = toFloat(p.value);
        else if (p.code === 40) height = toFloat(p.value, 2.5);
        else if (p.code === 50) rotation = toFloat(p.value, 0);
        else if (p.code === 1 || p.code === 3) text += p.value;
        else if (p.code === 7) style = p.value;
      }
      const ent: DxfTextEntity = { ...base, type: entityType, position, height, rotation, text, style };
      return ent;
    }

    case "INSERT": {
      let blockName = "";
      const position: DxfPoint3D = { x: 0, y: 0, z: 0 };
      let scaleX = 1;
      let scaleY = 1;
      let scaleZ = 1;
      let rotation = 0;
      let rowCount = 1;
      let columnCount = 1;
      let rowSpacing = 0;
      let columnSpacing = 0;
      for (const p of pairs) {
        if (p.code === 2) blockName = p.value;
        else if (p.code === 10) position.x = toFloat(p.value);
        else if (p.code === 20) position.y = toFloat(p.value);
        else if (p.code === 30) position.z = toFloat(p.value);
        else if (p.code === 41) scaleX = toFloat(p.value, 1);
        else if (p.code === 42) scaleY = toFloat(p.value, 1);
        else if (p.code === 43) scaleZ = toFloat(p.value, 1);
        else if (p.code === 50) rotation = toFloat(p.value, 0);
        else if (p.code === 70) columnCount = Math.max(1, toInt(p.value, 1));
        else if (p.code === 71) rowCount = Math.max(1, toInt(p.value, 1));
        else if (p.code === 44) columnSpacing = toFloat(p.value, 0);
        else if (p.code === 45) rowSpacing = toFloat(p.value, 0);
      }
      const ent: DxfInsertEntity = {
        ...base,
        type: "INSERT",
        blockName,
        position,
        scaleX,
        scaleY,
        scaleZ,
        rotation,
        rowCount,
        columnCount,
        rowSpacing,
        columnSpacing,
      };
      return ent;
    }

    default:
      return null;
  }
}

function parseEntitiesList(sectionPairs: DxfGroupPair[]): DxfEntity[] {
  const entities: DxfEntity[] = [];
  let i = 0;
  while (i < sectionPairs.length) {
    const p = sectionPairs[i]!;
    if (p.code !== 0) {
      i++;
      continue;
    }
    const entityType = p.value.toUpperCase();
    const startLine = p.line;
    const startOffset = p.startOffset;
    i++;

    const body: DxfGroupPair[] = [];
    let endOffset = p.endOffset;
    while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
      body.push(sectionPairs[i]!);
      endOffset = sectionPairs[i]!.endOffset;
      i++;
    }

    if (entityType === "POLYLINE") {
      let handle: string | undefined;
      let layer = "0";
      let color: number | undefined;
      let lineType: string | undefined;
      let flags = 0;
      for (const bp of body) {
        if (bp.code === 5) handle = bp.value;
        else if (bp.code === 8) layer = bp.value || "0";
        else if (bp.code === 62) color = toInt(bp.value, 256);
        else if (bp.code === 6) lineType = bp.value;
        else if (bp.code === 70) flags = toInt(bp.value, 0);
      }

      const vertices: DxfPoint3D[] = [];
      const bulges: number[] = [];
      let hasSeqEnd = false;

      while (i < sectionPairs.length) {
        const sub = sectionPairs[i]!;
        if (sub.code !== 0) {
          i++;
          continue;
        }
        const subType = sub.value.toUpperCase();
        if (subType === "VERTEX") {
          i++;
          const pt: DxfPoint3D = { x: 0, y: 0, z: 0 };
          let bulge = 0;
          while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
            const vp = sectionPairs[i]!;
            if (vp.code === 10) pt.x = toFloat(vp.value);
            else if (vp.code === 20) pt.y = toFloat(vp.value);
            else if (vp.code === 30) pt.z = toFloat(vp.value);
            else if (vp.code === 42) bulge = toFloat(vp.value);
            endOffset = vp.endOffset;
            i++;
          }
          vertices.push(pt);
          bulges.push(bulge);
        } else if (subType === "SEQEND") {
          hasSeqEnd = true;
          endOffset = sub.endOffset;
          i++;
          while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
            endOffset = sectionPairs[i]!.endOffset;
            i++;
          }
          break;
        } else {
          break;
        }
      }

      const poly: DxfPolylineEntity = {
        type: "POLYLINE",
        handle,
        layer,
        color,
        lineType,
        vertices,
        bulges,
        closed: (flags & 1) !== 0,
        is3D: (flags & 8) !== 0,
        hasSeqEnd,
        line: startLine,
        startOffset,
        endOffset,
      };
      entities.push(poly);
      continue;
    }

    const parsed = parseEntityFromPairs(entityType, body, startLine, startOffset, endOffset);
    if (parsed) {
      entities.push(parsed);
    }
  }
  return entities;
}

function parseHeaderSection(sectionPairs: DxfGroupPair[]): DxfHeaderVariables {
  const header: DxfHeaderVariables = { variables: {} };
  let currentVar: string | null = null;
  for (const p of sectionPairs) {
    if (p.code === 9) {
      currentVar = p.value.toUpperCase();
      if (!header.variables[currentVar]) {
        header.variables[currentVar] = [];
      }
    } else if (currentVar) {
      header.variables[currentVar]!.push({ code: p.code, value: p.value, line: p.line });
      if (currentVar === "$ACADVER" && p.code === 1) {
        header.acadVer = p.value;
      } else if (currentVar === "$INSUNITS" && p.code === 70) {
        header.insUnits = Number(p.value);
      } else if (currentVar === "$MEASUREMENT" && p.code === 70) {
        header.measurement = toInt(p.value);
      } else if (currentVar === "$CLAYER" && p.code === 8) {
        header.clayer = p.value;
      } else if (currentVar === "$EXTMIN") {
        header.extMin = header.extMin ?? { x: 0, y: 0, z: 0 };
        if (p.code === 10) header.extMin.x = toFloat(p.value);
        else if (p.code === 20) header.extMin.y = toFloat(p.value);
        else if (p.code === 30) header.extMin.z = toFloat(p.value);
      } else if (currentVar === "$EXTMAX") {
        header.extMax = header.extMax ?? { x: 0, y: 0, z: 0 };
        if (p.code === 10) header.extMax.x = toFloat(p.value);
        else if (p.code === 20) header.extMax.y = toFloat(p.value);
        else if (p.code === 30) header.extMax.z = toFloat(p.value);
      }
    }
  }
  return header;
}

function parseTablesSection(
  sectionPairs: DxfGroupPair[],
  layers: Map<string, DxfLayerRecord>,
  duplicateLayers: Array<{ name: string; line: number }>,
): DxfTable[] {
  const tables: DxfTable[] = [];
  let i = 0;
  while (i < sectionPairs.length) {
    const p = sectionPairs[i]!;
    if (p.code === 0 && p.value.toUpperCase() === "TABLE") {
      const tableLine = p.line;
      i++;
      let tableName = "";
      const tableLayers: DxfLayerRecord[] = [];
      let entryCount = 0;

      // Read table header pairs until next code 0
      while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
        if (sectionPairs[i]!.code === 2) tableName = sectionPairs[i]!.value.toUpperCase();
        i++;
      }

      while (i < sectionPairs.length) {
        const ep = sectionPairs[i]!;
        if (ep.code === 0 && ep.value.toUpperCase() === "ENDTAB") {
          i++;
          break;
        }
        if (ep.code === 0) {
          const recType = ep.value.toUpperCase();
          const recLine = ep.line;
          const recStart = ep.startOffset;
          let recEnd = ep.endOffset;
          i++;
          entryCount++;

          const recPairs: DxfGroupPair[] = [];
          while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
            recPairs.push(sectionPairs[i]!);
            recEnd = sectionPairs[i]!.endOffset;
            i++;
          }

          if (recType === "LAYER") {
            let name = "";
            let color = 7;
            let lineType = "CONTINUOUS";
            let flags = 0;
            for (const rp of recPairs) {
              if (rp.code === 2) name = rp.value;
              else if (rp.code === 62) color = toInt(rp.value, 7);
              else if (rp.code === 6) lineType = rp.value;
              else if (rp.code === 70) flags = toInt(rp.value, 0);
            }
            if (name) {
              const rec: DxfLayerRecord = {
                name,
                color: Math.abs(color),
                lineType,
                flags,
                frozen: (flags & 1) !== 0,
                off: color < 0,
                locked: (flags & 4) !== 0,
                line: recLine,
                startOffset: recStart,
                endOffset: recEnd,
              };
              tableLayers.push(rec);
              if (layers.has(name)) {
                duplicateLayers.push({ name, line: recLine });
              } else {
                layers.set(name, rec);
              }
            }
          }
        } else {
          i++;
        }
      }

      tables.push({ name: tableName, layers: tableLayers, entryCount, line: tableLine });
    } else {
      i++;
    }
  }
  return tables;
}

function parseBlocksSection(
  sectionPairs: DxfGroupPair[],
  blocks: Map<string, DxfBlock>,
  duplicateBlocks: Array<{ name: string; line: number }>,
): void {
  let i = 0;
  while (i < sectionPairs.length) {
    const p = sectionPairs[i]!;
    if (p.code === 0 && p.value.toUpperCase() === "BLOCK") {
      const startLine = p.line;
      const startOffset = p.startOffset;
      let endLine = startLine;
      let endOffset = p.endOffset;
      i++;

      let name = "";
      let layer = "0";
      let flags = 0;
      const basePoint: DxfPoint3D = { x: 0, y: 0, z: 0 };

      while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
        const bp = sectionPairs[i]!;
        if (bp.code === 2) name = bp.value;
        else if (bp.code === 8) layer = bp.value || "0";
        else if (bp.code === 70) flags = toInt(bp.value, 0);
        else if (bp.code === 10) basePoint.x = toFloat(bp.value);
        else if (bp.code === 20) basePoint.y = toFloat(bp.value);
        else if (bp.code === 30) basePoint.z = toFloat(bp.value);
        endLine = bp.line;
        endOffset = bp.endOffset;
        i++;
      }

      const entityPairs: DxfGroupPair[] = [];
      let closed = false;
      while (i < sectionPairs.length) {
        const ep = sectionPairs[i]!;
        if (ep.code === 0 && ep.value.toUpperCase() === "ENDBLK") {
          closed = true;
          endLine = ep.line;
          endOffset = ep.endOffset;
          i++;
          while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
            endLine = sectionPairs[i]!.line;
            endOffset = sectionPairs[i]!.endOffset;
            i++;
          }
          break;
        }
        if (ep.code === 0 && ep.value.toUpperCase() === "BLOCK") {
          break;
        }
        entityPairs.push(ep);
        endLine = ep.line;
        endOffset = ep.endOffset;
        i++;
      }

      const blockEntities = parseEntitiesList(entityPairs);
      const blk: DxfBlock = {
        name,
        layer,
        basePoint,
        flags,
        entities: blockEntities,
        closed,
        line: startLine,
        endLine,
        startOffset,
        endOffset,
      };
      if (name) {
        if (blocks.has(name)) {
          duplicateBlocks.push({ name, line: startLine });
        } else {
          blocks.set(name, blk);
        }
      }
    } else {
      i++;
    }
  }
}

function parseObjectsSection(sectionPairs: DxfGroupPair[]): DxfObjectRecord[] {
  const objects: DxfObjectRecord[] = [];
  let i = 0;
  while (i < sectionPairs.length) {
    const p = sectionPairs[i]!;
    if (p.code === 0) {
      const type = p.value.toUpperCase();
      const line = p.line;
      let handle: string | undefined;
      i++;
      while (i < sectionPairs.length && sectionPairs[i]!.code !== 0) {
        if (sectionPairs[i]!.code === 5) handle = sectionPairs[i]!.value;
        i++;
      }
      objects.push({ type, handle, line });
    } else {
      i++;
    }
  }
  return objects;
}

/**
 * Parses an ASCII AutoCAD DXF document into a structured {@link DxfDocument}.
 */
export function parseDxf(source: string): DxfDocument {
  const { pairs, errors } = tokenizeDxfPairs(source);

  let header: DxfHeaderVariables = { variables: {} };
  const tables: DxfTable[] = [];
  const layers = new Map<string, DxfLayerRecord>();
  const duplicateLayers: Array<{ name: string; line: number }> = [];
  const blocks = new Map<string, DxfBlock>();
  const duplicateBlocks: Array<{ name: string; line: number }> = [];
  let entities: DxfEntity[] = [];
  let objects: DxfObjectRecord[] = [];
  const sections: DxfSectionRecord[] = [];
  let hasEof = false;

  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i]!;
    if (p.code === 0 && p.value.toUpperCase() === "EOF") {
      hasEof = true;
      break;
    }

    if (p.code === 0 && p.value.toUpperCase() === "ENDSEC") {
      errors.push({
        code: DxfErrorCode.UNEXPECTED_ENDSEC.id,
        message: DxfErrorCode.UNEXPECTED_ENDSEC.message(),
        line: p.line,
      });
      i++;
      continue;
    }

    if (p.code === 0 && p.value.toUpperCase() === "SECTION") {
      const startLine = p.line;
      i++;
      let sectionName = "UNKNOWN";
      if (i < pairs.length && pairs[i]!.code === 2) {
        sectionName = pairs[i]!.value.toUpperCase();
        i++;
      }

      const bodyPairs: DxfGroupPair[] = [];
      let closed = false;
      let endLine = startLine;

      while (i < pairs.length) {
        const cur = pairs[i]!;
        if (cur.code === 0 && cur.value.toUpperCase() === "ENDSEC") {
          closed = true;
          endLine = cur.line;
          i++;
          break;
        }
        if (cur.code === 0 && (cur.value.toUpperCase() === "EOF" || cur.value.toUpperCase() === "SECTION")) {
          break;
        }
        bodyPairs.push(cur);
        endLine = cur.line;
        i++;
      }

      sections.push({
        name: sectionName,
        startLine,
        endLine,
        closed,
        pairCount: bodyPairs.length,
      });

      if (sectionName === "HEADER") {
        header = parseHeaderSection(bodyPairs);
      } else if (sectionName === "TABLES") {
        tables.push(...parseTablesSection(bodyPairs, layers, duplicateLayers));
      } else if (sectionName === "BLOCKS") {
        parseBlocksSection(bodyPairs, blocks, duplicateBlocks);
      } else if (sectionName === "ENTITIES") {
        entities = entities.concat(parseEntitiesList(bodyPairs));
      } else if (sectionName === "OBJECTS") {
        objects = objects.concat(parseObjectsSection(bodyPairs));
      }
      continue;
    }

    i++;
  }

  return {
    header,
    tables,
    layers,
    duplicateLayers,
    blocks,
    duplicateBlocks,
    entities,
    objects,
    sections,
    hasEof,
    parseErrors: errors,
    groupPairs: pairs,
    source,
  };
}
