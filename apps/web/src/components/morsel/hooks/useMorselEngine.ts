// SPDX-License-Identifier: AGPL-3.0-or-later

import { patchModelicaCadAnnotation, type DynamicBindingConfig } from "@modelscript/cad";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractParametersFromCode } from "../../../util/modelica-params";
import { type CadComponent } from "../cad-viewer";
import { AnimationController } from "../cad-viewer/animation-controller";
import { extractCadComponents, parseSourceCadVariables } from "../cad-viewer/parse-cad-annotations";
import { type HistorianSession } from "../CosimPanel";
import { type ExperimentOverrides, type ParameterInfo, type SweepState } from "../SimulationParameters";
import { getCadComponents, simulate } from "../util/lsp-bridge";
import { getMorselMqttClient } from "../util/mqtt-client";
import { useMqttSimulation } from "../util/use-mqtt-simulation";

export interface UseMorselEngineProps {
  dialect?: string | undefined;
  documentUri: string;
  selectedTreeClassName: string | null;
  contextVersion: number;
  content: string;
  editor: editor.ICodeEditor | null;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  isNarrow: boolean;
  setMobileTab: (tab: any) => void;
  setTreeVisible: (v: boolean) => void;
  setView: (v: any) => void;
  viewDiagramEnum: any;
}

/** Extract STEP filename from // @step-file: annotation or ISO-10303-21 FILE_NAME header. */
export function extractStepFilename(code: string): string | null {
  const commentMatch = /\/\/\s*@step-file:\s*([^\s\n]+)/i.exec(code);
  if (commentMatch?.[1]) return commentMatch[1].trim();
  const headerMatch = /FILE_NAME\s*\(\s*'([^']+)'/i.exec(code);
  if (headerMatch?.[1]) return headerMatch[1].trim();
  return null;
}

/** Detect if the editor text is an ISO-10303-21 STEP file. */
export function isStepSource(code: string, dialect?: string): boolean {
  if (dialect === "step") return true;
  const trimmed = code.trimStart();
  if (trimmed.startsWith("ISO-10303-21;")) return true;
  return code.includes("HEADER;") && code.includes("DATA;");
}

interface TriangulatedMesh {
  positions: number[];
  normals: number[];
}

function pushTriangle(
  out: TriangulatedMesh,
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  out.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  out.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
}

function appendBoxTriangles(
  out: TriangulatedMesh,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
): void {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const v: [number, number, number][] = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  const quads: [number, number, number, number][] = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [5, 1, 2, 6],
    [0, 4, 7, 3],
    [3, 7, 6, 2],
    [0, 1, 5, 4],
  ];
  for (const [i0, i1, i2, i3] of quads) {
    pushTriangle(out, v[i0]!, v[i1]!, v[i2]!);
    pushTriangle(out, v[i0]!, v[i2]!, v[i3]!);
  }
}

function appendCylinderTriangles(
  out: TriangulatedMesh,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  height: number,
  segments = 24,
): void {
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * radius;
    const z0 = cz + Math.sin(a0) * radius;
    const x1 = cx + Math.cos(a1) * radius;
    const z1 = cz + Math.sin(a1) * radius;
    // Side quad
    pushTriangle(out, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1]);
    pushTriangle(out, [x0, y0, z0], [x1, y1, z1], [x0, y1, z0]);
    // Top cap
    pushTriangle(out, [cx, y1, cz], [x1, y1, z1], [x0, y1, z0]);
    // Bottom cap
    pushTriangle(out, [cx, y0, cz], [x0, y0, z0], [x1, y0, z1]);
  }
}

/** Build a binary STL Uint8Array from triangulated positions & normals. */
export function buildBinaryStlBuffer(mesh: TriangulatedMesh): Uint8Array {
  const triCount = Math.floor(mesh.positions.length / 9);
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  const header = new TextEncoder().encode("ModelScript STEP B-Rep Tessellation");
  new Uint8Array(buf, 0, header.length).set(header);
  view.setUint32(80, triCount, true);
  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    view.setFloat32(offset + 0, mesh.normals[b] ?? 0, true);
    view.setFloat32(offset + 4, mesh.normals[b + 1] ?? 1, true);
    view.setFloat32(offset + 8, mesh.normals[b + 2] ?? 0, true);
    for (let k = 0; k < 9; k++) {
      view.setFloat32(offset + 12 + k * 4, mesh.positions[b + k] ?? 0, true);
    }
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Uint8Array(buf);
}

