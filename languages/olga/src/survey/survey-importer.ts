// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — 3D Offshore Seabed Bathymetry Survey Ingestion.
 *
 * Ingests subsea pipeline route surveys (CSV / XYZ / KP-Elevation),
 * computes 3D cumulative distance, true inclination, and Dogleg Severity (DLS),
 * and automatically synthesizes curvature-adaptive discretized <Pipe> elements for OLGA.
 */

import type { OlgaPipe } from "../types.js";

export interface SurveyPoint {
  x: number; // Easting [m]
  y: number; // Northing [m]
  z: number; // TVD / Elevation [m]
  distanceAlongRoute: number; // Cumulative 3D distance [m]
}

export interface DiscretizedPipeSegment {
  label: string;
  length: number;
  diameter: number;
  elevation: number; // Delta Z across the pipe [m]
  roughness: number;
  discretization: number;
  doglegSeverityDegPer30m: number;
  startPoint: SurveyPoint;
  endPoint: SurveyPoint;
}

export interface BathymetrySurveyResult {
  totalLengthM: number;
  minElevationM: number;
  maxElevationM: number;
  maxDoglegSeverity: number;
  surveyPoints: SurveyPoint[];
  pipes: OlgaPipe[];
  segments: DiscretizedPipeSegment[];
  opiXmlSnippet: string;
}

export interface SurveyImportOptions {
  defaultDiameter?: number | undefined; // m (default: 0.3048 = 12")
  defaultRoughness?: number | undefined; // m (default: 4.5e-5)
  targetCellLength?: number | undefined; // m (default: 50m)
  fineCellLengthAtCurvature?: number | undefined; // m (default: 20m)
  doglegThresholdDegPer30m?: number | undefined; // deg/30m to trigger finer mesh (default: 1.5)
}

/**
 * Parses raw CSV / XYZ seabed bathymetry survey text.
 * Accepts:
 *   Easting, Northing, Depth/TVD
 *   X, Y, Z
 *   KP, Elevation
 */
export function parseSurveyData(rawText: string): SurveyPoint[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];

  // Inspect first non-empty line for header
  let startIdx = 0;
  const firstLine = lines[0]!.toLowerCase();
  if (
    firstLine.includes("east") ||
    firstLine.includes("north") ||
    firstLine.includes("depth") ||
    firstLine.includes("x") ||
    firstLine.includes("kp") ||
    firstLine.includes("elev")
  ) {
    startIdx = 1;
  }

  const rawCoords: { x: number; y: number; z: number }[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    // Split by comma, tab, or whitespace
    const parts = line.split(/[,\t\s]+/).filter((p) => p.length > 0);
    if (parts.length >= 3) {
      const x = parseFloat(parts[0]!);
      const y = parseFloat(parts[1]!);
      const z = parseFloat(parts[2]!);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        rawCoords.push({ x, y, z });
      }
    } else if (parts.length === 2) {
      // 2D KP and elevation format
      const kp = parseFloat(parts[0]!);
      const z = parseFloat(parts[1]!);
      if (Number.isFinite(kp) && Number.isFinite(z)) {
        rawCoords.push({ x: kp, y: 0.0, z });
      }
    }
  }

  if (rawCoords.length === 0) return [];

  // Compute cumulative 3D path distance
  const points: SurveyPoint[] = [];
  let cumDist = 0.0;

  for (let i = 0; i < rawCoords.length; i++) {
    const curr = rawCoords[i]!;
    if (i === 0) {
      points.push({ x: curr.x, y: curr.y, z: curr.z, distanceAlongRoute: 0.0 });
    } else {
      const prev = rawCoords[i - 1]!;
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dz = curr.z - prev.z;
      const ds = Math.sqrt(dx * dx + dy * dy + dz * dz);
      cumDist += ds;
      points.push({ x: curr.x, y: curr.y, z: curr.z, distanceAlongRoute: cumDist });
    }
  }

  return points;
}

/**
 * Ingests a seabed survey and synthesizes curvature-adaptive OLGA <Pipe> elements.
 */
