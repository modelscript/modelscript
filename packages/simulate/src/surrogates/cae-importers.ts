// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * @modelscript/simulate/surrogates — Commercial CAE Field & Ansys ROM Importers (VTK, VTU, .romz).
 *
 * Bridges external 3D continuum solvers (Ansys Fluent, Ansys Mechanical, OpenFOAM, SU2, ParaView)
 * and Ansys Twin Builder Reduced Order Model packages into ModelScript's surrogate & DAE engines.
 */

import { DmdcSurrogate, LpvStateSpaceSurrogate, type LpvVertexModel } from "./dynamic-rom.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. VTK Legacy ASCII (`.vtk`) & XML UnstructuredGrid (`.vtu`) Field Importer
// ─────────────────────────────────────────────────────────────────────────────

export interface VtkFieldSnapshot {
  /** Format detected ("vtk_legacy" or "vtu_xml"). */
  format: "vtk_legacy" | "vtu_xml";
  /** Number of mesh nodes/points. */
  numPoints: number;
  /** Number of mesh cells/elements. */
  numCells: number;
  /** Interleaved 3D point coordinates [x0, y0, z0, x1, y1, z1, ...] (length 3 * numPoints). */
  points: Float64Array;
  /** Named scalar fields (e.g. "pressure", "temperature", "von_mises_stress"). */
  scalars: Record<string, Float64Array>;
  /** Named 3-component vector fields (e.g. "velocity", "displacement"). */
  vectors: Record<string, Float64Array>;
}

function parseWhitespaceFloats(text: string): Float64Array {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 1 && tokens[0] === "") return new Float64Array(0);
  const out = new Float64Array(tokens.length);
  let count = 0;
  for (const tok of tokens) {
    const v = Number(tok);
    if (Number.isFinite(v)) {
      out[count++] = v;
    }
  }
  return count === out.length ? out : out.slice(0, count);
}

function parseLegacyVtk(content: string): VtkFieldSnapshot {
  const lines = content.split(/\r?\n/);
  let numPoints = 0;
  let numCells = 0;
  let points = new Float64Array(0);
  const scalars: Record<string, Float64Array> = {};
  const vectors: Record<string, Float64Array> = {};

  let activeSectionCount = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("#")) {
      i++;
      continue;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith("POINTS ")) {
      const parts = line.split(/\s+/);
      numPoints = parseInt(parts[1] ?? "0", 10) || 0;
      const needed = numPoints * 3;
      const vals: number[] = [];
      i++;
      while (i < lines.length && vals.length < needed) {
        const row = lines[i]!.trim();
        if (row) {
          for (const tok of row.split(/\s+/)) {
            const v = Number(tok);
            if (Number.isFinite(v)) vals.push(v);
          }
        }
        i++;
      }
      points = new Float64Array(vals.slice(0, needed));
      continue;
    }

    if (upper.startsWith("CELLS ") || upper.startsWith("POLYGONS ")) {
      const parts = line.split(/\s+/);
      numCells = parseInt(parts[1] ?? "0", 10) || 0;
      i++;
      continue;
    }

    if (upper.startsWith("POINT_DATA ")) {
      const parts = line.split(/\s+/);
      activeSectionCount = parseInt(parts[1] ?? "0", 10) || numPoints;
      i++;
      continue;
    }

    if (upper.startsWith("CELL_DATA ")) {
      const parts = line.split(/\s+/);
      activeSectionCount = parseInt(parts[1] ?? "0", 10) || numCells;
      i++;
      continue;
    }

    if (upper.startsWith("SCALARS ")) {
      const parts = line.split(/\s+/);
      const name = parts[1] ?? "scalar";
      const nComp = parseInt(parts[3] ?? "1", 10) || 1;
      const needed = (activeSectionCount || numPoints) * nComp;
      i++;
      // Optional LOOKUP_TABLE line
      if (i < lines.length && lines[i]!.trim().toUpperCase().startsWith("LOOKUP_TABLE")) {
        i++;
      }
      const vals: number[] = [];
      while (i < lines.length && vals.length < needed) {
        const row = lines[i]!.trim();
        if (row) {
          for (const tok of row.split(/\s+/)) {
            const v = Number(tok);
            if (Number.isFinite(v)) vals.push(v);
          }
        }
        i++;
      }
      scalars[name] = new Float64Array(vals.slice(0, needed));
      continue;
    }

    if (upper.startsWith("VECTORS ")) {
      const parts = line.split(/\s+/);
      const name = parts[1] ?? "vector";
      const needed = (activeSectionCount || numPoints) * 3;
      i++;
      const vals: number[] = [];
      while (i < lines.length && vals.length < needed) {
        const row = lines[i]!.trim();
        if (row) {
          for (const tok of row.split(/\s+/)) {
            const v = Number(tok);
            if (Number.isFinite(v)) vals.push(v);
          }
        }
        i++;
      }
      vectors[name] = new Float64Array(vals.slice(0, needed));
      continue;
    }

    i++;
  }

  return {
    format: "vtk_legacy",
    numPoints,
    numCells,
    points,
    scalars,
    vectors,
  };
}