/** Build a VTK XML PolyData Uint8Array buffer understood by VtkRenderer. */
export function buildVtkXmlBuffer(mesh: TriangulatedMesh): Uint8Array {
  const ptCount = Math.floor(mesh.positions.length / 3);
  const triCount = Math.floor(ptCount / 3);
  const coordStrs: string[] = [];
  const scalarStrs: string[] = [];
  const connStrs: string[] = [];
  const offsetStrs: string[] = [];
  for (let i = 0; i < ptCount; i++) {
    const x = mesh.positions[i * 3] ?? 0;
    const y = mesh.positions[i * 3 + 1] ?? 0;
    const z = mesh.positions[i * 3 + 2] ?? 0;
    coordStrs.push(`${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
    scalarStrs.push(Math.hypot(x, y, z).toFixed(4));
  }
  for (let t = 0; t < triCount; t++) {
    connStrs.push(`${t * 3} ${t * 3 + 1} ${t * 3 + 2}`);
    offsetStrs.push(String((t + 1) * 3));
  }
  const xml = `<VTKFile type="PolyData" version="1.0">
  <PolyData>
    <Piece NumberOfPoints="${ptCount}" NumberOfPolys="${triCount}">
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${coordStrs.join(" ")}
        </DataArray>
      </Points>
      <Polys>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${connStrs.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsetStrs.join(" ")}
        </DataArray>
      </Polys>
      <PointData>
        <DataArray type="Float32" Name="Coordinate_Norm" format="ascii">
          ${scalarStrs.join(" ")}
        </DataArray>
      </PointData>
    </Piece>
  </PolyData>
</VTKFile>`;
  return new TextEncoder().encode(xml);
}

/** Build a glTF 2.0 binary (.glb) data URI from triangulated positions & normals for CadViewer. */
export function buildGlbDataUri(
  mesh: TriangulatedMesh,
  partName = "StepPart",
  color: [number, number, number, number] = [0.24, 0.62, 0.92, 1.0],
): string {
  const vertexCount = Math.floor(mesh.positions.length / 3);
  if (vertexCount === 0) return "";
  const posArray = new Float32Array(mesh.positions);
  const normArray = new Float32Array(mesh.normals);

  const minPos: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxPos: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    const x = posArray[i * 3]!;
    const y = posArray[i * 3 + 1]!;
    const z = posArray[i * 3 + 2]!;
    if (x < minPos[0]) minPos[0] = x;
    if (y < minPos[1]) minPos[1] = y;
    if (z < minPos[2]) minPos[2] = z;
    if (x > maxPos[0]) maxPos[0] = x;
    if (y > maxPos[1]) maxPos[1] = y;
    if (z > maxPos[2]) maxPos[2] = z;
  }

  const posBytes = posArray.byteLength;
  const normBytes = normArray.byteLength;
  const rawBinBytes = posBytes + normBytes;
  const binChunkLength = (rawBinBytes + 3) & ~3;

  const gltfJson = {
    asset: { version: "2.0", generator: "ModelScript STEP B-Rep Tessellator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: partName }],
    meshes: [
      {
        name: partName,
        primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }],
      },
    ],
    materials: [
      {
        name: `${partName}_Mat`,
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: color,
          metallicFactor: 0.35,
          roughnessFactor: 0.35,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
        min: minPos,
        max: maxPos,
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: "VEC3",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: normBytes, target: 34962 },
    ],
    buffers: [{ byteLength: binChunkLength }],
  };

  const jsonBytesRaw = new TextEncoder().encode(JSON.stringify(gltfJson));
  const jsonChunkLength = (jsonBytesRaw.byteLength + 3) & ~3;
  const totalByteLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const glb = new ArrayBuffer(totalByteLength);
  const view = new DataView(glb);
  const u8 = new Uint8Array(glb);

  // Header
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true); // version 2
  view.setUint32(8, totalByteLength, true);

  // JSON chunk
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  u8.set(jsonBytesRaw, 20);
  for (let i = jsonBytesRaw.byteLength; i < jsonChunkLength; i++) {
    u8[20 + i] = 0x20; // pad with space
  }

  // BIN chunk
  const binStart = 20 + jsonChunkLength;
  view.setUint32(binStart, binChunkLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  u8.set(new Uint8Array(posArray.buffer), binStart + 8);
  u8.set(new Uint8Array(normArray.buffer), binStart + 8 + posBytes);

  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunkSize)));
  }
  return `data:model/gltf-binary;base64,${btoa(binary)}`;
}

/**
 * Deterministic ISO-10303-21 STEP B-Rep parser & triangulator.
 * Extracts PRODUCT, MANIFOLD_SOLID_BREP, ADVANCED_FACE, EDGE_LOOP, VERTEX_POINT,
 * CARTESIAN_POINT, AXIS2_PLACEMENT_3D, and NEXT_ASSEMBLY_USAGE_OCCURRENCE entities.
 */
export function tessellateStepSource(stepCode: string): {
  vtkBuffer: Uint8Array;
  stlBuffer: Uint8Array;
  components: CadComponent[];
} {
  const cartesianPoints = new Map<number, [number, number, number]>();
  const vertexPoints = new Map<number, number>();
  const edgeCurves = new Map<number, [number, number]>();
  const orientedEdges = new Map<number, { edge: number; sense: boolean }>();
  const edgeLoops = new Map<number, number[]>();
  const polyLoops = new Map<number, number[]>();
  const faceBounds = new Map<number, number>();
  const advancedFaces: { id: number; name: string; bounds: number[] }[] = [];
  const manifoldBreps: { id: number; name: string; shellId: number }[] = [];
  const products: { id: number; name: string }[] = [];
  const placements: { id: number; name: string; ptId: number }[] = [];
  const nauos: { id: number; name: string; relating: number; related: number }[] = [];

  const stmtRegex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = stmtRegex.exec(stepCode)) !== null) {
    const id = parseInt(match[1]!, 10);
    const type = match[2]!.toUpperCase();
    const args = match[3]!;

    if (type === "CARTESIAN_POINT") {
      const coordsMatch =
        /\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?))?\s*\)/.exec(
          args,
        );
      if (coordsMatch) {
        cartesianPoints.set(id, [
          parseFloat(coordsMatch[1] || "0"),
          parseFloat(coordsMatch[2] || "0"),
          parseFloat(coordsMatch[3] || "0"),
        ]);
      }
    } else if (type === "VERTEX_POINT") {
      const refMatch = /#(\d+)/.exec(args);
      if (refMatch) vertexPoints.set(id, parseInt(refMatch[1]!, 10));
    } else if (type === "EDGE_CURVE") {
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      if (refs.length >= 2) edgeCurves.set(id, [refs[0]!, refs[1]!]);
    } else if (type === "ORIENTED_EDGE") {
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      const sense = !args.includes(".F.");
      if (refs.length > 0) {
        orientedEdges.set(id, { edge: refs[refs.length - 1]!, sense });
      }
    } else if (type === "EDGE_LOOP") {
      const innerList = /\(([\s\S]*)\)/.exec(args)?.[1] ?? args;
      const refs = Array.from(innerList.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      edgeLoops.set(id, refs);
    } else if (type === "POLY_LOOP") {
      const innerList = /\(([\s\S]*)\)/.exec(args)?.[1] ?? args;
      const refs = Array.from(innerList.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      polyLoops.set(id, refs);
    } else if (type === "FACE_OUTER_BOUND" || type === "FACE_BOUND") {
      const refMatch = /#(\d+)/.exec(args);
      if (refMatch) faceBounds.set(id, parseInt(refMatch[1]!, 10));
    } else if (type === "ADVANCED_FACE" || type === "FACE_SURFACE") {
      const nameMatch = /'([^']*)'/.exec(args);
      const boundListMatch = /\(([^)]*)\)/.exec(args);
      const bounds = boundListMatch
        ? Array.from(boundListMatch[1]!.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10))
        : [];
      advancedFaces.push({ id, name: nameMatch?.[1] || `Face_${id}`, bounds });
    } else if (type === "MANIFOLD_SOLID_BREP") {
      const nameMatch = /'([^']*)'/.exec(args);
      const refMatch = /#(\d+)/.exec(args);
      manifoldBreps.push({
        id,
        name: nameMatch?.[1] || `Solid_${id}`,
        shellId: refMatch ? parseInt(refMatch[1]!, 10) : 0,
      });
    } else if (type === "PRODUCT") {
      const strMatches = Array.from(args.matchAll(/'([^']*)'/g)).map((m) => m[1]!);
      const name = strMatches[1] || strMatches[0] || `Product_${id}`;
      products.push({ id, name });
    } else if (type === "AXIS2_PLACEMENT_3D") {
      const nameMatch = /'([^']*)'/.exec(args);
      const refMatch = /#(\d+)/.exec(args);
      placements.push({ id, name: nameMatch?.[1] || `Axis_${id}`, ptId: refMatch ? parseInt(refMatch[1]!, 10) : 0 });
    } else if (type === "NEXT_ASSEMBLY_USAGE_OCCURRENCE") {
      const strMatches = Array.from(args.matchAll(/'([^']*)'/g)).map((m) => m[1]!);
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      nauos.push({
        id,
        name: strMatches[1] || strMatches[0] || `Assy_${id}`,
        relating: refs[0] ?? 0,
        related: refs[1] ?? 0,
      });
    }
  }

  // Normalize coordinate scale if points are in millimeters (> 10 units)
  let maxCoord = 0;
  for (const pt of cartesianPoints.values()) {
    maxCoord = Math.max(maxCoord, Math.abs(pt[0]), Math.abs(pt[1]), Math.abs(pt[2]));
  }
  const scaleFactor = maxCoord > 10 ? (1 / maxCoord) * 1.5 : 1.0;

  const getPoint = (ptOrVertexId: number): [number, number, number] | null => {
    const direct = cartesianPoints.get(ptOrVertexId);
    if (direct) return [direct[0] * scaleFactor, direct[1] * scaleFactor, direct[2] * scaleFactor];
    const vPtId = vertexPoints.get(ptOrVertexId);
    if (vPtId !== undefined) {
      const p = cartesianPoints.get(vPtId);
      if (p) return [p[0] * scaleFactor, p[1] * scaleFactor, p[2] * scaleFactor];
    }
    return null;
  };

  const mesh: TriangulatedMesh = { positions: [], normals: [] };

  const dist3 = (a: [number, number, number], b: [number, number, number]): number =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  const pushUniquePt = (arr: [number, number, number][], p: [number, number, number]) => {
    if (arr.length > 0) {
      const last = arr[arr.length - 1]!;
      if (dist3(last, p) < 1e-6) return;
    }
    arr.push(p);
  };

  const resolveEdgeLoopPts = (oEdges: number[]): [number, number, number][] => {
    const segs: [[number, number, number], [number, number, number]][] = [];
    for (const oeId of oEdges) {
      const oe = orientedEdges.get(oeId);
      const ecId = oe ? oe.edge : oeId;
      const ec = edgeCurves.get(ecId);
      if (ec) {
        const p0 = getPoint(oe && !oe.sense ? ec[1] : ec[0]);
        const p1 = getPoint(oe && !oe.sense ? ec[0] : ec[1]);
        if (p0 && p1) segs.push([p0, p1]);
      }
    }
    if (segs.length < 2) return [];
    const pts: [number, number, number][] = [];
    let firstSeg = segs[0]!;
    const secondSeg = segs[1]!;
    const dEnd = Math.min(dist3(firstSeg[1], secondSeg[0]), dist3(firstSeg[1], secondSeg[1]));
    const dStart = Math.min(dist3(firstSeg[0], secondSeg[0]), dist3(firstSeg[0], secondSeg[1]));
    if (dStart + 1e-6 < dEnd) {
      firstSeg = [firstSeg[1], firstSeg[0]];
    }
    pushUniquePt(pts, firstSeg[0]);
    pushUniquePt(pts, firstSeg[1]);
    for (let i = 1; i < segs.length; i++) {
      let seg = segs[i]!;
      const lastPt = pts[pts.length - 1]!;
      if (dist3(lastPt, seg[1]) + 1e-6 < dist3(lastPt, seg[0])) {
        seg = [seg[1], seg[0]];
      }
      pushUniquePt(pts, seg[0]);
      pushUniquePt(pts, seg[1]);
    }
    if (pts.length >= 2 && dist3(pts[0]!, pts[pts.length - 1]!) < 1e-5) {
      pts.pop();
    }
    return pts;
  };

  const triangulatedLoopIds = new Set<number>();

  // 1. Triangulate explicit ADVANCED_FACE / FACE_SURFACE loops if present
  for (const face of advancedFaces) {
    for (const boundId of face.bounds) {
      const loopId = faceBounds.get(boundId) ?? boundId;
      triangulatedLoopIds.add(loopId);
      const polyPts = polyLoops.get(loopId);
      if (polyPts && polyPts.length >= 3) {
        const pts = polyPts.map(getPoint).filter((p): p is [number, number, number] => p !== null);
        for (let i = 1; i + 1 < pts.length; i++) {
          pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
        }
        continue;
      }
      const oEdges = edgeLoops.get(loopId);
      if (oEdges && oEdges.length >= 3) {
        const pts = resolveEdgeLoopPts(oEdges);
        for (let i = 1; i + 1 < pts.length; i++) {
          pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
        }
      }
    }
  }

  // 1b. Also triangulate any remaining POLY_LOOP / EDGE_LOOP entities not referenced by ADVANCED_FACE
  for (const [loopId, polyPts] of polyLoops.entries()) {
    if (triangulatedLoopIds.has(loopId) || polyPts.length < 3) continue;
    const pts = polyPts.map(getPoint).filter((p): p is [number, number, number] => p !== null);
    for (let i = 1; i + 1 < pts.length; i++) {
      pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
    }
  }
  for (const [loopId, oEdges] of edgeLoops.entries()) {
    if (triangulatedLoopIds.has(loopId) || oEdges.length < 3) continue;
    const pts = resolveEdgeLoopPts(oEdges);
    for (let i = 1; i + 1 < pts.length; i++) {
      pushTriangle(mesh, pts[0]!, pts[i]!, pts[i + 1]!);
    }
  }

  const vtkBuffer = buildVtkXmlBuffer(mesh);
  const stlBuffer = buildBinaryStlBuffer(mesh);

  // Build CadComponent list from PRODUCT / MANIFOLD_SOLID_BREP / NEXT_ASSEMBLY_USAGE_OCCURRENCE
  const components: CadComponent[] = [];
  const palette: [number, number, number, number][] = [
    [0.24, 0.62, 0.92, 1.0],
    [0.25, 0.78, 0.52, 1.0],
    [0.95, 0.58, 0.22, 1.0],
    [0.72, 0.45, 0.92, 1.0],
  ];

  const namedEntities =
    nauos.length > 0
      ? nauos.map((n) => n.name)
      : manifoldBreps.length > 0
        ? manifoldBreps.map((b) => b.name)
        : products.length > 0
          ? products.map((p) => p.name)
          : [extractStepFilename(stepCode)?.replace(/\.(step|stp|p21)$/i, "") || "STEP_Solid"];

  namedEntities.forEach((rawName, idx) => {
    const cleanName = rawName.replace(/[^A-Za-z0-9_.-]/g, "_") || `Part_${idx + 1}`;
    const partColor = palette[idx % palette.length]!;
    const glbUri = buildGlbDataUri(mesh, cleanName, partColor);
    if (glbUri) {
      const offsetPt = placements[idx]?.ptId ? getPoint(placements[idx]!.ptId) : null;
      components.push({
        name: cleanName,
        cad: {
          uri: glbUri,
          position: offsetPt ?? [idx * 1.5, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        ports: [],
      });
    }
  });

  return { vtkBuffer, stlBuffer, components };
}

/** Tessellate OpenSCAD source primitives (cube, cylinder, sphere) into 3D CadComponents + VTK buffer. */
export function tessellateScadSource(scadCode: string): {
  vtkBuffer: Uint8Array;
  components: CadComponent[];
} {
  const mesh: TriangulatedMesh = { positions: [], normals: [] };
  const cubeRegex = /cube\s*\(\s*\[\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]/gi;
  let m: RegExpExecArray | null;
  while ((m = cubeRegex.exec(scadCode)) !== null) {
    const sx = Math.max(0.2, parseFloat(m[1]!) / 25);
    const sz = Math.max(0.2, parseFloat(m[2]!) / 25);
    const sy = Math.max(0.1, parseFloat(m[3]!) / 25);
    appendBoxTriangles(mesh, 0, sy / 2, 0, sx, sy, sz);
  }
  const cylRegex = /cylinder\s*\(([^)]*)\)/gi;
  while ((m = cylRegex.exec(scadCode)) !== null) {
    const args = m[1]!;
    const hMatch = /h\s*=\s*([0-9.]+)/.exec(args);
    const rMatch = /r\s*=\s*([0-9.]+)/.exec(args) ?? /d\s*=\s*([0-9.]+)/.exec(args);
    const h = Math.max(0.2, parseFloat(hMatch?.[1] || "12") / 25);
    const r = Math.max(0.1, parseFloat(rMatch?.[1] || "6") / 25);
    appendCylinderTriangles(mesh, 0, h / 2, 0, r, h, 24);
  }
  const vtkBuffer = buildVtkXmlBuffer(mesh);
  const glbUri = buildGlbDataUri(mesh, "OpenSCAD_Solid", [0.25, 0.78, 0.52, 1.0]);
  const components: CadComponent[] = glbUri
    ? [
        {
          name: "OpenSCAD_Solid",
          cad: { uri: glbUri, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          ports: [],
        },
      ]
    : [];
  return { vtkBuffer, components };
}

export function useMorselEngine({
  dialect = "modelica",
  documentUri,
  selectedTreeClassName,
  contextVersion,
  content,
  editor,
  showResultsView,
  setShowResultsView,
  isNarrow,
  setMobileTab,
  setTreeVisible,
  setView,
  viewDiagramEnum,
}: UseMorselEngineProps) {
  // ── Live Editor Value Tracking ──
  const [editorValue, setEditorValue] = useState<string>(content);
  useEffect(() => {
    setEditorValue(content || editor?.getValue() || "");
  }, [content, editor, contextVersion]);

  useEffect(() => {
    if (!editor) return;
    setEditorValue(editor.getValue());
    const disposable = editor.onDidChangeModelContent(() => {
      setEditorValue(editor.getValue());
    });
    return () => disposable.dispose();
  }, [editor]);

  // ── Simulation State ──
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>([]);
  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const [sweepState, setSweepState] = useState<SweepState | null>(null);
  const [sweepResults, setSweepResults] = useState<{ value: number; y: number[][] }[] | null>(null);
  const [experimentOverrides, setExperimentOverrides] = useState<ExperimentOverrides>({
    solver: "dassl",
    tolerance: 1e-4,
    equidistant: true,
  });
  const [cachedSimulator, setCachedSimulator] = useState<any>(null);
  const [simulationStatus, setSimulationStatus] = useState<any>(null);
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);

  // ── CAD & 3D Animation State ──
  const [cadComponents, setCadComponents] = useState<CadComponent[]>([]);
  const [vtkBuffer, setVtkBuffer] = useState<Uint8Array | null>(null);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const [animationMode, setAnimationMode] = useState<"stopped" | "playing" | "paused" | "live">("stopped");
  const [cosimDataSource, setCosimDataSource] = useState<"local" | "mqtt-live" | "historian-replay">("local");
  const mqttSessionId = selectedTreeClassName ? `live-${dialect}-${selectedTreeClassName}` : `live-${dialect}-default`;
  const mqtt = useMqttSimulation({ source: cosimDataSource, sessionId: mqttSessionId });

  // ── Ribbon Parameters ──
  const ribbonParams = useMemo(() => {
    if (simulationParameters.length > 0) return simulationParameters;
    return extractParametersFromCode(editorValue);
  }, [simulationParameters, editorValue]);

  const handleRibbonParamChange = useCallback((name: string, value: number) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
  }, []);

  const handleRibbonParamReset = useCallback((name: string) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const handleParameterChange = (name: string, value: number) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
  };

  const handleParameterReset = (name: string) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  };

  const handleExperimentOverrideChange = (name: string, value: any) => {
    setExperimentOverrides((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleExperimentOverrideReset = (name: string) => {
    setExperimentOverrides((prev) => {
      const { [name]: _omitted, ...rest } = prev as Record<string, any>;
      return rest;
    });
  };

  const handleToggleSimulationVariable = (variable: string) => {
    setSelectedSimulationVariables((prev) =>
      prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
    );
  };

  const handleVariablesLoaded = (variables: string[]) => {
    setSimulationVariables(variables);
    setSelectedSimulationVariables((prev) => (prev.length > 0 ? prev : variables.slice(0, 3)));
  };

  // ── Live MQTT sync ──
  useEffect(() => {
    if (cosimDataSource !== "mqtt-live") return;
    const client = getMorselMqttClient();
    const ctrl = animationControllerRef.current;
    if (ctrl) {
      ctrl.goLive();
    }
    const unsub = client.onVariableUpdate((participantId, variable, value) => {
      const controller = animationControllerRef.current;
      if (controller) {
        if (controller.mode !== "live") controller.goLive();
        const now = Date.now() / 1000;
        controller.pushLiveValue(variable, value, now);
        controller.pushLiveValue(`${participantId}.${variable}`, value, now);
      }
    });
    return () => unsub();
  }, [cosimDataSource]);

  // ── Historian Session Replay ──
  const handleReplaySession = useCallback(
    (session: HistorianSession, speed: number) => {
      let controller = animationControllerRef.current;
      if (!controller) {
        controller = new AnimationController();
        controller.onStateChange((s) => setAnimationMode(s.mode));
        animationControllerRef.current = controller;
      }

      const rawRows: Record<string, number>[] =
        ((session as any).chartData as Record<string, number>[] | undefined) ??
        ((session as any).rows as Record<string, number>[] | undefined) ??
        (localSimulationData as Record<string, number>[] | null) ??
        [];

      if (!rawRows || rawRows.length === 0) {
        return;
      }

      const t = rawRows.map((r, i) => (typeof r["time"] === "number" ? r["time"] : Number(r["time"]) || i * 0.1));
      const stateNames = Object.keys(rawRows[0] ?? {}).filter((k) => k !== "time");
      if (stateNames.length === 0) return;

      const y: number[][] = rawRows.map((row) => stateNames.map((name) => Number(row[name]) || 0));

      controller.loadTimeseries(t, y, stateNames);
      controller.setSpeed(speed);
      controller.play();

      setLocalSimulationData(rawRows);
      setSimulationStatus({ status: "completed", error: null });
    },
    [localSimulationData],
  );

  // ── Dynamic CAD geometry binding save & code writeback ──
  const handleSaveCadBindings = useCallback(
    (componentName: string, bindings: DynamicBindingConfig[]) => {
      if (!editor) return;
      const currentCode = editor.getValue();
      const patch = patchModelicaCadAnnotation(currentCode, componentName, { bindings });

      if (patch.updatedSource !== currentCode) {
        editor.setValue(patch.updatedSource);
      }

      setCadComponents((prev) =>
        prev.map((c) =>
          c.name === componentName
            ? {
                ...c,
                dynamicBindings: bindings.map((b) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index ?? 0,
                  variable: b.variable,
                  unit: b.unit,
                  scale: b.scale,
                  offset: b.offset,
                  format: b.format,
                })),
              }
            : c,
        ),
      );
    },
    [editor],
  );

  // ── Fetch CAD annotations or tessellate direct STEP / OpenSCAD 3D geometry ──
  useEffect(() => {
    let cancelled = false;

    if (isStepSource(editorValue, dialect)) {
      const { components: stepComps } = tessellateStepSource(editorValue);
      setVtkBuffer(null);
      setCadComponents(stepComps);
      return;
    }

    if (dialect === "scad") {
      const { components: scadComps } = tessellateScadSource(editorValue);
      setVtkBuffer(null);
      setCadComponents(scadComps);
      return;
    }

    const stepFileDirective = extractStepFilename(editorValue);
    if (stepFileDirective && !selectedTreeClassName) {
      const { components: stepComps } = tessellateStepSource(editorValue);
      setVtkBuffer(null);
      setCadComponents(stepComps);
      return;
    }

    setVtkBuffer(null);

    if (!selectedTreeClassName) {
      setCadComponents([]);
      return;
    }

    (getCadComponents as any)(documentUri, selectedTreeClassName)
      .then((components: any[]) => {
        if (cancelled) return;
        let parsed: any[] = components;
        if (!parsed || parsed.length === 0) {
          const sourceVars = parseSourceCadVariables(editorValue);
          parsed = extractCadComponents(sourceVars);
        }
        if ((!parsed || parsed.length === 0) && stepFileDirective) {
          const { components: stepComps } = tessellateStepSource(editorValue);
          setVtkBuffer(null);
          parsed = stepComps;
        }
        setCadComponents(parsed as CadComponent[]);

        let ctrl = animationControllerRef.current;
        if (!ctrl && parsed.length > 0) {
          ctrl = new AnimationController();
          ctrl.onStateChange((s) => setAnimationMode(s.mode));
          animationControllerRef.current = ctrl;
        }

        if (ctrl && parsed.length > 0) {
          ctrl.setBindings(
            parsed
              .filter((c: any) => c.dynamicBindings && c.dynamicBindings.length > 0)
              .map((c: any) => ({
                componentName: c.name,
                bindings: c.dynamicBindings!.map((b: any) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index,
                  variable: b.variable,
                })),
              })),
          );
          for (const comp of parsed) {
            const cadObj = typeof comp.cad === "object" && comp.cad ? comp.cad : {};
            ctrl.setDefault(comp.name, {
              position: cadObj.position ?? [0, 0, 0],
              rotation: cadObj.rotation ?? [0, 0, 0],
              scale: cadObj.scale ?? [1, 1, 1],
            });
          }
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) console.error("Failed to fetch CAD components:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTreeClassName, contextVersion, editorValue, dialect, documentUri]);

  // ── Live MQTT data bridge ──
  useEffect(() => {
    const ctrl = animationControllerRef.current;
    if (!ctrl || cosimDataSource !== "mqtt-live") {
      if (ctrl && ctrl.mode === "live") {
        ctrl.stop();
      }
      return;
    }

    if (ctrl.mode !== "live") {
      ctrl.goLive();
    }

    if (mqtt.latestValues.size > 0) {
      ctrl.pushLiveBatch(mqtt.latestValues, Date.now() / 1000);
    }
  }, [mqtt.latestValues, cosimDataSource]);

  // ── Lightweight re-simulate when parameter overrides change ──
  useEffect(() => {
    if (!showResultsView || parameterOverrides.size === 0 || !selectedTreeClassName) return;

    const timer = setTimeout(async () => {
      try {
        const overrideObj = Object.fromEntries(parameterOverrides);
        const result = await simulate(documentUri, {
          className: selectedTreeClassName,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime,
          stopTime: experimentOverrides.stopTime,
          interval: experimentOverrides.interval,
          solver: experimentOverrides.solver,
          numberOfIntervals: experimentOverrides.numberOfIntervals,
          rtol: experimentOverrides.tolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
        });

        if (result.error) throw new Error(result.error);

        const states = result.states ?? [];
        if (result.sweepResults) {
          setSweepResults(result.sweepResults);
          setLocalSimulationData(
            result.t.map((t: number, i: number) => {
              const rowObj: Record<string, number | string> = { time: t };
              result.sweepResults!.forEach((sweep) => {
                states.forEach((state: string, vIndex: number) => {
                  rowObj[`${state} (${sweep.value})`] = sweep.y[i]?.[vIndex] ?? 0;
                });
              });
              return rowObj;
            }),
          );
        } else {
          setSweepResults(null);
          const chartData = result.t.map((t: number, i: number) => {
            const row: Record<string, number | string> = { time: t };
            states.forEach((state: string, vIndex: number) => {
              row[state] = result.y[i]?.[vIndex] ?? 0;
            });
            return row;
          });
          setLocalSimulationData(chartData);
        }
        setSimulationStatus({ status: "completed", error: null });
      } catch (e) {
        if ((e as Error).name === "AbortError" || (e as Error).message === "Simulation aborted") return;
        const errMsg = e instanceof Error ? e.message : String(e);
        setSimulationStatus({ status: "failed", error: errMsg });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [parameterOverrides, sweepState, showResultsView, experimentOverrides, selectedTreeClassName, documentUri]);

  // ── Full Simulation Execution ──
  const handleSimulate = async () => {
    setSimulationStatus({ status: "pending", error: null });
    setLocalSimulationData(null);

    try {
      const overrideObj = Object.fromEntries(parameterOverrides);

      const result = await simulate(documentUri, {
        className: selectedTreeClassName ?? undefined,
        parameterOverrides: overrideObj,
        sweepConfig: sweepState ?? undefined,
        startTime: experimentOverrides.startTime,
        stopTime: experimentOverrides.stopTime,
        interval: experimentOverrides.interval,
        solver: experimentOverrides.solver,
        numberOfIntervals: experimentOverrides.numberOfIntervals,
        rtol: experimentOverrides.tolerance,
        atol: experimentOverrides.atol,
        equidistant: experimentOverrides.equidistant,
        steadyStateOnly: experimentOverrides.steadyStateOnly,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSimulationParameters((result.parameters as any) ?? []);

      const states = result.states ?? [];
      setSimulationVariables(states);

      if (result.sweepResults) {
        setSweepResults(result.sweepResults);
        setLocalSimulationData(
          result.t.map((t: number, i: number) => {
            const rowObj: Record<string, number | string> = { time: t };
            result.sweepResults!.forEach((sweep) => {
              states.forEach((state: string, vIndex: number) => {
                rowObj[`${state} (${sweep.value})`] = sweep.y[i]?.[vIndex] ?? 0;
              });
            });
            return rowObj;
          }),
        );
      } else {
        setSweepResults(null);
        const chartData = result.t.map((t: number, i: number) => {
          const row: Record<string, number | string> = { time: t };
          states.forEach((state: string, vIndex: number) => {
            row[state] = result.y[i]?.[vIndex] ?? 0;
          });
          return row;
        });
        setLocalSimulationData(chartData);
      }
      setSimulationStatus({ status: "completed" });
      setShowResultsView(true);
      if (isNarrow) {
        setMobileTab("results");
        setTreeVisible(false);
        setView(viewDiagramEnum);
      }

      // ── Animation setup ──
      if (cadComponents.length > 0) {
        let controller = animationControllerRef.current;
        if (!controller) {
          controller = new AnimationController();
          controller.onStateChange((s) => setAnimationMode(s.mode));
          animationControllerRef.current = controller;
        }
        controller.setBindings(
          cadComponents
            .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
            .map((c) => ({
              componentName: c.name,
              bindings: c.dynamicBindings!.map((b) => ({
                property: b.property as "position" | "rotation" | "scale",
                index: b.index,
                variable: b.variable,
                unit: (b as any).unit,
                scale: (b as any).scale,
                offset: (b as any).offset,
                format: (b as any).format,
              })),
            })),
        );
        for (const comp of cadComponents) {
          controller.setDefault(comp.name, {
            position: comp.cad.position ?? [0, 0, 0],
            rotation: comp.cad.rotation ?? [0, 0, 0],
            scale: comp.cad.scale ?? [1, 1, 1],
          });
        }
        controller.loadTimeseries(result.t, result.y, result.states);
        const hasDynamic = cadComponents.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
        if (hasDynamic) {
          controller.play();
        }
      }
    } catch (e: any) {
      if (e.message === "Simulation aborted") {
        return;
      }
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      setShowResultsView(true);
      if (isNarrow) {
        setMobileTab("results");
        setTreeVisible(false);
        setView(viewDiagramEnum);
      }
    }
  };

  return {
    simulationVariables,
    setSimulationVariables,
    selectedSimulationVariables,
    setSelectedSimulationVariables,
    handleToggleSimulationVariable,
    handleVariablesLoaded,
    simulationParameters,
    setSimulationParameters,
    parameterOverrides,
    setParameterOverrides,
    handleParameterChange,
    handleParameterReset,
    sweepState,
    setSweepState,
    sweepResults,
    setSweepResults,
    experimentOverrides,
    setExperimentOverrides,
    handleExperimentOverrideChange,
    handleExperimentOverrideReset,
    cachedSimulator,
    setCachedSimulator,
    simulationStatus,
    setSimulationStatus,
    localSimulationData,
    setLocalSimulationData,
    cadComponents,
    setCadComponents,
    vtkBuffer,
    setVtkBuffer,
    editorValue,
    animationControllerRef,
    animationMode,
    setAnimationMode,
    cosimDataSource,
    setCosimDataSource,
    ribbonParams,
    handleRibbonParamChange,
    handleRibbonParamReset,
    handleReplaySession,
    handleSaveCadBindings,
    handleSimulate,
  };
}