export function importBathymetrySurvey(surveyText: string, options?: SurveyImportOptions): BathymetrySurveyResult {
  const points = parseSurveyData(surveyText);
  if (points.length < 2) {
    throw new Error("Seabed survey must contain at least 2 coordinate points.");
  }

  const defaultD = options?.defaultDiameter ?? 0.3048; // 12-inch line
  const defaultRough = options?.defaultRoughness ?? 4.5e-5;
  const baseCellLen = options?.targetCellLength ?? 50.0;
  const fineCellLen = options?.fineCellLengthAtCurvature ?? 20.0;
  const dlsThreshold = options?.doglegThresholdDegPer30m ?? 1.5;

  let minZ = points[0]!.z;
  let maxZ = points[0]!.z;
  let maxDls = 0.0;

  for (const pt of points) {
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }

  const segments: DiscretizedPipeSegment[] = [];
  const pipes: OlgaPipe[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const ds = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (ds < 0.1) continue; // Skip identical duplicate points

    // Calculate Dogleg Severity (DLS) vs previous tangent
    let dls = 0.0;
    if (i > 0 && i < points.length - 1) {
      const p0 = points[i - 1]!;
      const v1x = dx / ds;
      const v1y = dy / ds;
      const v1z = dz / ds;

      const d0x = p1.x - p0.x;
      const d0y = p1.y - p0.y;
      const d0z = p1.z - p0.z;
      const s0 = Math.sqrt(d0x * d0x + d0y * d0y + d0z * d0z);
      if (s0 > 0.1) {
        const v0x = d0x / s0;
        const v0y = d0y / s0;
        const v0z = d0z / s0;
        const dot = Math.max(-1.0, Math.min(1.0, v0x * v1x + v0y * v1y + v0z * v1z));
        const angleRad = Math.acos(dot);
        const avgDs = 0.5 * (s0 + ds);
        dls = ((angleRad * (180.0 / Math.PI)) / Math.max(1.0, avgDs)) * 30.0;
      }
    }

    if (dls > maxDls) maxDls = dls;

    // Adaptive mesh: use finer cell length if steep dip, steep rise, or high curvature
    const hasCurvature = dls > dlsThreshold || Math.abs(dz) > 30.0;
    const cellLen = hasCurvature ? fineCellLen : baseCellLen;
    const nCells = Math.max(2, Math.round(ds / cellLen));

    const pipeLabel = `PIPE_${segments.length + 1}`;
    const pipe: OlgaPipe = {
      label: pipeLabel,
      length: parseFloat(ds.toFixed(2)),
      diameter: defaultD,
      elevation: parseFloat(dz.toFixed(2)),
      roughness: defaultRough,
      discretization: nCells,
    };

    pipes.push(pipe);
    segments.push({
      label: pipeLabel,
      length: pipe.length,
      diameter: pipe.diameter,
      elevation: pipe.elevation,
      roughness: pipe.roughness,
      discretization: nCells,
      doglegSeverityDegPer30m: parseFloat(dls.toFixed(2)),
      startPoint: p1,
      endPoint: p2,
    });
  }

  // Synthesize clean XML snippet for direct IDE insertion
  const xmlLines = pipes.map(
    (p) =>
      `  <Pipe Label="${p.label}" Length="${p.length}" Diameter="${p.diameter}" Elevation="${p.elevation}" Roughness="${p.roughness}" Discretization="${p.discretization}" />`,
  );
  const opiXmlSnippet = xmlLines.join("\n");

  const totalLength = points[points.length - 1]!.distanceAlongRoute;

  return {
    totalLengthM: parseFloat(totalLength.toFixed(2)),
    minElevationM: parseFloat(minZ.toFixed(2)),
    maxElevationM: parseFloat(maxZ.toFixed(2)),
    maxDoglegSeverity: parseFloat(maxDls.toFixed(2)),
    surveyPoints: points,
    pipes,
    segments,
    opiXmlSnippet,
  };
}