function parseXmlVtu(content: string): VtkFieldSnapshot {
  let numPoints = 0;
  let numCells = 0;
  const pieceStart = content.indexOf("<Piece");
  if (pieceStart !== -1) {
    const pieceEnd = content.indexOf(">", pieceStart);
    if (pieceEnd !== -1) {
      const pieceAttrs = content.slice(pieceStart, pieceEnd);
      const ptsMatch = pieceAttrs.match(/NumberOfPoints="(\d+)"/i);
      const cellsMatch = pieceAttrs.match(/NumberOfCells="(\d+)"/i);
      if (ptsMatch) numPoints = parseInt(ptsMatch[1]!, 10);
      if (cellsMatch) numCells = parseInt(cellsMatch[1]!, 10);
    }
  }

  let points: Float64Array = new Float64Array(0);
  const extractSection = (tag: string): string | null => {
    const openTag = `<${tag}`;
    const startIdx = content.indexOf(openTag);
    if (startIdx === -1) return null;
    const tagEnd = content.indexOf(">", startIdx);
    if (tagEnd === -1) return null;
    const closeTag = `</${tag}>`;
    const endIdx = content.indexOf(closeTag, tagEnd);
    if (endIdx === -1) return null;
    return content.slice(tagEnd + 1, endIdx);
  };

  const pointsSection = extractSection("Points");
  if (pointsSection) {
    const daStart = pointsSection.indexOf("<DataArray");
    if (daStart !== -1) {
      const daTagEnd = pointsSection.indexOf(">", daStart);
      const daEnd = pointsSection.indexOf("</DataArray>", daTagEnd);
      if (daTagEnd !== -1 && daEnd !== -1) {
        points = parseWhitespaceFloats(pointsSection.slice(daTagEnd + 1, daEnd));
      }
    }
  }

  const scalars: Record<string, Float64Array> = {};
  const vectors: Record<string, Float64Array> = {};

  const parseDataArrays = (sectionXml: string) => {
    let cur = 0;
    while (cur < sectionXml.length) {
      const openIdx = sectionXml.indexOf("<DataArray", cur);
      if (openIdx === -1) break;
      const tagEnd = sectionXml.indexOf(">", openIdx);
      if (tagEnd === -1) break;
      const closeIdx = sectionXml.indexOf("</DataArray>", tagEnd);
      if (closeIdx === -1) break;
      const attrs = sectionXml.slice(openIdx + "<DataArray".length, tagEnd);
      const body = sectionXml.slice(tagEnd + 1, closeIdx);
      cur = closeIdx + "</DataArray>".length;

      const nameMatch = attrs.match(/Name="([^"]+)"/i);
      const compMatch = attrs.match(/NumberOfComponents="(\d+)"/i);
      const name = nameMatch ? nameMatch[1]! : "field";
      const nComp = compMatch ? parseInt(compMatch[1]!, 10) : 1;
      const arr = parseWhitespaceFloats(body);
      if (nComp === 3) {
        vectors[name] = arr;
      } else {
        scalars[name] = arr;
      }
    }
  };

  const pointDataSection = extractSection("PointData");
  if (pointDataSection) parseDataArrays(pointDataSection);

  const cellDataSection = extractSection("CellData");
  if (cellDataSection) parseDataArrays(cellDataSection);

  return {
    format: "vtu_xml",
    numPoints: numPoints || Math.floor(points.length / 3),
    numCells,
    points,
    scalars,
    vectors,
  };
}

/**
 * Parse a Legacy ASCII VTK (`.vtk`) or XML UnstructuredGrid (`.vtu`) field file into typed Float64Array snapshots.
 */
export function parseVtkSnapshotField(content: string): VtkFieldSnapshot {
  if (content.includes("<VTKFile") || content.includes("<UnstructuredGrid")) {
    return parseXmlVtu(content);
  }
  return parseLegacyVtk(content);
}

/**
 * Flatten selected scalar and vector fields from a `VtkFieldSnapshot` into a single state snapshot vector in R^N.
 */
