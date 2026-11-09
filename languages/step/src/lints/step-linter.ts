// SPDX-License-Identifier: AGPL-3.0-or-later

import { StepErrorCode } from "../errors.js";
import { parseStepReferences, scanStepEntities } from "../schema.js";

export interface StepDiagnostic {
  code: string; // e.g. "T1001", "T1005"
  numericCode: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

const SUPPORTED_STEP_SCHEMA_RE =
  /AP203|AP214|AP242|AUTOMOTIVE_DESIGN|CONFIG_CONTROL_DESIGN|MANAGED_MODEL_BASED_3D_ENGINEERING|\b(?:203|214|242)\b/i;

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(offset: number, lineStarts: number[]): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = Math.max(0, low - 1);
  return {
    line: lineIdx + 1,
    column: offset - (lineStarts[lineIdx] ?? 0) + 1,
  };
}

/**
 * Pre-flight static linter for STEP (ISO 10303-21) exchange files.
 */
export function lintStepContent(content: string): StepDiagnostic[] {
  const diagnostics: StepDiagnostic[] = [];
  const lines = content.split(/\r?\n/);
  const lineStarts = computeLineStarts(content);

  // 1. Check Framing
  const trimmed = content.trim();
  if (!trimmed.startsWith("ISO-10303-21;")) {
    diagnostics.push({
      code: `T${StepErrorCode.STEP_SYNTAX_ERROR.code}`,
      numericCode: StepErrorCode.STEP_SYNTAX_ERROR.code,
      rule: StepErrorCode.STEP_SYNTAX_ERROR.rule,
      severity: StepErrorCode.STEP_SYNTAX_ERROR.severity,
      message: StepErrorCode.STEP_SYNTAX_ERROR.message("Missing required header tag 'ISO-10303-21;'"),
      line: 1,
      column: 1,
    });
  }

  if (!trimmed.endsWith("END-ISO-10303-21;")) {
    diagnostics.push({
      code: `T${StepErrorCode.STEP_SYNTAX_ERROR.code}`,
      numericCode: StepErrorCode.STEP_SYNTAX_ERROR.code,
      rule: StepErrorCode.STEP_SYNTAX_ERROR.rule,
      severity: StepErrorCode.STEP_SYNTAX_ERROR.severity,
      message: StepErrorCode.STEP_SYNTAX_ERROR.message("Missing required closing tag 'END-ISO-10303-21;'"),
      line: lines.length,
      column: Math.max(1, lines[lines.length - 1]?.length ?? 1),
    });
  }

  // 2. Check HEADER section
  const upperContent = content.toUpperCase();
  const headerIdx = upperContent.indexOf("HEADER;");
  const headerEndIdx = headerIdx !== -1 ? upperContent.indexOf("ENDSEC;", headerIdx + 7) : -1;
  const hasHeader = headerIdx !== -1 && headerEndIdx !== -1;
  if (!hasHeader) {
    diagnostics.push({
      code: `T${StepErrorCode.MISSING_HEADER_SECTION.code}`,
      numericCode: StepErrorCode.MISSING_HEADER_SECTION.code,
      rule: StepErrorCode.MISSING_HEADER_SECTION.rule,
      severity: StepErrorCode.MISSING_HEADER_SECTION.severity,
      message: StepErrorCode.MISSING_HEADER_SECTION.message(),
      line: 1,
      column: 1,
    });
  } else {
    // Check FILE_SCHEMA inside HEADER
    const headerBody = content.slice(headerIdx + 7, headerEndIdx);
    if (!/FILE_SCHEMA/i.test(headerBody)) {
      diagnostics.push({
        code: `T${StepErrorCode.MISSING_SCHEMA_DECLARATION.code}`,
        numericCode: StepErrorCode.MISSING_SCHEMA_DECLARATION.code,
        rule: StepErrorCode.MISSING_SCHEMA_DECLARATION.rule,
        severity: StepErrorCode.MISSING_SCHEMA_DECLARATION.severity,
        message: StepErrorCode.MISSING_SCHEMA_DECLARATION.message(),
        line: 2,
        column: 1,
      });
    } else {
      const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(headerBody);
      const schemaName = schemaMatch?.[1]?.trim();
      if (schemaName && !SUPPORTED_STEP_SCHEMA_RE.test(schemaName)) {
        const pos = offsetToLineCol(headerIdx + 7 + (schemaMatch?.index ?? 0), lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.UNSUPPORTED_AP_SCHEMA.code}`,
          numericCode: StepErrorCode.UNSUPPORTED_AP_SCHEMA.code,
          rule: StepErrorCode.UNSUPPORTED_AP_SCHEMA.rule,
          severity: StepErrorCode.UNSUPPORTED_AP_SCHEMA.severity,
          message: StepErrorCode.UNSUPPORTED_AP_SCHEMA.message(schemaName),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // 3. Check DATA section & Entity References
  const dataIdx = upperContent.indexOf("DATA;");
  const dataEndIdx = dataIdx !== -1 ? upperContent.indexOf("ENDSEC;", dataIdx + 5) : -1;
  const hasData = dataIdx !== -1 && dataEndIdx !== -1;
  if (!hasData) {
    diagnostics.push({
      code: `T${StepErrorCode.MISSING_DATA_SECTION.code}`,
      numericCode: StepErrorCode.MISSING_DATA_SECTION.code,
      rule: StepErrorCode.MISSING_DATA_SECTION.rule,
      severity: StepErrorCode.MISSING_DATA_SECTION.severity,
      message: StepErrorCode.MISSING_DATA_SECTION.message(),
      line: 1,
      column: 1,
    });
    return diagnostics;
  }

  const dataBaseOffset = dataIdx + 5;
  const dataBody = content.slice(dataBaseOffset, dataEndIdx);
  const entities = scanStepEntities(dataBody);
  const { references } = parseStepReferences(dataBody);

  const definedEntities = new Set<string>();
  for (const ent of entities) {
    const eid = ent.id.startsWith("#") ? ent.id.slice(1) : ent.id;
    if (definedEntities.has(ent.id)) {
      const pos = offsetToLineCol(dataBaseOffset + ent.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.DUPLICATE_ENTITY_ID.code}`,
        numericCode: StepErrorCode.DUPLICATE_ENTITY_ID.code,
        rule: StepErrorCode.DUPLICATE_ENTITY_ID.rule,
        severity: StepErrorCode.DUPLICATE_ENTITY_ID.severity,
        message: StepErrorCode.DUPLICATE_ENTITY_ID.message(eid),
        line: pos.line,
        column: pos.column,
      });
    } else {
      definedEntities.add(ent.id);
    }
  }

  if (definedEntities.size === 0) {
    diagnostics.push({
      code: `T${StepErrorCode.EMPTY_DATA_SECTION.code}`,
      numericCode: StepErrorCode.EMPTY_DATA_SECTION.code,
      rule: StepErrorCode.EMPTY_DATA_SECTION.rule,
      severity: StepErrorCode.EMPTY_DATA_SECTION.severity,
      message: StepErrorCode.EMPTY_DATA_SECTION.message(),
      line: 1,
      column: 1,
    });
  }

  // Verify all entity references resolve (ignoring # inside strings and /* ... */ comments)
  for (const ref of references) {
    if (!definedEntities.has(ref.id)) {
      const eid = ref.id.startsWith("#") ? ref.id.slice(1) : ref.id;
      const pos = offsetToLineCol(dataBaseOffset + ref.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code}`,
        numericCode: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.code,
        rule: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.rule,
        severity: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.severity,
        message: StepErrorCode.UNRESOLVED_ENTITY_REFERENCE.message(eid),
        line: pos.line,
        column: pos.column,
      });
    }
  }

  // 4. Topological, Geometric, and Presentation Checks (T1009–T1014)
  interface ParsedEntityInfo {
    id: string;
    eid: string;
    entityName: string;
    raw: string;
    argsText: string;
    refs: string[];
    startOffset: number;
  }

  const extractEntityRefsFromArgs = (argsText: string): string[] => {
    const refs: string[] = [];
    let inString = false;
    let i = 0;
    while (i < argsText.length) {
      const ch = argsText.charCodeAt(i);
      if (!inString && ch === 47 && argsText.charCodeAt(i + 1) === 42) {
        i += 2;
        while (i < argsText.length && !(argsText.charCodeAt(i) === 42 && argsText.charCodeAt(i + 1) === 47)) {
          i++;
        }
        i += 2;
        continue;
      }
      if (ch === 39) {
        if (inString && argsText.charCodeAt(i + 1) === 39) {
          i += 2;
          continue;
        }
        inString = !inString;
        i++;
        continue;
      }
      if (!inString && ch === 35) {
        let end = i + 1;
        while (end < argsText.length && argsText.charCodeAt(end) >= 48 && argsText.charCodeAt(end) <= 57) {
          end++;
        }
        if (end > i + 1) {
          refs.push(argsText.slice(i, end));
          i = end;
          continue;
        }
      }
      i++;
    }
    return refs;
  };

  const extractNumericTuple = (argsText: string): number[] | undefined => {
    // Match inner parenthesized coordinate/direction tuple e.g. ('name', (x, y, z))
    const tupleMatch = /\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)+)\s*\)/.exec(
      argsText,
    );
    if (!tupleMatch?.[1]) return undefined;
    const nums = tupleMatch[1].split(",").map((s) => Number.parseFloat(s.trim()));
    return nums.every((n) => !Number.isNaN(n)) ? nums : undefined;
  };

  const entityMap = new Map<string, ParsedEntityInfo>();
  const referencedBy = new Map<string, string[]>();

  for (const ent of entities) {
    if (entityMap.has(ent.id)) continue;
    const raw = dataBody.slice(ent.startOffset, ent.endOffset);
    const eqIdx = raw.indexOf("=");
    const argsText = eqIdx !== -1 ? raw.slice(eqIdx + 1) : raw;
    const refs = extractEntityRefsFromArgs(argsText);
    const eid = ent.id.startsWith("#") ? ent.id.slice(1) : ent.id;
    entityMap.set(ent.id, {
      id: ent.id,
      eid,
      entityName: ent.type.toUpperCase(),
      raw,
      argsText,
      refs,
      startOffset: ent.startOffset,
    });
    for (const r of refs) {
      const list = referencedBy.get(r);
      if (list) list.push(ent.id);
      else referencedBy.set(r, [ent.id]);
    }
  }

  // Parse CARTESIAN_POINT and VERTEX_POINT coordinates
  const cartesianPoints = new Map<string, [number, number, number]>();
  const vertexPoints = new Map<string, [number, number, number]>();
  const zeroDirections = new Set<string>();
  let uncertaintyTol: number | undefined;

  for (const info of entityMap.values()) {
    if (info.entityName === "CARTESIAN_POINT") {
      const coords = extractNumericTuple(info.argsText);
      if (coords && coords.length >= 2) {
        cartesianPoints.set(info.id, [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0]);
      }
    } else if (info.entityName === "DIRECTION") {
      const coords = extractNumericTuple(info.argsText);
      if (coords && coords.length >= 2) {
        const mag = Math.hypot(...coords);
        if (mag < 1e-12) {
          zeroDirections.add(info.id);
        }
      }
    } else if (info.entityName === "UNCERTAINTY_MEASURE_WITH_UNIT") {
      const m = /LENGTH_MEASURE\s*\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*\)/i.exec(info.argsText);
      if (m?.[1]) {
        const val = Number.parseFloat(m[1]);
        if (!Number.isNaN(val) && val > 0) uncertaintyTol = val;
      }
    }
  }

  for (const info of entityMap.values()) {
    if (info.entityName === "VERTEX_POINT") {
      const ptRef = info.refs.find((r) => cartesianPoints.has(r));
      if (ptRef) {
        vertexPoints.set(info.id, cartesianPoints.get(ptRef)!);
      } else {
        const coords = extractNumericTuple(info.argsText);
        if (coords && coords.length >= 2) {
          vertexPoints.set(info.id, [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0]);
        }
      }
    }
  }

  // Map ORIENTED_EDGE -> EDGE_CURVE and EDGE_CURVE endpoints
  const edgeCurveEndpoints = new Map<string, { vStart: string; vEnd: string }>();
  const orientedEdgeToCurve = new Map<string, { edgeCurveId: string; sameSense: boolean }>();
  const edgeCurveUsageCount = new Map<string, number>();

  for (const info of entityMap.values()) {
    if (info.entityName === "EDGE_CURVE") {
      const vRefs = info.refs.filter((r) => entityMap.get(r)?.entityName === "VERTEX_POINT" || cartesianPoints.has(r));
      const vStart = vRefs[0] ?? info.refs[0] ?? "";
      const vEnd = vRefs[1] ?? info.refs[1] ?? vStart;
      edgeCurveEndpoints.set(info.id, { vStart, vEnd });
    }
  }

  for (const info of entityMap.values()) {
    if (info.entityName === "ORIENTED_EDGE") {
      const ecId = info.refs.find((r) => entityMap.get(r)?.entityName === "EDGE_CURVE") ?? info.refs[info.refs.length - 1];
      const sameSense = !/\.F\.\s*\)\s*;?\s*$/i.test(info.argsText);
      if (ecId && entityMap.has(ecId)) {
        orientedEdgeToCurve.set(info.id, { edgeCurveId: ecId, sameSense });
        edgeCurveUsageCount.set(ecId, (edgeCurveUsageCount.get(ecId) ?? 0) + 1);
      }
    }
  }

  // Map faces -> used EDGE_CURVEs
  const faceToEdges = new Map<string, Set<string>>();
  for (const info of entityMap.values()) {
    if (info.entityName === "ADVANCED_FACE" || info.entityName === "FACE_SURFACE") {
      const usedEdges = new Set<string>();
      const queue = [...info.refs];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const curr = queue.pop()!;
        if (visited.has(curr)) continue;
        visited.add(curr);
        const target = entityMap.get(curr);
        if (!target) continue;
        if (target.entityName === "EDGE_CURVE") {
          usedEdges.add(curr);
        } else if (target.entityName === "ORIENTED_EDGE") {
          const oe = orientedEdgeToCurve.get(curr);
          if (oe) usedEdges.add(oe.edgeCurveId);
        } else if (
          target.entityName === "FACE_BOUND" ||
          target.entityName === "FACE_OUTER_BOUND" ||
          target.entityName === "EDGE_LOOP"
        ) {
          queue.push(...target.refs);
        }
      }
      faceToEdges.set(info.id, usedEdges);
    }
  }

  // T1009: NON_MANIFOLD_EDGE (edge shared by more than two faces or >2 oriented edges)
  const edgeFaceCount = new Map<string, number>();
  for (const edges of faceToEdges.values()) {
    for (const eId of edges) {
      edgeFaceCount.set(eId, (edgeFaceCount.get(eId) ?? 0) + 1);
    }
  }
  const reportedNonManifold = new Set<string>();
  for (const info of entityMap.values()) {
    if (info.entityName === "EDGE_CURVE") {
      const fCount = edgeFaceCount.get(info.id) ?? 0;
      const oeCount = edgeCurveUsageCount.get(info.id) ?? 0;
      if (fCount > 2 || oeCount > 2) {
        reportedNonManifold.add(info.id);
        const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.NON_MANIFOLD_EDGE.code}`,
          numericCode: StepErrorCode.NON_MANIFOLD_EDGE.code,
          rule: StepErrorCode.NON_MANIFOLD_EDGE.rule,
          severity: StepErrorCode.NON_MANIFOLD_EDGE.severity,
          message: StepErrorCode.NON_MANIFOLD_EDGE.message(info.eid),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // T1010: OPEN_SOLID_SHELL (open shell or non-watertight closed shell)
  for (const info of entityMap.values()) {
    if (info.entityName === "OPEN_SHELL") {
      const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.OPEN_SOLID_SHELL.code}`,
        numericCode: StepErrorCode.OPEN_SOLID_SHELL.code,
        rule: StepErrorCode.OPEN_SOLID_SHELL.rule,
        severity: StepErrorCode.OPEN_SOLID_SHELL.severity,
        message: StepErrorCode.OPEN_SOLID_SHELL.message(info.eid),
        line: pos.line,
        column: pos.column,
      });
    } else if (info.entityName === "CLOSED_SHELL") {
      const faceRefs = info.refs.filter((r) => {
        const en = entityMap.get(r)?.entityName;
        return en === "ADVANCED_FACE" || en === "FACE_SURFACE";
      });
      let isOpen = info.refs.length === 0;
      if (!isOpen && faceRefs.length > 0) {
        const shellEdgeCounts = new Map<string, number>();
        for (const fRef of faceRefs) {
          const fEdges = faceToEdges.get(fRef);
          if (fEdges) {
            for (const eId of fEdges) {
              shellEdgeCounts.set(eId, (shellEdgeCounts.get(eId) ?? 0) + 1);
            }
          }
        }
        if (shellEdgeCounts.size > 0) {
          for (const [eId, count] of shellEdgeCounts.entries()) {
            const ep = edgeCurveEndpoints.get(eId);
            // Non-seam edge used by only 1 face in the shell leaves an open boundary
            if (count === 1 && (!ep || ep.vStart !== ep.vEnd)) {
              isOpen = true;
              break;
            }
          }
        } else if (faceRefs.length === 1) {
          const singleFace = entityMap.get(faceRefs[0]!);
          const hasPlane = singleFace?.refs.some((r) => entityMap.get(r)?.entityName === "PLANE");
          if (hasPlane) isOpen = true;
        }
      }
      if (isOpen) {
        const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.OPEN_SOLID_SHELL.code}`,
          numericCode: StepErrorCode.OPEN_SOLID_SHELL.code,
          rule: StepErrorCode.OPEN_SOLID_SHELL.rule,
          severity: StepErrorCode.OPEN_SOLID_SHELL.severity,
          message: StepErrorCode.OPEN_SOLID_SHELL.message(info.eid),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // T1011: DEGENERATE_FACE_NORMAL (face surface normal vector has zero magnitude)
  const placementsWithZeroNormal = new Set<string>();
  for (const info of entityMap.values()) {
    if (info.entityName === "AXIS2_PLACEMENT_3D" || info.entityName === "AXIS2_PLACEMENT_2D") {
      if (info.refs.some((r) => zeroDirections.has(r))) {
        placementsWithZeroNormal.add(info.id);
      }
    }
  }
  const reportedDegenerateSurfaces = new Set<string>();
  const SURFACE_ENTITY_NAMES = new Set([
    "PLANE",
    "ADVANCED_FACE",
    "FACE_SURFACE",
    "CYLINDRICAL_SURFACE",
    "SPHERICAL_SURFACE",
    "CONICAL_SURFACE",
    "TOROIDAL_SURFACE",
    "B_SPLINE_SURFACE_WITH_KNOTS",
  ]);
  for (const info of entityMap.values()) {
    if (SURFACE_ENTITY_NAMES.has(info.entityName)) {
      const hasZeroDir = info.refs.some((r) => zeroDirections.has(r) || placementsWithZeroNormal.has(r));
      if (hasZeroDir) {
        reportedDegenerateSurfaces.add(info.id);
        const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.DEGENERATE_FACE_NORMAL.code}`,
          numericCode: StepErrorCode.DEGENERATE_FACE_NORMAL.code,
          rule: StepErrorCode.DEGENERATE_FACE_NORMAL.rule,
          severity: StepErrorCode.DEGENERATE_FACE_NORMAL.severity,
          message: StepErrorCode.DEGENERATE_FACE_NORMAL.message(info.eid),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }
  if (reportedDegenerateSurfaces.size === 0 && zeroDirections.size > 0) {
    for (const dirId of zeroDirections) {
      const info = entityMap.get(dirId)!;
      const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
      diagnostics.push({
        code: `T${StepErrorCode.DEGENERATE_FACE_NORMAL.code}`,
        numericCode: StepErrorCode.DEGENERATE_FACE_NORMAL.code,
        rule: StepErrorCode.DEGENERATE_FACE_NORMAL.rule,
        severity: StepErrorCode.DEGENERATE_FACE_NORMAL.severity,
        message: StepErrorCode.DEGENERATE_FACE_NORMAL.message(info.eid),
        line: pos.line,
        column: pos.column,
      });
    }
  }

  // T1012: VERTEX_TOLERANCE_GAP (distance between vertices exceeds AP242 tolerance)
  const tol = uncertaintyTol ?? 1e-4;
  const connectedVertexPairs = new Set<string>();
  for (const ep of edgeCurveEndpoints.values()) {
    if (ep.vStart && ep.vEnd) {
      connectedVertexPairs.add(`${ep.vStart}:${ep.vEnd}`);
      connectedVertexPairs.add(`${ep.vEnd}:${ep.vStart}`);
    }
  }
  const reportedVertexGaps = new Set<string>();
  const emitVertexGap = (v1Id: string, v2Id: string, gap: number, offset: number) => {
    const key = v1Id < v2Id ? `${v1Id}:${v2Id}` : `${v2Id}:${v1Id}`;
    if (reportedVertexGaps.has(key)) return;
    reportedVertexGaps.add(key);
    const v1Eid = v1Id.startsWith("#") ? v1Id.slice(1) : v1Id;
    const v2Eid = v2Id.startsWith("#") ? v2Id.slice(1) : v2Id;
    const pos = offsetToLineCol(dataBaseOffset + offset, lineStarts);
    const roundedGap = Number(gap.toPrecision(6));
    diagnostics.push({
      code: `T${StepErrorCode.VERTEX_TOLERANCE_GAP.code}`,
      numericCode: StepErrorCode.VERTEX_TOLERANCE_GAP.code,
      rule: StepErrorCode.VERTEX_TOLERANCE_GAP.rule,
      severity: StepErrorCode.VERTEX_TOLERANCE_GAP.severity,
      message: StepErrorCode.VERTEX_TOLERANCE_GAP.message(v1Eid, v2Eid, roundedGap),
      line: pos.line,
      column: pos.column,
    });
  };

  // Check consecutive oriented edges in EDGE_LOOP for disconnected vertices exceeding tolerance
  for (const info of entityMap.values()) {
    if (info.entityName === "EDGE_LOOP" && info.refs.length >= 2) {
      const oeList = info.refs
        .map((r) => orientedEdgeToCurve.get(r))
        .filter((x): x is { edgeCurveId: string; sameSense: boolean } => x !== undefined);
      for (let i = 0; i < oeList.length; i++) {
        const curr = oeList[i]!;
        const next = oeList[(i + 1) % oeList.length]!;
        const epCurr = edgeCurveEndpoints.get(curr.edgeCurveId);
        const epNext = edgeCurveEndpoints.get(next.edgeCurveId);
        if (!epCurr || !epNext) continue;
        const currEnd = curr.sameSense ? epCurr.vEnd : epCurr.vStart;
        const nextStart = next.sameSense ? epNext.vStart : epNext.vEnd;
        if (currEnd && nextStart && currEnd !== nextStart) {
          const p1 = vertexPoints.get(currEnd) ?? cartesianPoints.get(currEnd);
          const p2 = vertexPoints.get(nextStart) ?? cartesianPoints.get(nextStart);
          if (p1 && p2) {
            const gap = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
            if (gap > tol) {
              emitVertexGap(currEnd, nextStart, gap, info.startOffset);
            }
          }
        }
      }
    }
  }

  // Also check pairs of VERTEX_POINTs with micro-gaps exceeding tolerance
  const vertexEntries = [...vertexPoints.entries()];
  const maxMicroGap = uncertaintyTol !== undefined ? 1.0 : 0.05;
  for (let i = 0; i < vertexEntries.length; i++) {
    const [v1Id, p1] = vertexEntries[i]!;
    for (let j = i + 1; j < vertexEntries.length; j++) {
      const [v2Id, p2] = vertexEntries[j]!;
      if (connectedVertexPairs.has(`${v1Id}:${v2Id}`)) continue;
      const gap = Math.hypot(p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]);
      if (gap > tol && gap <= maxMicroGap) {
        const v2Info = entityMap.get(v2Id);
        emitVertexGap(v1Id, v2Id, gap, v2Info?.startOffset ?? 0);
      }
    }
  }

  // T1013: SELF_INTERSECTING_WIRE (face boundary loop wire intersects itself)
  const segmentsProperlyIntersect2D = (
    a: [number, number],
    b: [number, number],
    c: [number, number],
    d: [number, number],
  ): boolean => {
    const cross = (o: [number, number], p: [number, number], q: [number, number]) =>
      (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
      ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  };

  const isPolygonSelfIntersecting = (pts3d: [number, number, number][]): boolean => {
    const n = pts3d.length;
    if (n < 4) return false;
    // Project onto the 2D coordinate plane with largest span
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const p of pts3d) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    const pts2d: [number, number][] = pts3d.map((p) => {
      if (spanZ <= spanX && spanZ <= spanY) return [p[0], p[1]];
      if (spanY <= spanX && spanY <= spanZ) return [p[0], p[2]];
      return [p[1], p[2]];
    });
    for (let i = 0; i < n; i++) {
      const a1 = pts2d[i]!;
      const a2 = pts2d[(i + 1) % n]!;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const b1 = pts2d[j]!;
        const b2 = pts2d[(j + 1) % n]!;
        if (segmentsProperlyIntersect2D(a1, a2, b1, b2)) {
          return true;
        }
      }
    }
    return false;
  };

  for (const info of entityMap.values()) {
    if (info.entityName === "POLY_LOOP" || info.entityName === "EDGE_LOOP") {
      let selfIntersects = false;
      if (info.entityName === "POLY_LOOP") {
        const uniquePts = new Set(info.refs);
        if (uniquePts.size < info.refs.length) {
          selfIntersects = true;
        } else {
          const pts = info.refs
            .map((r) => cartesianPoints.get(r) ?? vertexPoints.get(r))
            .filter((p): p is [number, number, number] => p !== undefined);
          if (pts.length >= 4 && isPolygonSelfIntersecting(pts)) {
            selfIntersects = true;
          }
        }
      } else {
        // EDGE_LOOP
        const loopVertices: string[] = [];
        for (const r of info.refs) {
          const target = entityMap.get(r);
          if (target && /B_SPLINE_CURVE|COMPOSITE_CURVE/i.test(target.entityName) && /\.T\./i.test(target.argsText)) {
            selfIntersects = true;
            break;
          }
          const oe = orientedEdgeToCurve.get(r);
          const ecId = oe ? oe.edgeCurveId : target?.entityName === "EDGE_CURVE" ? r : undefined;
          if (ecId) {
            const ecEnt = entityMap.get(ecId);
            if (ecEnt) {
              for (const cRef of ecEnt.refs) {
                const cEnt = entityMap.get(cRef);
                if (cEnt && /B_SPLINE_CURVE|COMPOSITE_CURVE/i.test(cEnt.entityName) && /\.T\./i.test(cEnt.argsText)) {
                  selfIntersects = true;
                }
              }
            }
            const ep = edgeCurveEndpoints.get(ecId);
            if (ep) {
              loopVertices.push(oe && !oe.sameSense ? ep.vEnd : ep.vStart);
            }
          }
        }
        if (!selfIntersects && loopVertices.length >= 4) {
          if (new Set(loopVertices).size < loopVertices.length) {
            selfIntersects = true;
          } else {
            const pts = loopVertices
              .map((v) => vertexPoints.get(v) ?? cartesianPoints.get(v))
              .filter((p): p is [number, number, number] => p !== undefined);
            if (pts.length >= 4 && isPolygonSelfIntersecting(pts)) {
              selfIntersects = true;
            }
          }
        }
      }

      if (selfIntersects) {
        const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.SELF_INTERSECTING_WIRE.code}`,
          numericCode: StepErrorCode.SELF_INTERSECTING_WIRE.code,
          rule: StepErrorCode.SELF_INTERSECTING_WIRE.rule,
          severity: StepErrorCode.SELF_INTERSECTING_WIRE.severity,
          message: StepErrorCode.SELF_INTERSECTING_WIRE.message(info.eid),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  // T1014: UNREFERENCED_PRESENTATION_ITEM (style assignment references unlinked item or is unlinked)
  const SHAPE_OR_TOPOLOGY_ENTITIES = new Set([
    "MANIFOLD_SOLID_BREP",
    "BREP_WITH_VOIDS",
    "FACETED_BREP",
    "SHELL_BASED_SURFACE_MODEL",
    "CLOSED_SHELL",
    "ADVANCED_FACE",
    "FACE_SURFACE",
    "EDGE_CURVE",
    "VERTEX_POINT",
    "ADVANCED_BREP_SHAPE_REPRESENTATION",
    "SHAPE_REPRESENTATION",
    "PRODUCT_DEFINITION_SHAPE",
  ]);
  for (const info of entityMap.values()) {
    if (
      info.entityName === "PRESENTATION_STYLE_ASSIGNMENT" ||
      info.entityName === "STYLED_ITEM" ||
      info.entityName === "OVER_RIDING_STYLED_ITEM"
    ) {
      const incoming = referencedBy.get(info.id) ?? [];
      let isUnlinked = false;
      if (info.entityName === "PRESENTATION_STYLE_ASSIGNMENT") {
        // Must be referenced by a STYLED_ITEM or representation
        if (incoming.length === 0 || info.refs.length === 0) {
          isUnlinked = true;
        }
      } else {
        // STYLED_ITEM / OVER_RIDING_STYLED_ITEM: last ref is the styled target item
        const targetId = info.refs[info.refs.length - 1];
        const targetEnt = targetId ? entityMap.get(targetId) : undefined;
        const hasNullTarget = /,\s*\$\s*\)\s*;?\s*$/.test(info.argsText) || info.refs.length < 2;
        if (hasNullTarget || !targetEnt) {
          isUnlinked = true;
        } else if (!SHAPE_OR_TOPOLOGY_ENTITIES.has(targetEnt.entityName)) {
          const targetIncoming = referencedBy.get(targetId!)?.filter((id) => id !== info.id) ?? [];
          if (targetIncoming.length === 0) {
            isUnlinked = true;
          }
        }
      }

      if (isUnlinked) {
        const pos = offsetToLineCol(dataBaseOffset + info.startOffset, lineStarts);
        diagnostics.push({
          code: `T${StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.code}`,
          numericCode: StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.code,
          rule: StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.rule,
          severity: StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.severity,
          message: StepErrorCode.UNREFERENCED_PRESENTATION_ITEM.message(info.eid),
          line: pos.line,
          column: pos.column,
        });
      }
    }
  }

  return diagnostics;
}