export function flattenVtkSnapshotToFeatureVector(snapshot: VtkFieldSnapshot, fieldNames?: string[]): Float64Array {
  const names =
    fieldNames && fieldNames.length > 0
      ? fieldNames
      : [...Object.keys(snapshot.scalars), ...Object.keys(snapshot.vectors)];

  let totalLen = 0;
  const arrays: Float64Array[] = [];
  for (const name of names) {
    const arr = snapshot.scalars[name] ?? snapshot.vectors[name];
    if (arr) {
      arrays.push(arr);
      totalLen += arr.length;
    }
  }

  const out = new Float64Array(totalLen);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Ansys Twin Builder / Reduced Order Model (`.romz` / JSON) Importer
// ─────────────────────────────────────────────────────────────────────────────

export interface AnsysRomArchiveSpec {
  /** Model name or identifier from Ansys Twin Builder / Fluent ROM Wizard. */
  modelName: string;
  /** ROM type: linear time-invariant ("lti") or linear parameter-varying ("lpv"). */
  romType: "lti" | "lpv";
  /** Input port names (e.g. ["heat_flux_in", "mass_flow"]). */
  inputNames: string[];
  /** Output port names (e.g. ["T_junction", "T_case"]). */
  outputNames: string[];
  /** Optional spatial POD mode basis matrix (length numFeatures * numStates) and mean field. */
  spatialBasis?:
    | {
        numFeatures: number;
        meanField: number[];
        basisModes: number[];
      }
    | undefined;
  /** For `romType === "lti"`: state-space matrices (A, B, C, D) and optional offsets (c, yBar). */
  ltiMatrices?:
    | {
        numStates: number;
        A: number[];
        B: number[];
        C: number[];
        D?: number[] | undefined;
        c?: number[] | undefined;
        yBar?: number[] | undefined;
      }
    | undefined;
  /** For `romType === "lpv"`: scheduling parameter names and local state-space vertex models. */
  lpvSchedule?:
    | {
        numStates: number;
        schedulingParamNames: string[];
        operatingPoints: {
          schedulingParams: number[];
          A: number[];
          B: number[];
          C: number[];
          D?: number[] | undefined;
        }[];
      }
    | undefined;
}

/**
 * Import an Ansys Twin Builder / Fluent Reduced Order Model specification into a native
 * ModelScript `DmdcSurrogate` (for LTI dynamic ROMs) or `LpvStateSpaceSurrogate` (for LPV scheduled ROMs).
 */
export function importAnsysRomPackage(
  specOrJson: AnsysRomArchiveSpec | string,
): DmdcSurrogate | LpvStateSpaceSurrogate {
  const spec: AnsysRomArchiveSpec = typeof specOrJson === "string" ? JSON.parse(specOrJson) : specOrJson;
  const m = spec.inputNames.length;
  const q = spec.outputNames.length;

  if (spec.romType === "lti") {
    if (!spec.ltiMatrices) {
      throw new Error(`Ansys ROM '${spec.modelName}' of type 'lti' is missing 'ltiMatrices'.`);
    }
    const r = spec.ltiMatrices.numStates;
    const numFeatures = spec.spatialBasis?.numFeatures ?? r;
    const meanField = spec.spatialBasis ? new Float64Array(spec.spatialBasis.meanField) : new Float64Array(numFeatures);
    let basisModes: Float64Array;
    if (spec.spatialBasis) {
      basisModes = new Float64Array(spec.spatialBasis.basisModes);
    } else {
      basisModes = new Float64Array(r * numFeatures);
      for (let i = 0; i < Math.min(r, numFeatures); i++) basisModes[i * numFeatures + i] = 1.0;
    }

    return new DmdcSurrogate({
      numFeatures,
      numModes: r,
      numInputs: m,
      numOutputs: q,
      inputNames: spec.inputNames,
      outputNames: spec.outputNames,
      meanField,
      basisModes,
      Ahat: new Float64Array(spec.ltiMatrices.A),
      Bhat: new Float64Array(spec.ltiMatrices.B),
      chat: spec.ltiMatrices.c ? new Float64Array(spec.ltiMatrices.c) : new Float64Array(r),
      Chat: new Float64Array(spec.ltiMatrices.C),
      Dhat: spec.ltiMatrices.D ? new Float64Array(spec.ltiMatrices.D) : new Float64Array(q * m),
      yBar: spec.ltiMatrices.yBar ? new Float64Array(spec.ltiMatrices.yBar) : new Float64Array(q),
    });
  }

  if (spec.romType === "lpv") {
    if (!spec.lpvSchedule || spec.lpvSchedule.operatingPoints.length === 0) {
      throw new Error(`Ansys ROM '${spec.modelName}' of type 'lpv' requires non-empty 'lpvSchedule.operatingPoints'.`);
    }
    const r = spec.lpvSchedule.numStates;
    const vertices: LpvVertexModel[] = spec.lpvSchedule.operatingPoints.map((op) => ({
      schedulingParams: new Float64Array(op.schedulingParams),
      A: new Float64Array(op.A),
      B: new Float64Array(op.B),
      C: new Float64Array(op.C),
      D: op.D ? new Float64Array(op.D) : new Float64Array(q * m),
    }));

    return new LpvStateSpaceSurrogate({
      numStates: r,
      numInputs: m,
      numOutputs: q,
      schedulingParamNames: spec.lpvSchedule.schedulingParamNames,
      inputNames: spec.inputNames,
      outputNames: spec.outputNames,
      vertices,
    });
  }

  throw new Error(`Unsupported Ansys ROM type: '${String((spec as { romType?: unknown }).romType)}'.`);
}
