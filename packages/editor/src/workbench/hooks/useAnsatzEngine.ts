// SPDX-License-Identifier: AGPL-3.0-or-later

import { type AmplSolveResultData } from "@modelscript/ampl/ui/AmplOptimizationResults";
import {
  patchModelicaCadAnnotation,
  type DynamicBindingConfig,
  type GdtOverlayPayload,
  type ModelicaTelemetryParams,
  type SpoolKinematicsSpec,
} from "@modelscript/cad";
import { extractThreeMfCadComponents } from "@modelscript/three-mf/cad";
import { extractUsdCadComponents } from "@modelscript/usd/cad";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorModelingPreferences as useModelingPreferences, useEditorToast as useToast } from "../../host";
import { extractParametersFromCode } from "../../internal/modelica-params";
import {
  type CadComponent,
  type CommitAssemblyJointPayload,
  type CommitDimensionPayload,
  type CommitFaceTagPayload,
  type GizmoCommitPayload,
} from "../cad-viewer";
import { AnimationController } from "../cad-viewer/animation-controller";
import { extractCadComponents, parseSourceCadVariables } from "../cad-viewer/parse-cad-annotations";
import { type HistorianSession } from "../CosimPanel";
import type { MobileTab } from "../panels/AnsatzMobileTabBar";
import type { AnsatzView } from "../panels/types";
import { type ExperimentOverrides, type ParameterInfo, type SweepState } from "../SimulationParameters";
import {
  applyCadEditInAnsatz,
  compileStepFromSourcesInAnsatz,
  executeLspAction,
  extractPrimaryModelicaClassName,
  getCadComponents,
  getStepMeshesInAnsatz,
  onSimulationProgress,
  simulate,
} from "../util/lsp-bridge";
import { getAnsatzMqttClient } from "../util/mqtt-client";
import {
  buildAnsatzEffectiveFileMap,
  compileAnsatzOptionAAssembly,
  resolveSpoolRulesForAnsatz,
  type CachedAnsatzStepCompilation,
} from "../util/step-pairing";
import { useMqttSimulation } from "../util/use-mqtt-simulation";

export interface SimulationStatusState {
  status: "pending" | "processing" | "completed" | "failed" | "running" | "error" | "idle";
  error?: string | null | undefined;
  progress?: number | undefined;
  message?: string | undefined;
  jobId?: string | undefined;
}

export interface ExperimentMetaState {
  StartTime: number;
  StopTime: number;
  Tolerance: number;
  Interval: number;
  startTime: number;
  stopTime: number;
  tolerance: number;
  interval: number;
  numberOfIntervals: number;
  solver: string;
  flattenerBackend: string;
  diagramAutoLayout: boolean;
  enableExperimentalFeatures: boolean;
}

export interface CachedSimulatorState {
  experiment: ExperimentMetaState;
  dae: {
    experiment: ExperimentMetaState;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UseAnsatzEngineProps {
  dialect?: string | undefined;
  documentUri: string;
  selectedTreeClassName: string | null;
  contextVersion: number;
  content: string;
  editor: editor.ICodeEditor | null;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showCadView?: boolean | undefined;
  isNarrow: boolean;
  setMobileTab: (tab: MobileTab) => void;
  setTreeVisible: (v: boolean) => void;
  setView: (v: AnsatzView) => void;
  viewDiagramEnum: AnsatzView;
  initialSimulationVariables?: string[] | undefined;
  initialStartTime?: number | undefined;
  initialStopTime?: number | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  /** Optional non-destructive OpenSCAD source with feature-tree modifiers (`*`, `!`, `#`) applied. */
  scadOverrideCode?: string | undefined;
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

function appendSphereTriangles(
  out: TriangulatedMesh,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  latBands = 16,
  lonBands = 24,
): void {
  for (let lat = 0; lat < latBands; lat++) {
    const theta0 = (lat / latBands) * Math.PI;
    const theta1 = ((lat + 1) / latBands) * Math.PI;
    const sinT0 = Math.sin(theta0);
    const cosT0 = Math.cos(theta0);
    const sinT1 = Math.sin(theta1);
    const cosT1 = Math.cos(theta1);

    for (let lon = 0; lon < lonBands; lon++) {
      const phi0 = (lon / lonBands) * Math.PI * 2;
      const phi1 = ((lon + 1) / lonBands) * Math.PI * 2;
      const cosP0 = Math.cos(phi0);
      const sinP0 = Math.sin(phi0);
      const cosP1 = Math.cos(phi1);
      const sinP1 = Math.sin(phi1);

      const p00: [number, number, number] = [
        cx + radius * sinT0 * cosP0,
        cy + radius * cosT0,
        cz + radius * sinT0 * sinP0,
      ];
      const p01: [number, number, number] = [
        cx + radius * sinT0 * cosP1,
        cy + radius * cosT0,
        cz + radius * sinT0 * sinP1,
      ];
      const p10: [number, number, number] = [
        cx + radius * sinT1 * cosP0,
        cy + radius * cosT1,
        cz + radius * sinT1 * sinP0,
      ];
      const p11: [number, number, number] = [
        cx + radius * sinT1 * cosP1,
        cy + radius * cosT1,
        cz + radius * sinT1 * sinP1,
      ];

      if (lat !== 0) {
        pushTriangle(out, p00, p10, p01);
      }
      if (lat !== latBands - 1) {
        pushTriangle(out, p01, p10, p11);
      }
    }
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
export function tessellateStepSource(
  stepCode: string,
  options?: {
    /**
     * Rescale large (millimeter) models to fit a unit viewport. Defaults to true; pass `false` to keep
     * native STEP coordinates, e.g. when registering the model against QIF inspection coordinates.
     */
    normalize?: boolean;
  },
): {
  vtkBuffer: Uint8Array;
  stlBuffer: Uint8Array;
  components: CadComponent[];
} {
  const cartesianPoints = new Map<number, [number, number, number]>();
  const directions = new Map<number, [number, number, number]>();
  const axisPlacements = new Map<number, { ptId: number; zDirId?: number; xDirId?: number }>();
  const cylSurfaces = new Map<number, { axisId: number; radius: number }>();
  const coneSurfaces = new Map<number, { axisId: number; radius: number; semiAngle: number }>();
  const sphSurfaces = new Map<number, { axisId: number; radius: number }>();
  const torSurfaces = new Map<number, { axisId: number; major: number; minor: number }>();
  const vertexPoints = new Map<number, number>();
  const edgeCurves = new Map<number, [number, number]>();
  const orientedEdges = new Map<number, { edge: number; sense: boolean }>();
  const edgeLoops = new Map<number, number[]>();
  const polyLoops = new Map<number, number[]>();
  const faceBounds = new Map<number, { loopId: number; isOuter: boolean }>();
  const faceById = new Map<
    number,
    { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean }
  >();
  const shells = new Map<number, number[]>();
  const advancedFaces: { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean }[] = [];
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

    if (type === "CARTESIAN_POINT" || type === "DIRECTION") {
      const coordsMatch =
        /\(\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)(?:\s*,\s*([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?))?\s*\)/.exec(
          args,
        );
      if (coordsMatch) {
        const vec: [number, number, number] = [
          parseFloat(coordsMatch[1] || "0"),
          parseFloat(coordsMatch[2] || "0"),
          parseFloat(coordsMatch[3] || "0"),
        ];
        if (type === "CARTESIAN_POINT") {
          cartesianPoints.set(id, vec);
        } else {
          directions.set(id, vec);
        }
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
      if (refMatch) faceBounds.set(id, { loopId: parseInt(refMatch[1]!, 10), isOuter: type === "FACE_OUTER_BOUND" });
    } else if (type === "CYLINDRICAL_SURFACE" || type === "SPHERICAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      const radius = nums[nums.length - 1] ?? 1;
      if (type === "CYLINDRICAL_SURFACE") {
        cylSurfaces.set(id, { axisId, radius });
      } else {
        sphSurfaces.set(id, { axisId, radius });
      }
    } else if (type === "CONICAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      coneSurfaces.set(id, {
        axisId,
        radius: nums.length >= 2 ? nums[nums.length - 2]! : 1,
        semiAngle: nums[nums.length - 1] ?? 0,
      });
    } else if (type === "TOROIDAL_SURFACE") {
      const axisMatch = /#(\d+)/.exec(args);
      const nums = Array.from(args.replace(/#\d+/g, "").matchAll(/([+-]?\d*\.?\d+(?:[eE][+-]?\d+)?)/g)).map((m) =>
        parseFloat(m[1]!),
      );
      const axisId = axisMatch ? parseInt(axisMatch[1]!, 10) : 0;
      torSurfaces.set(id, {
        axisId,
        major: nums.length >= 2 ? nums[nums.length - 2]! : 1,
        minor: nums[nums.length - 1] ?? 0.25,
      });
    } else if (type === "ADVANCED_FACE" || type === "FACE_SURFACE") {
      const nameMatch = /'([^']*)'/.exec(args);
      const boundListMatch = /\(([^)]*)\)/.exec(args);
      const bounds = boundListMatch
        ? Array.from(boundListMatch[1]!.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10))
        : [];
      const tailArgs = boundListMatch ? args.slice(boundListMatch.index + boundListMatch[0].length) : args;
      const surfMatch = /#(\d+)/.exec(tailArgs);
      const surfaceId = surfMatch ? parseInt(surfMatch[1]!, 10) : undefined;
      const sameSense = !/\.\s*F\s*\./.test(tailArgs);
      const faceObj = { id, name: nameMatch?.[1] || `Face_${id}`, bounds, surfaceId, sameSense };
      advancedFaces.push(faceObj);
      faceById.set(id, faceObj);
    } else if (type === "CLOSED_SHELL" || type === "OPEN_SHELL") {
      const faceListMatch = /\(([\s\S]*)\)/.exec(args);
      const faceIds = faceListMatch
        ? Array.from(faceListMatch[1]!.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10))
        : [];
      shells.set(id, faceIds);
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
      const refs = Array.from(args.matchAll(/#(\d+)/g)).map((m) => parseInt(m[1]!, 10));
      const ptId = refs[0] ?? 0;
      placements.push({ id, name: nameMatch?.[1] || `Axis_${id}`, ptId });
      axisPlacements.set(id, { ptId, zDirId: refs[1], xDirId: refs[2] });
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
  const scaleFactor = options?.normalize !== false && maxCoord > 10 ? (1 / maxCoord) * 1.5 : 1.0;

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

  const norm3 = (v: [number, number, number]): [number, number, number] => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  const cross3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];

  const dot3 = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const resolveAxisFrame = (axisId: number) => {
    const ax = axisPlacements.get(axisId);
    const origin = (ax ? getPoint(ax.ptId) : null) ?? ([0, 0, 0] as [number, number, number]);
    const rawZ = ax?.zDirId !== undefined ? directions.get(ax.zDirId) : undefined;
    const zAxis = norm3(rawZ ?? [0, 0, 1]);
    const rawX = ax?.xDirId !== undefined ? directions.get(ax.xDirId) : undefined;
    let xCandidate: [number, number, number] = rawX ?? (Math.abs(zAxis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
    const proj = dot3(xCandidate, zAxis);
    xCandidate = [xCandidate[0] - proj * zAxis[0], xCandidate[1] - proj * zAxis[1], xCandidate[2] - proj * zAxis[2]];
    const xAxis = norm3(xCandidate);
    const yAxis = norm3(cross3(zAxis, xAxis));
    return { origin, xAxis, yAxis, zAxis };
  };

  const emitTri = (
    targetMesh: TriangulatedMesh,
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    flip = false,
  ) => {
    if (flip) {
      pushTriangle(targetMesh, a, c, b);
      pushTriangle(mesh, a, c, b);
    } else {
      pushTriangle(targetMesh, a, b, c);
      pushTriangle(mesh, a, b, c);
    }
  };

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

  /** Ear-clipping planar polygon triangulator preserving concave L/U shapes. */
  const triangulatePolygon3D = (pts: [number, number, number][], targetMesh: TriangulatedMesh) => {
    if (pts.length < 3) return;
    if (pts.length === 3) {
      emitTri(targetMesh, pts[0]!, pts[1]!, pts[2]!);
      return;
    }
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const n = norm3([nx, ny, nz]);
    const ref: [number, number, number] = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm3(cross3(n, ref));
    const v = norm3(cross3(n, u));
    const proj2D = pts.map((p) => [dot3(p, u), dot3(p, v)] as [number, number]);
    const indices = pts.map((_, idx) => idx);
    let area2 = 0;
    for (let i = 0; i < proj2D.length; i++) {
      const a = proj2D[i]!;
      const b = proj2D[(i + 1) % proj2D.length]!;
      area2 += a[0] * b[1] - b[0] * a[1];
    }
    const ccw = area2 >= 0;
    const cross2 = (a: [number, number], b: [number, number], c: [number, number]) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const pointInTri = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
      const s1 = cross2(a, b, p);
      const s2 = cross2(b, c, p);
      const s3 = cross2(c, a, p);
      return ccw ? s1 >= -1e-7 && s2 >= -1e-7 && s3 >= -1e-7 : s1 <= 1e-7 && s2 <= 1e-7 && s3 <= 1e-7;
    };
    let guard = indices.length * indices.length + 10;
    while (indices.length > 3 && guard-- > 0) {
      let clipped = false;
      for (let i = 0; i < indices.length; i++) {
        const i0 = indices[(i - 1 + indices.length) % indices.length]!;
        const i1 = indices[i]!;
        const i2 = indices[(i + 1) % indices.length]!;
        const cr = cross2(proj2D[i0]!, proj2D[i1]!, proj2D[i2]!);
        if (ccw ? cr <= 1e-7 : cr >= -1e-7) continue;
        let hasInside = false;
        for (const other of indices) {
          if (other === i0 || other === i1 || other === i2) continue;
          if (pointInTri(proj2D[other]!, proj2D[i0]!, proj2D[i1]!, proj2D[i2]!)) {
            hasInside = true;
            break;
          }
        }
        if (!hasInside) {
          emitTri(targetMesh, pts[i0]!, pts[i1]!, pts[i2]!);
          indices.splice(i, 1);
          clipped = true;
          break;
        }
      }
      if (!clipped) break;
    }
    for (let i = 1; i + 1 < indices.length; i++) {
      emitTri(targetMesh, pts[indices[0]!]!, pts[indices[i]!]!, pts[indices[i + 1]!]!);
    }
  };

  const collectFaceBoundVertices = (bounds: number[]): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (const bId of bounds) {
      const entry = faceBounds.get(bId);
      const loopId = entry?.loopId ?? bId;
      triangulatedLoopIds.add(loopId);
      const polyPts = polyLoops.get(loopId);
      if (polyPts) {
        for (const vId of polyPts) {
          const p = getPoint(vId);
          if (p) out.push(p);
        }
      }
      const oEdges = edgeLoops.get(loopId);
      if (oEdges) {
        for (const oeId of oEdges) {
          const oe = orientedEdges.get(oeId);
          const ec = edgeCurves.get(oe ? oe.edge : oeId);
          if (ec) {
            const p0 = getPoint(ec[0]);
            const p1 = getPoint(ec[1]);
            if (p0) out.push(p0);
            if (p1) out.push(p1);
          }
        }
      }
    }
    return out;
  };

  const triangulatedLoopIds = new Set<number>();
  const tessellateFace = (
    face: { id: number; name: string; bounds: number[]; surfaceId?: number; sameSense: boolean },
    targetMesh: TriangulatedMesh,
  ) => {
    if (face.surfaceId !== undefined) {
      const cyl = cylSurfaces.get(face.surfaceId) ?? coneSurfaces.get(face.surfaceId);
      if (cyl) {
        const boundPts = collectFaceBoundVertices(face.bounds);
        const { origin, xAxis, yAxis, zAxis } = resolveAxisFrame(cyl.axisId);
        let zMin = Infinity;
        let zMax = -Infinity;
        for (const p of boundPts) {
          const z = dot3([p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]], zAxis);
          if (z < zMin) zMin = z;
          if (z > zMax) zMax = z;
        }
        if (Number.isFinite(zMin) && Number.isFinite(zMax) && zMax - zMin > 1e-6) {
          const semiAngle = "semiAngle" in cyl ? cyl.semiAngle : 0;
          const rBase = cyl.radius * scaleFactor;
          const r0 = Math.max(1e-4, rBase + zMin * Math.tan(semiAngle));
          const r1 = Math.max(1e-4, rBase + zMax * Math.tan(semiAngle));
          const segs = 24;
          const flip = !face.sameSense;
          for (let i = 0; i < segs; i++) {
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            const c0 = Math.cos(a0);
            const s0 = Math.sin(a0);
            const c1 = Math.cos(a1);
            const s1 = Math.sin(a1);
            const pt = (r: number, c: number, s: number, z: number): [number, number, number] => [
              origin[0] + r * (c * xAxis[0] + s * yAxis[0]) + z * zAxis[0],
              origin[1] + r * (c * xAxis[1] + s * yAxis[1]) + z * zAxis[1],
              origin[2] + r * (c * xAxis[2] + s * yAxis[2]) + z * zAxis[2],
            ];
            const p00 = pt(r0, c0, s0, zMin);
            const p10 = pt(r0, c1, s1, zMin);
            const p11 = pt(r1, c1, s1, zMax);
            const p01 = pt(r1, c0, s0, zMax);
            emitTri(targetMesh, p00, p10, p11, flip);
            emitTri(targetMesh, p00, p11, p01, flip);
          }
          return;
        }
      }

      const sph = sphSurfaces.get(face.surfaceId);
      if (sph) {
        collectFaceBoundVertices(face.bounds);
        const { origin } = resolveAxisFrame(sph.axisId);
        const r = Math.max(1e-4, sph.radius * scaleFactor);
        appendSphereTriangles(targetMesh, origin[0], origin[1], origin[2], r, 14, 24);
        appendSphereTriangles(mesh, origin[0], origin[1], origin[2], r, 14, 24);
        return;
      }

      const tor = torSurfaces.get(face.surfaceId);
      if (tor) {
        collectFaceBoundVertices(face.bounds);
        const { origin, xAxis, yAxis, zAxis } = resolveAxisFrame(tor.axisId);
        const maj = Math.max(1e-4, tor.major * scaleFactor);
        const minR = Math.max(1e-4, tor.minor * scaleFactor);
        const majSegs = 24;
        const minSegs = 14;
        const flip = !face.sameSense;
        const ptT = (uA: number, vA: number): [number, number, number] => {
          const cu = Math.cos(uA);
          const su = Math.sin(uA);
          const cv = Math.cos(vA);
          const sv = Math.sin(vA);
          const ringR = maj + minR * cv;
          return [
            origin[0] + ringR * (cu * xAxis[0] + su * yAxis[0]) + minR * sv * zAxis[0],
            origin[1] + ringR * (cu * xAxis[1] + su * yAxis[1]) + minR * sv * zAxis[1],
            origin[2] + ringR * (cu * xAxis[2] + su * yAxis[2]) + minR * sv * zAxis[2],
          ];
        };
        for (let i = 0; i < majSegs; i++) {
          const u0 = (i / majSegs) * Math.PI * 2;
          const u1 = ((i + 1) / majSegs) * Math.PI * 2;
          for (let j = 0; j < minSegs; j++) {
            const v0 = (j / minSegs) * Math.PI * 2;
            const v1 = ((j + 1) / minSegs) * Math.PI * 2;
            const p00 = ptT(u0, v0);
            const p10 = ptT(u1, v0);
            const p11 = ptT(u1, v1);
            const p01 = ptT(u0, v1);
            emitTri(targetMesh, p00, p10, p11, flip);
            emitTri(targetMesh, p00, p11, p01, flip);
          }
        }
        return;
      }
    }

    const resolvedBounds = face.bounds.map((bId) => ({
      bId,
      entry: faceBounds.get(bId),
    }));
    const hasExplicitOuter = resolvedBounds.some((b) => b.entry?.isOuter);
    for (const { bId, entry } of resolvedBounds) {
      const loopId = entry?.loopId ?? bId;
      triangulatedLoopIds.add(loopId);
      // Skip inner hole bounds when an outer boundary is present so drill/pocket holes aren't filled solid
      if (hasExplicitOuter && entry && !entry.isOuter) {
        continue;
      }
      const polyPts = polyLoops.get(loopId);
      if (polyPts && polyPts.length >= 3) {
        const pts = polyPts.map(getPoint).filter((p): p is [number, number, number] => p !== null);
        triangulatePolygon3D(pts, targetMesh);
        continue;
      }
      const oEdges = edgeLoops.get(loopId);
      if (oEdges && oEdges.length >= 3) {
        const pts = resolveEdgeLoopPts(oEdges);
        triangulatePolygon3D(pts, targetMesh);
      }
    }
  };

  // 1. Tessellate per-solid meshes when MANIFOLD_SOLID_BREP -> CLOSED_SHELL -> ADVANCED_FACE hierarchy is present
  const attributedFaceIds = new Set<number>();
  const solidMeshes: TriangulatedMesh[] = manifoldBreps.map((brep) => {
    const partMesh: TriangulatedMesh = { positions: [], normals: [] };
    const shellFaces = shells.get(brep.shellId) ?? [];
    for (const fId of shellFaces) {
      const face = faceById.get(fId);
      if (face && !attributedFaceIds.has(fId)) {
        attributedFaceIds.add(fId);
        tessellateFace(face, partMesh);
      }
    }
    return partMesh;
  });

  // 1a. Tessellate any remaining ADVANCED_FACE / FACE_SURFACE not owned by a shell
  for (const face of advancedFaces) {
    if (attributedFaceIds.has(face.id)) continue;
    const discardMesh: TriangulatedMesh = { positions: [], normals: [] };
    tessellateFace(face, discardMesh);
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

  const hasExactSolidMeshes = solidMeshes.some((m) => m.positions.length > 0);
  const totalTriangles = Math.floor(mesh.positions.length / 9);
  const entityCount = Math.max(1, namedEntities.length);

  namedEntities.forEach((rawName, idx) => {
    const cleanName = rawName.replace(/[^A-Za-z0-9_.-]/g, "_") || `Part_${idx + 1}`;
    const partColor = palette[idx % palette.length]!;
    let partMesh: TriangulatedMesh;
    const exactSolidMesh = hasExactSolidMeshes ? solidMeshes[idx] : undefined;
    if (exactSolidMesh && exactSolidMesh.positions.length > 0) {
      partMesh = exactSolidMesh;
    } else if (entityCount === 1) {
      partMesh = mesh;
    } else if (totalTriangles >= entityCount) {
      const startTri = Math.floor((idx * totalTriangles) / entityCount);
      const endTri = Math.floor(((idx + 1) * totalTriangles) / entityCount);
      partMesh = {
        positions: mesh.positions.slice(startTri * 9, endTri * 9),
        normals: mesh.normals.slice(startTri * 9, endTri * 9),
      };
    } else if (idx < totalTriangles) {
      partMesh = {
        positions: mesh.positions.slice(idx * 9, (idx + 1) * 9),
        normals: mesh.normals.slice(idx * 9, (idx + 1) * 9),
      };
    } else {
      partMesh = { positions: [], normals: [] };
    }
    const glbUri = buildGlbDataUri(partMesh, cleanName, partColor);
    if (glbUri) {
      const offsetPt = placements[idx]?.ptId ? getPoint(placements[idx]!.ptId) : null;
      components.push({
        name: cleanName,
        cad: {
          uri: glbUri,
          position: offsetPt ?? [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        ports: [],
      });
    }
  });

  return { vtkBuffer, stlBuffer, components };
}

function attachScadKinematicController(
  scadCode: string,
  components: CadComponent[],
  ctrlRef: { current: AnimationController | null },
  setAnimationMode: (mode: "stopped" | "playing" | "paused" | "live") => void,
  structuredSpools?: readonly SpoolKinematicsSpec[],
  telemetry?: ModelicaTelemetryParams,
): CadComponent[] {
  const spoolRules = resolveSpoolRulesForAnsatz(scadCode, structuredSpools, telemetry);

  if (spoolRules.length === 0 || components.length === 0) {
    return components;
  }

  const enhanced = components.map((comp) => {
    const nameLower = comp.name.toLowerCase();
    const matched = spoolRules.filter(
      (r) => !r.match || nameLower === r.match || nameLower.includes(r.match) || r.match.includes(nameLower),
    );
    if (matched.length === 0) return comp;
    return {
      ...comp,
      dynamicBindings: [
        ...(comp.dynamicBindings ?? []),
        ...matched.map((r) => ({
          property: "rotation" as const,
          index: r.axisIndex,
          variable: r.varName,
        })),
      ],
    };
  });

  const anyBound = enhanced.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
  if (!anyBound) return components;

  let ctrl = ctrlRef.current;
  if (!ctrl) {
    ctrl = new AnimationController();
    ctrl.onStateChange((s) => setAnimationMode(s.mode));
    ctrlRef.current = ctrl;
  }

  ctrl.setBindings(
    enhanced
      .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
      .map((c) => ({
        componentName: c.name,
        bindings: c.dynamicBindings!.map((b) => ({
          property: b.property,
          index: b.index,
          variable: b.variable,
        })),
      })),
  );
  for (const comp of enhanced) {
    const cadObj = typeof comp.cad === "object" && comp.cad ? comp.cad : undefined;
    ctrl.setDefault(comp.name, {
      position: cadObj?.position ?? [0, 0, 0],
      rotation: [0, 0, 0],
      scale: cadObj?.scale ?? [1, 1, 1],
    });
  }

  const dt = 0.05;
  const steps = 200;
  const t: number[] = [];
  const y: number[][] = [];
  const varNames = spoolRules.map((r) => r.varName);
  for (let i = 0; i <= steps; i++) {
    const ti = i * dt;
    t.push(ti);
    y.push(spoolRules.map((r) => ti * r.degPerSec));
  }
  ctrl.loadTimeseries(t, y, varNames);
  ctrl.setLoop(true);
  ctrl.play();
  return enhanced;
}

function isIdentCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
}

function isWhitespaceCharCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

const MODELICA_CLASS_KEYWORDS = new Set(["model", "block", "class", "package", "function", "record"]);

function hasModelicaClassDeclaration(code: string, className: string): boolean {
  if (!className) return false;
  const n = code.length;
  let i = 0;
  while (i < n) {
    const ch = code.charCodeAt(i);
    // Skip line comments // ...
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 47) {
      i += 2;
      while (i < n && code.charCodeAt(i) !== 10) i++;
      continue;
    }
    // Skip block comments /* ... */
    if (ch === 47 && i + 1 < n && code.charCodeAt(i + 1) === 42) {
      i += 2;
      while (i + 1 < n && !(code.charCodeAt(i) === 42 && code.charCodeAt(i + 1) === 47)) i++;
      i += 2;
      continue;
    }
    // Skip string literals "..."
    if (ch === 34) {
      i++;
      while (i < n && code.charCodeAt(i) !== 34) {
        if (code.charCodeAt(i) === 92) i++;
        i++;
      }
      i++;
      continue;
    }
    if (isIdentCharCode(ch)) {
      const start = i;
      while (i < n && isIdentCharCode(code.charCodeAt(i))) i++;
      const tok = code.slice(start, i);
      if (MODELICA_CLASS_KEYWORDS.has(tok)) {
        let j = i;
        while (j < n && isWhitespaceCharCode(code.charCodeAt(j))) j++;
        if (j > i && j < n && isIdentCharCode(code.charCodeAt(j))) {
          const nameStart = j;
          while (j < n && isIdentCharCode(code.charCodeAt(j))) j++;
          if (code.slice(nameStart, j) === className) return true;
        }
      }
      continue;
    }
    i++;
  }
  return false;
}

function findBalancedExperimentBody(code: string): string | null {
  const lower = code.toLowerCase();
  const n = code.length;
  let pos = 0;
  while (pos < n) {
    const idx = lower.indexOf("experiment", pos);
    if (idx < 0) return null;
    const beforeOk = idx === 0 || !isIdentCharCode(code.charCodeAt(idx - 1));
    const afterIdx = idx + 10;
    const afterOk = afterIdx >= n || !isIdentCharCode(code.charCodeAt(afterIdx));
    if (beforeOk && afterOk) {
      let j = afterIdx;
      while (j < n && isWhitespaceCharCode(code.charCodeAt(j))) j++;
      if (j < n && code.charCodeAt(j) === 40) {
        // '('
        const openIdx = j;
        let depth = 1;
        j++;
        while (j < n && depth > 0) {
          const c = code.charCodeAt(j);
          if (c === 34 || c === 39) {
            const quote = c;
            j++;
            while (j < n && code.charCodeAt(j) !== quote) {
              if (code.charCodeAt(j) === 92) j++;
              j++;
            }
          } else if (c === 40) {
            depth++;
          } else if (c === 41) {
            depth--;
            if (depth === 0) return code.slice(openIdx + 1, j);
          }
          j++;
        }
        return null;
      }
    }
    pos = idx + 10;
  }
  return null;
}

function parseExperimentAttributes(body: string): Map<string, { raw: string; quoted: boolean }> {
  const attrs = new Map<string, { raw: string; quoted: boolean }>();
  const n = body.length;
  let i = 0;
  while (i < n) {
    while (i < n && (isWhitespaceCharCode(body.charCodeAt(i)) || body.charCodeAt(i) === 44)) i++;
    if (i >= n) break;
    if (!isIdentCharCode(body.charCodeAt(i))) {
      i++;
      continue;
    }
    const keyStart = i;
    while (i < n && isIdentCharCode(body.charCodeAt(i))) i++;
    const key = body.slice(keyStart, i).toLowerCase();

    while (i < n && isWhitespaceCharCode(body.charCodeAt(i))) i++;
    if (i >= n || body.charCodeAt(i) !== 61) {
      // Skip until next top-level comma
      let depth = 0;
      while (i < n) {
        const c = body.charCodeAt(i);
        if (c === 34 || c === 39) {
          const q = c;
          i++;
          while (i < n && body.charCodeAt(i) !== q) {
            if (body.charCodeAt(i) === 92) i++;
            i++;
          }
        } else if (c === 40) {
          depth++;
        } else if (c === 41 && depth > 0) {
          depth--;
        } else if (c === 44 && depth === 0) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    i++; // consume '='
    while (i < n && isWhitespaceCharCode(body.charCodeAt(i))) i++;
    if (i >= n) break;

    const first = body.charCodeAt(i);
    if (first === 34 || first === 39) {
      const quote = first;
      i++;
      const valStart = i;
      while (i < n && body.charCodeAt(i) !== quote) {
        if (body.charCodeAt(i) === 92) i++;
        i++;
      }
      const val = body.slice(valStart, i);
      if (i < n && body.charCodeAt(i) === quote) i++;
      if (!attrs.has(key)) attrs.set(key, { raw: val, quoted: true });
    } else {
      const valStart = i;
      let depth = 0;
      while (i < n) {
        const c = body.charCodeAt(i);
        if (c === 40) depth++;
        else if (c === 41 && depth > 0) depth--;
        else if (depth === 0 && (c === 44 || isWhitespaceCharCode(c))) break;
        i++;
      }
      const val = body.slice(valStart, i).trim();
      if (!attrs.has(key)) attrs.set(key, { raw: val, quoted: false });
    }
  }
  return attrs;
}

/** Extract experiment(StartTime=..., StopTime=..., Tolerance=..., Interval=...) annotation from source. */
export function extractExperimentFromCode(code: string): {
  StartTime?: number;
  StopTime?: number;
  Tolerance?: number;
  Interval?: number;
  startTime?: number;
  stopTime?: number;
  tolerance?: number;
  interval?: number;
  numberOfIntervals?: number;
  solver?: string;
} | null {
  const body = findBalancedExperimentBody(code);
  if (!body) return null;
  const attrs = parseExperimentAttributes(body);
  const numAttr = (name: string): number | undefined => {
    const entry = attrs.get(name.toLowerCase());
    if (!entry || entry.quoted || !entry.raw) return undefined;
    const parsed = Number(entry.raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const strAttr = (name: string): string | undefined => {
    const entry = attrs.get(name.toLowerCase());
    return entry?.quoted && entry.raw.length > 0 ? entry.raw : undefined;
  };
  const startTime = numAttr("StartTime");
  const stopTime = numAttr("StopTime");
  const tolerance = numAttr("Tolerance");
  const interval = numAttr("Interval");
  const numberOfIntervals = numAttr("NumberOfIntervals");
  const solver = strAttr("Algorithm") ?? strAttr("__Dymola_Algorithm") ?? strAttr("Solver");
  if (
    startTime === undefined &&
    stopTime === undefined &&
    tolerance === undefined &&
    interval === undefined &&
    numberOfIntervals === undefined &&
    solver === undefined
  ) {
    return null;
  }
  return {
    ...(startTime !== undefined ? { startTime, StartTime: startTime } : {}),
    ...(stopTime !== undefined ? { stopTime, StopTime: stopTime } : {}),
    ...(tolerance !== undefined ? { tolerance, Tolerance: tolerance } : {}),
    ...(interval !== undefined ? { interval, Interval: interval } : {}),
    ...(numberOfIntervals !== undefined ? { numberOfIntervals } : {}),
    ...(solver !== undefined ? { solver } : {}),
  };
}

export function useAnsatzEngine({
  dialect = "modelica",
  documentUri,
  selectedTreeClassName,
  contextVersion,
  content,
  editor,
  showResultsView,
  setShowResultsView,
  showCadView = false,
  isNarrow,
  setMobileTab,
  setTreeVisible,
  setView,
  viewDiagramEnum,
  initialSimulationVariables,
  initialStartTime,
  initialStopTime,
  projectFiles,
  activeFileName,
  onUpdateProjectFile,
  scadOverrideCode,
}: UseAnsatzEngineProps) {
  const toast = useToast();
  const { preferences: modelingPrefs } = useModelingPreferences();
  const prefStopTime = modelingPrefs.defaultStopTime ?? 10;
  const prefIntervals = modelingPrefs.defaultNumberOfIntervals ?? 500;
  const prefTolerance = modelingPrefs.solverTolerance ?? modelingPrefs.defaultRelativeTolerance ?? 1e-4;
  const prefSolver = modelingPrefs.defaultSolver ?? "cvode";
  const prefFlattenerBackend = modelingPrefs.flattenerBackend ?? "hybrid";
  const prefDiagramAutoLayout = modelingPrefs.diagramAutoLayout ?? true;
  const prefExperimentalFeatures = modelingPrefs.enableExperimentalFeatures ?? false;

  // ── Live Editor Value Tracking ──
  const [editorValue, setEditorValue] = useState<string>(content);
  const [amplSolveResult, setAmplSolveResult] = useState<AmplSolveResultData | null>(null);
  useEffect(() => {
    setAmplSolveResult(null);
  }, [dialect, documentUri]);
  useEffect(() => {
    setEditorValue(content || editor?.getValue() || "");
  }, [content, editor, contextVersion]);

  useEffect(() => {
    if (!editor) return;
    setEditorValue(editor.getValue());
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposable = editor.onDidChangeModelContent(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        setEditorValue(editor.getValue());
      }, 250);
    });
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      disposable.dispose();
    };
  }, [editor]);

  const buildExperimentMeta = useCallback(
    (rawExp?: Record<string, unknown> | null): ExperimentMetaState => {
      const parsedFromSource = extractExperimentFromCode(editorValue);
      const startTime = Number(
        rawExp?.startTime ??
          rawExp?.StartTime ??
          (rawExp ? undefined : initialStartTime) ??
          parsedFromSource?.startTime ??
          0,
      );
      const stopTime = Number(
        rawExp?.stopTime ??
          rawExp?.StopTime ??
          (rawExp ? undefined : initialStopTime) ??
          parsedFromSource?.stopTime ??
          prefStopTime,
      );
      const numberOfIntervals = Number(
        rawExp?.numberOfIntervals ?? rawExp?.NumberOfIntervals ?? parsedFromSource?.numberOfIntervals ?? prefIntervals,
      );
      const interval = Number(
        rawExp?.interval ??
          rawExp?.Interval ??
          parsedFromSource?.interval ??
          (stopTime - startTime) / Math.max(1, numberOfIntervals),
      );
      const tolerance = Number(rawExp?.tolerance ?? rawExp?.Tolerance ?? parsedFromSource?.tolerance ?? prefTolerance);
      const solver = String(rawExp?.solver ?? rawExp?.Solver ?? parsedFromSource?.solver ?? prefSolver);
      return {
        StartTime: startTime,
        StopTime: stopTime,
        Tolerance: tolerance,
        Interval: interval,
        startTime,
        stopTime,
        tolerance,
        interval,
        numberOfIntervals,
        solver,
        flattenerBackend: prefFlattenerBackend,
        diagramAutoLayout: prefDiagramAutoLayout,
        enableExperimentalFeatures: prefExperimentalFeatures,
      };
    },
    [
      editorValue,
      initialStartTime,
      initialStopTime,
      prefStopTime,
      prefIntervals,
      prefTolerance,
      prefSolver,
      prefFlattenerBackend,
      prefDiagramAutoLayout,
      prefExperimentalFeatures,
    ],
  );

  // ── Simulation State ──
  const userSelectionMadeRef = useRef<boolean>(false);
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>(
    () => initialSimulationVariables ?? [],
  );

  useEffect(() => {
    if (!userSelectionMadeRef.current && initialSimulationVariables && initialSimulationVariables.length > 0) {
      setSelectedSimulationVariables(initialSimulationVariables);
    }
  }, [initialSimulationVariables]);

  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const [sweepState, setSweepState] = useState<SweepState | null>(null);
  const [sweepResults, setSweepResults] = useState<{ value: number; y: number[][] }[] | null>(null);
  const [simExperiment, setSimExperiment] = useState(() => buildExperimentMeta(null));
  const [experimentOverrides, setExperimentOverrides] = useState<ExperimentOverrides>(() => ({
    equidistant: true,
    ...(initialStartTime !== undefined ? { startTime: initialStartTime } : {}),
    ...(initialStopTime !== undefined ? { stopTime: initialStopTime } : {}),
  }));

  useEffect(() => {
    if (initialStartTime !== undefined || initialStopTime !== undefined) {
      setExperimentOverrides((prev) => ({
        ...prev,
        ...(initialStartTime !== undefined ? { startTime: initialStartTime } : {}),
        ...(initialStopTime !== undefined ? { stopTime: initialStopTime } : {}),
      }));
    }
  }, [initialStartTime, initialStopTime]);

  const [cachedSimulator, setCachedSimulator] = useState<CachedSimulatorState>(() => {
    const initialExp = buildExperimentMeta(null);
    return { experiment: initialExp, dae: { experiment: initialExp } };
  });
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatusState | null>(null);
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);
  const [pscadComplianceReport, setPscadComplianceReport] = useState<unknown>(null);
  const [pscadExports, setPscadExports] = useState<Awaited<ReturnType<typeof simulate>>["pscadExports"] | null>(null);

  // Keep simExperiment & cachedSimulator synced with source @experiment(...) annotations and user preferences
  useEffect(() => {
    const nextExp = buildExperimentMeta(null);
    const sameExperiment = (a: typeof nextExp | null | undefined, b: typeof nextExp) =>
      Boolean(a) &&
      a?.startTime === b.startTime &&
      a?.stopTime === b.stopTime &&
      a?.numberOfIntervals === b.numberOfIntervals &&
      a?.interval === b.interval &&
      a?.tolerance === b.tolerance &&
      a?.solver === b.solver;
    setSimExperiment((prev) => (sameExperiment(prev, nextExp) ? prev : nextExp));
    setCachedSimulator((prev) => {
      if (sameExperiment(prev?.experiment, nextExp)) {
        return prev;
      }
      return {
        ...(prev ?? {}),
        experiment: nextExp,
        dae: {
          ...(prev?.dae ?? {}),
          experiment: nextExp,
        },
      };
    });
  }, [buildExperimentMeta]);

  // ── CAD & 3D Animation State ──
  const [cadComponents, setCadComponents] = useState<CadComponent[]>(() => {
    if (!content) return [];
    if (dialect === "usd") return extractUsdCadComponents(content) as CadComponent[];
    if (dialect === "three-mf") return extractThreeMfCadComponents(content) as CadComponent[];
    return extractCadComponents(parseSourceCadVariables(content));
  });
  const [gdtOverlay, setGdtOverlay] = useState<GdtOverlayPayload | null>(null);
  const lastCompiledStepRef = useRef<CachedAnsatzStepCompilation | null>(null);
  const lastScadCadSigRef = useRef<string | null>(null);
  const lastNonScadCadSigRef = useRef<string | null>(null);
  const [vtkBuffer, setVtkBuffer] = useState<Uint8Array | null>(null);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const lastSimTrajectoryRef = useRef<{ t: number[]; y: number[][]; states: string[] } | null>(null);
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

  const handleExperimentOverrideChange = <K extends keyof ExperimentOverrides>(
    name: K,
    value: ExperimentOverrides[K],
  ) => {
    setExperimentOverrides((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleExperimentOverrideReset = (name: keyof ExperimentOverrides) => {
    setExperimentOverrides((prev) => {
      const { [name]: _omitted, ...rest } = prev;
      return rest;
    });
  };

  const setUserSelectedSimulationVariables = useCallback((action: React.SetStateAction<string[]>) => {
    userSelectionMadeRef.current = true;
    setSelectedSimulationVariables(action);
  }, []);

  const handleToggleSimulationVariable = useCallback((variable: string) => {
    userSelectionMadeRef.current = true;
    setSelectedSimulationVariables((prev) =>
      prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
    );
  }, []);

  const handleVariablesLoaded = useCallback((variables: string[]) => {
    setSimulationVariables((prev) =>
      prev.length === variables.length && prev.every((v, i) => v === variables[i]) ? prev : variables,
    );
    setSelectedSimulationVariables((prev) => {
      if (prev.length > 0 || userSelectionMadeRef.current || variables.length === 0) return prev;
      return variables.slice(0, 3);
    });
  }, []);

  // Listen for variable selection events from CosimPanel in AnsatzVisualizerPane
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onCosimVariableToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ participantId?: string; variable?: string }>).detail;
      const variable = detail?.variable;
      if (!variable) return;
      userSelectionMadeRef.current = true;
      setSimulationVariables((prev) => (prev.includes(variable) ? prev : [...prev, variable]));
      setSelectedSimulationVariables((prev) =>
        prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
      );
      setShowResultsView(true);
    };
    window.addEventListener("ansatz:toggle-simulation-variable", onCosimVariableToggle);
    return () => window.removeEventListener("ansatz:toggle-simulation-variable", onCosimVariableToggle);
  }, [setShowResultsView]);

  // ── Live MQTT sync ──
  useEffect(() => {
    if (cosimDataSource !== "mqtt-live") return;
    const client = getAnsatzMqttClient();
    const ctrl = animationControllerRef.current;
    if (ctrl) {
      ctrl.goLive();
    }
    const unsub = client.onVariableUpdate((participantId, variable, value) => {
      const now = Date.now() / 1000;
      const controller = animationControllerRef.current;
      if (controller) {
        if (controller.mode !== "live") controller.goLive();
        controller.pushLiveValue(variable, value, now);
        controller.pushLiveValue(`${participantId}.${variable}`, value, now);
      }
      setLocalSimulationData((prev) => {
        const last = prev && prev.length > 0 ? prev[prev.length - 1] : {};
        const row: Record<string, number | string> = {
          ...last,
          time: now,
          [variable]: value,
          [`${participantId}.${variable}`]: value,
        };
        const next = prev ? [...prev, row] : [row];
        return next.length > 1500 ? next.slice(next.length - 1500) : next;
      });
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

      const sessionExt = session as HistorianSession & {
        chartData?: Record<string, number>[];
        rows?: Record<string, number>[];
      };
      const rawRows: Record<string, number>[] =
        sessionExt.chartData ?? sessionExt.rows ?? (localSimulationData as Record<string, number>[] | null) ?? [];

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

  // ── 3D Direct-Manipulation CAD Edit Writeback (Gizmo / Dimension / Face Tag / Assembly Joint) ──
  const commitCadEdit = useCallback(
    async (kind: "gizmo" | "dimension" | "face_tag" | "assembly_joint", payload: Record<string, unknown>) => {
      const liveSource = editor?.getValue() ?? editorValue;
      try {
        const res = await applyCadEditInAnsatz({
          uri: documentUri,
          documentText: liveSource,
          languageId: dialect,
          kind,
          payload,
        });
        if (res.locked) {
          const msg = res.lockReason || "This CAD parameter is locked and cannot be edited directly.";
          console.warn("[CAD Direct Edit]", msg);
          toast.warning(msg);
          return;
        }
        if (!res.applied) {
          if (res.error) {
            console.warn("[CAD Direct Edit]", res.error);
            toast.warning(res.error);
          }
          return;
        }
        if (!editor) return;
        const model = editor.getModel();
        if (model && res.replacedRange && typeof res.newText === "string") {
          const startPos = model.getPositionAt(res.replacedRange.startOffset);
          const endPos = model.getPositionAt(res.replacedRange.endOffset);
          editor.pushUndoStop();
          editor.executeEdits("cad-direct-edit", [
            {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: res.newText,
              forceMoveMarkers: true,
            },
          ]);
          editor.pushUndoStop();
        } else if (typeof res.updatedSource === "string" && res.updatedSource !== liveSource) {
          if (model) {
            editor.pushUndoStop();
            editor.executeEdits("cad-direct-edit", [
              {
                range: model.getFullModelRange(),
                text: res.updatedSource,
                forceMoveMarkers: true,
              },
            ]);
            editor.pushUndoStop();
          } else {
            editor.setValue(res.updatedSource);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[CAD Direct Edit] Failed to apply edit:", msg);
        toast.error(`CAD edit failed: ${msg}`);
      }
    },
    [editor, editorValue, documentUri, dialect, toast],
  );

  const handleCommitCadGizmoDelta = useCallback(
    (payload: GizmoCommitPayload) => {
      void commitCadEdit("gizmo", payload as unknown as Record<string, unknown>);
    },
    [commitCadEdit],
  );

  const handleCommitCadDimensionDelta = useCallback(
    (payload: CommitDimensionPayload) => {
      void commitCadEdit("dimension", payload as unknown as Record<string, unknown>);
    },
    [commitCadEdit],
  );

  const handleCommitCadFaceTag = useCallback(
    (payload: CommitFaceTagPayload) => {
      void commitCadEdit("face_tag", payload as unknown as Record<string, unknown>);
    },
    [commitCadEdit],
  );

  const handleCommitCadAssemblyJoint = useCallback(
    (payload: CommitAssemblyJointPayload) => {
      void commitCadEdit("assembly_joint", payload as unknown as Record<string, unknown>);
    },
    [commitCadEdit],
  );

  // ── Fetch CAD annotations or tessellate direct STEP / OpenSCAD 3D geometry ──
  useEffect(() => {
    if (!showCadView && dialect !== "step" && dialect !== "scad" && dialect !== "qif" && dialect !== "three-mf") return;
    let cancelled = false;

    const runClassicCad = () => {
      const stepFileDirective = extractStepFilename(editorValue);
      if (stepFileDirective && !selectedTreeClassName) {
        const { components: stepComps } = tessellateStepSource(editorValue);
        setVtkBuffer(null);
        setCadComponents(stepComps);
        return;
      }

      setVtkBuffer(null);

      if (!selectedTreeClassName) {
        const fallback = extractCadComponents(parseSourceCadVariables(editorValue));
        setCadComponents(fallback);
        return;
      }

      getCadComponents(documentUri, selectedTreeClassName)
        .then((components) => {
          if (cancelled) return;
          let parsed: CadComponent[] =
            Array.isArray(components) && components.length > 0 ? extractCadComponents(components) : [];
          if (!parsed || parsed.length === 0) {
            const sourceVars = parseSourceCadVariables(editorValue);
            parsed = extractCadComponents(sourceVars);
          }
          if ((!parsed || parsed.length === 0) && stepFileDirective) {
            const { components: stepComps } = tessellateStepSource(editorValue);
            setVtkBuffer(null);
            parsed = stepComps;
          }
          setCadComponents(parsed);

          let ctrl = animationControllerRef.current;
          if (!ctrl && parsed.length > 0) {
            ctrl = new AnimationController();
            ctrl.onStateChange((s) => setAnimationMode(s.mode));
            animationControllerRef.current = ctrl;
          }

          if (ctrl && parsed.length > 0) {
            ctrl.setBindings(
              parsed
                .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
                .map((c) => ({
                  componentName: c.name,
                  bindings: c.dynamicBindings!.map((b) => {
                    const ext = b as {
                      property: string;
                      index?: number;
                      variable: string;
                      unit?: string;
                      scaleFactor?: number;
                      scale?: number;
                    };
                    return {
                      property: ext.property,
                      index: ext.index,
                      variable: ext.variable,
                      unit: ext.unit,
                      scaleFactor: ext.scaleFactor ?? ext.scale,
                    };
                  }),
                })),
            );
            for (const comp of parsed) {
              const cadObj: {
                position?: [number, number, number];
                rotation?: [number, number, number];
                scale?: [number, number, number];
              } = typeof comp.cad === "object" && comp.cad ? comp.cad : {};
              ctrl.setDefault(comp.name, {
                position: cadObj.position ?? [0, 0, 0],
                rotation: cadObj.rotation ?? [0, 0, 0],
                scale: cadObj.scale ?? [1, 1, 1],
                ...(comp.defaults ?? {}),
              });
            }
            if (lastSimTrajectoryRef.current && !ctrl.hasData) {
              ctrl.loadTimeseries(
                lastSimTrajectoryRef.current.t,
                lastSimTrajectoryRef.current.y,
                lastSimTrajectoryRef.current.states,
              );
              if (parsed.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0)) {
                ctrl.play();
              }
            }
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) console.error("Failed to fetch CAD components:", e);
        });
    };

    const isStepText = isStepSource(editorValue, dialect);
    const { files: effectiveFiles, activePath } = buildAnsatzEffectiveFileMap(
      projectFiles,
      activeFileName,
      documentUri,
      dialect,
      editorValue,
    );

    const runScadLspFallback = (clearOnEmpty = false, onSettled?: () => void, sourceOverride?: string) => {
      const targetSource = sourceOverride ?? editorValue;
      getCadComponents(documentUri, undefined, targetSource)
        .then((components) => {
          if (cancelled) return;
          if (!Array.isArray(components) || components.length === 0) {
            if (clearOnEmpty) {
              setVtkBuffer(null);
              setCadComponents([]);
            }
            onSettled?.();
            return;
          }
          const mapped: CadComponent[] = components.map((c, idx: number) => {
            const cadObj =
              typeof c.cad === "object" && c.cad
                ? c.cad
                : { uri: typeof c.cad === "string" ? c.cad : `scad://part_${idx}` };
            return {
              name: c.name || `part_${idx + 1}`,
              cad: cadObj,
              proceduralMesh: c.proceduralMesh,
              ports: Array.isArray(c.ports) ? (c.ports as CadComponent["ports"]) : [],
              dynamicBindings: Array.isArray(c.dynamicBindings) ? c.dynamicBindings : [],
              defaults: c.defaults,
              shapeType: c.shapeType,
              sourceMetadata: c.sourceMetadata as CadComponent["sourceMetadata"],
            };
          });
          setVtkBuffer(null);
          setCadComponents(
            attachScadKinematicController(targetSource, mapped, animationControllerRef, setAnimationMode),
          );
          onSettled?.();
        })
        .catch(() => {
          if (cancelled) return;
          onSettled?.();
        });
    };

    if (dialect === "scad") {
      lastNonScadCadSigRef.current = null;
      if (!editorValue.trim()) {
        lastScadCadSigRef.current = null;
        return;
      }
      const pairedNonScadPaths = Object.keys(effectiveFiles)
        .filter((p) => p !== activePath && /\.(qif|step|stp|p21|mo)$/i.test(p))
        .sort();
      const hasPairedNonScadArtifacts = pairedNonScadPaths.length > 0;
      const pairedSig = pairedNonScadPaths
        .map((p) => {
          const val = effectiveFiles[p] ?? "";
          // Ignore writebacks of our own compiled STEP artifact to avoid re-triggering compilation
          if (/\.(step|stp|p21)$/i.test(p) && lastCompiledStepRef.current?.result.stepText === val) {
            return `${p}:<compiled>`;
          }
          return `${p}:${val.length}:${val.slice(0, 64)}`;
        })
        .join("\0");
      const effectiveScadCode = scadOverrideCode ?? editorValue;
      const hasFeatureOverride = Boolean(scadOverrideCode && scadOverrideCode !== editorValue);
      const scadSig = `${documentUri}\0${effectiveScadCode}\0${pairedSig}\0${hasFeatureOverride ? "ov" : "base"}`;
      if (lastScadCadSigRef.current === scadSig) {
        return;
      }
      const wasFeatureOverride = Boolean(lastScadCadSigRef.current?.endsWith("\0ov"));
      const markScadSettled = () => {
        if (!cancelled) {
          lastScadCadSigRef.current = scadSig;
        }
      };

      if (hasFeatureOverride) {
        setGdtOverlay(null);
        runScadLspFallback(true, markScadSettled, effectiveScadCode);
        return;
      }

      const isInitialScadRender = lastScadCadSigRef.current === null || wasFeatureOverride;
      const debounceMs = isInitialScadRender ? 0 : 450;

      const timerId = setTimeout(() => {
        if (cancelled) return;

        if (!hasPairedNonScadArtifacts) {
          setGdtOverlay(null);
          runScadLspFallback(false, markScadSettled, editorValue);
          return;
        }

        void compileAnsatzOptionAAssembly({
          files: effectiveFiles,
          activePath,
          dialect,
          documentUri,
          isStepText: false,
          cachedCompilation: lastCompiledStepRef.current,
          compileStepFromSources: compileStepFromSourcesInAnsatz,
          getStepMeshes: getStepMeshesInAnsatz,
        })
          .then((outcome) => {
            if (cancelled) return;
            if (outcome) {
              if (outcome.cachedCompilation) {
                lastCompiledStepRef.current = outcome.cachedCompilation;
              }
              setGdtOverlay(outcome.gdtOverlay);
              if (outcome.updatedStepArtifact) {
                onUpdateProjectFile?.(outcome.stepPath, outcome.stepText);
              }
              if (outcome.components.length > 0) {
                const scadCode =
                  (outcome.pairing?.scadPath ? effectiveFiles[outcome.pairing.scadPath] : undefined) ?? editorValue;
                setVtkBuffer(null);
                setCadComponents(
                  attachScadKinematicController(
                    scadCode,
                    outcome.components,
                    animationControllerRef,
                    setAnimationMode,
                    outcome.spools,
                    outcome.telemetry,
                  ),
                );
                markScadSettled();
                return;
              }
            } else {
              setGdtOverlay(null);
            }
            runScadLspFallback(true, markScadSettled);
          })
          .catch(() => {
            if (cancelled) return;
            setGdtOverlay(null);
            runScadLspFallback(true, markScadSettled);
          });
      }, debounceMs);

      return () => {
        cancelled = true;
        clearTimeout(timerId);
      };
    }

    lastScadCadSigRef.current = null;

    const pairedCadPaths = Object.keys(effectiveFiles)
      .filter((p) => p !== activePath && /\.(scad|qif|step|stp|p21|mo)$/i.test(p))
      .sort();
    const pairedNonScadSig = pairedCadPaths
      .map((p) => {
        const val = effectiveFiles[p] ?? "";
        if (/\.(step|stp|p21)$/i.test(p) && lastCompiledStepRef.current?.result.stepText === val) {
          return `${p}:<compiled>`;
        }
        return `${p}:${val.length}:${val.slice(0, 64)}`;
      })
      .join("\0");
    const nonScadSig = `${documentUri}\0${dialect}\0${selectedTreeClassName ?? ""}\0${activePath}\0${editorValue}\0${pairedNonScadSig}`;
    if (lastNonScadCadSigRef.current === nonScadSig) {
      return;
    }
    lastNonScadCadSigRef.current = nonScadSig;

    if (isStepText) {
      const { components: stepComps } = tessellateStepSource(editorValue);
      setVtkBuffer(null);
      setCadComponents(stepComps);
    } else if (dialect === "usd") {
      const usdComps = extractUsdCadComponents(editorValue) as CadComponent[];
      setGdtOverlay(null);
      setVtkBuffer(null);
      setCadComponents(usdComps);
      return;
    } else if (dialect === "three-mf") {
      const threeMfComps = extractThreeMfCadComponents(editorValue) as CadComponent[];
      setGdtOverlay(null);
      setVtkBuffer(null);
      setCadComponents(threeMfComps);
      return;
    }

    const hasPairedCadArtifacts = Object.keys(effectiveFiles).some((p) => /\.(scad|qif|step|stp|p21)$/i.test(p));
    const shouldTryOptionA = dialect === "qif" || isStepText || hasPairedCadArtifacts;

    if (!shouldTryOptionA) {
      setGdtOverlay(null);
      runClassicCad();
    } else {
      void compileAnsatzOptionAAssembly({
        files: effectiveFiles,
        activePath,
        dialect,
        documentUri,
        isStepText,
        cachedCompilation: lastCompiledStepRef.current,
        compileStepFromSources: compileStepFromSourcesInAnsatz,
        getStepMeshes: getStepMeshesInAnsatz,
      })
        .then((outcome) => {
          if (cancelled) return;
          if (outcome) {
            if (outcome.cachedCompilation) {
              lastCompiledStepRef.current = outcome.cachedCompilation;
            }
            setGdtOverlay(outcome.gdtOverlay);
            if (outcome.updatedStepArtifact) {
              onUpdateProjectFile?.(outcome.stepPath, outcome.stepText);
            }
            if (outcome.components.length > 0) {
              const scadCode = (outcome.pairing?.scadPath ? effectiveFiles[outcome.pairing.scadPath] : undefined) ?? "";
              setVtkBuffer(null);
              setCadComponents(
                attachScadKinematicController(
                  scadCode,
                  outcome.components,
                  animationControllerRef,
                  setAnimationMode,
                  outcome.spools,
                  outcome.telemetry,
                ),
              );
              return;
            }
            if (isStepText || dialect === "qif") {
              return;
            }
          } else {
            setGdtOverlay(null);
          }

          if (!isStepText && dialect !== "qif") {
            runClassicCad();
          }
        })
        .catch(() => {
          if (cancelled) return;
          setGdtOverlay(null);
          if (!isStepText && dialect !== "qif") {
            runClassicCad();
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    selectedTreeClassName,
    contextVersion,
    editorValue,
    dialect,
    documentUri,
    projectFiles,
    activeFileName,
    onUpdateProjectFile,
    showCadView,
    scadOverrideCode,
  ]);

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
    const targetClass = selectedTreeClassName || extractPrimaryModelicaClassName(editorValue || content) || undefined;
    if ((!showResultsView && !showCadView) || parameterOverrides.size === 0 || !targetClass) return;

    const timer = setTimeout(async () => {
      try {
        const overrideObj = Object.fromEntries(parameterOverrides);
        const loadedSnap = (window as unknown as { __ansatzInitialSnapshot?: string | Record<string, unknown> })
          .__ansatzInitialSnapshot;
        const result = await simulate(documentUri, {
          className: targetClass,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime ?? simExperiment.startTime,
          stopTime: experimentOverrides.stopTime ?? simExperiment.stopTime,
          interval: experimentOverrides.interval ?? simExperiment.interval,
          solver: experimentOverrides.solver ?? simExperiment.solver ?? prefSolver,
          numberOfIntervals: experimentOverrides.numberOfIntervals ?? simExperiment.numberOfIntervals ?? prefIntervals,
          rtol: experimentOverrides.tolerance ?? simExperiment.tolerance ?? prefTolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
          flattenerBackend: prefFlattenerBackend,
          ...(loadedSnap ? { initialSnapshot: loadedSnap } : {}),
        });

        if (!result) return;
        if (result.error) throw new Error(result.error);

        if (result.experiment) {
          const updatedExp = buildExperimentMeta(result.experiment as Record<string, unknown>);
          setSimExperiment(updatedExp);
          setCachedSimulator((prev) => ({
            ...(prev ?? {}),
            experiment: updatedExp,
            dae: {
              ...(prev?.dae ?? {}),
              experiment: updatedExp,
            },
          }));
        }

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
              states.forEach((state: string, vIndex: number) => {
                rowObj[state] = result.sweepResults![0]?.y[i]?.[vIndex] ?? 0;
              });
              return rowObj;
            }),
          );
          lastSimTrajectoryRef.current = {
            t: result.t,
            y: result.sweepResults[0]?.y ?? result.y ?? [],
            states,
          };
          if (animationControllerRef.current && cadComponents.length > 0) {
            animationControllerRef.current.loadTimeseries(
              result.t,
              result.sweepResults[0]?.y ?? result.y ?? [],
              states,
            );
          }
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
          lastSimTrajectoryRef.current = { t: result.t, y: result.y, states };
          if (animationControllerRef.current && cadComponents.length > 0) {
            animationControllerRef.current.loadTimeseries(result.t, result.y, states);
          }
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
  }, [
    parameterOverrides,
    sweepState,
    showResultsView,
    showCadView,
    cadComponents.length,
    experimentOverrides,
    simExperiment,
    prefSolver,
    prefIntervals,
    prefTolerance,
    prefFlattenerBackend,
    buildExperimentMeta,
    selectedTreeClassName,
    documentUri,
    editorValue,
    content,
  ]);

  // ── Full Simulation Execution ──
  const handleSimulateImpl = async () => {
    setSimulationStatus({ status: "pending", error: null });
    setLocalSimulationData(null);
    setSimulationVariables([]);
    setSelectedSimulationVariables([]);
    setPscadComplianceReport(null);
    setPscadExports(null);

    try {
      if (dialect === "ampl") {
        const liveText = editor?.getValue() ?? editorValue ?? content;
        const effectiveFiles: Record<string, string> = {
          ...(projectFiles ?? {}),
          ...(activeFileName ? { [activeFileName]: liveText } : {}),
        };
        const companionDatText = Object.entries(effectiveFiles)
          .filter(([name]) => name.toLowerCase().endsWith(".dat"))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, txt]) => txt.trim())
          .filter(Boolean)
          .join("\n\n");
        const solveRes = await executeLspAction<AmplSolveResultData & { error?: string }>(
          "ampl_solve",
          "ampl",
          documentUri,
          {
            documentText: liveText,
            ...(companionDatText ? { dataText: companionDatText } : {}),
            ...(Object.keys(effectiveFiles).length > 0
              ? { projectFiles: effectiveFiles, virtualFiles: effectiveFiles }
              : {}),
            options: {
              solver: experimentOverrides.solver ?? "auto",
              tolerance: experimentOverrides.tolerance,
              maxIterations: experimentOverrides.maxIterations,
              presolve: experimentOverrides.presolve,
            },
          },
        );
        if (!solveRes) {
          throw new Error("AMPL solver returned no result.");
        }
        if (solveRes.error) {
          throw new Error(String(solveRes.error));
        }
        setAmplSolveResult(solveRes);
        setSimulationStatus({ status: "completed" });
        if (!showCadView) {
          setShowResultsView(true);
          if (isNarrow) {
            setMobileTab("results");
            setTreeVisible(false);
            setView(viewDiagramEnum);
          }
        }
        return;
      }

      const overrideObj = Object.fromEntries(parameterOverrides);
      const liveCode = editor?.getValue() ?? editorValue ?? content;
      const extractedPrimary = extractPrimaryModelicaClassName(liveCode);
      const hasSelectedInCode =
        selectedTreeClassName &&
        (selectedTreeClassName.includes(".") || hasModelicaClassDeclaration(liveCode, selectedTreeClassName));
      const targetClass = (hasSelectedInCode ? selectedTreeClassName : extractedPrimary) || undefined;

      let progressSub: { dispose: () => void } | null = null;
      if (dialect === "pscad") {
        progressSub = await onSimulationProgress((frame) => {
          if (frame.uri !== documentUri) return;
          setLocalSimulationData((prev) => {
            const row: Record<string, number | string> = { time: frame.timeSec, ...frame.voltages };
            const next = prev ? [...prev, row] : [row];
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
          if (!showCadView) setShowResultsView(true);
        });
      }

      const loadedSnap = (window as unknown as { __ansatzInitialSnapshot?: string | Record<string, unknown> })
        .__ansatzInitialSnapshot;
      let result: Awaited<ReturnType<typeof simulate>>;
      try {
        result = await simulate(documentUri, {
          className: targetClass,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime ?? simExperiment.startTime,
          stopTime: experimentOverrides.stopTime ?? simExperiment.stopTime,
          interval: experimentOverrides.interval ?? simExperiment.interval,
          solver: experimentOverrides.solver ?? simExperiment.solver ?? prefSolver,
          numberOfIntervals: experimentOverrides.numberOfIntervals ?? simExperiment.numberOfIntervals ?? prefIntervals,
          rtol: experimentOverrides.tolerance ?? simExperiment.tolerance ?? prefTolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
          flattenerBackend: prefFlattenerBackend,
          ...(loadedSnap ? { initialSnapshot: loadedSnap } : {}),
        } as Parameters<typeof simulate>[1]);
      } finally {
        progressSub?.dispose();
      }

      if (!result) {
        throw new Error("Simulation returned no result (handler not available for this language).");
      }
      if (result.error) {
        throw new Error(result.error);
      }

      if (result.experiment) {
        const updatedExp = buildExperimentMeta(result.experiment as Record<string, unknown>);
        setSimExperiment(updatedExp);
        setCachedSimulator((prev) => ({
          ...(prev ?? {}),
          experiment: updatedExp,
          dae: {
            ...(prev?.dae ?? {}),
            experiment: updatedExp,
          },
        }));
      }

      setSimulationParameters((result.parameters as ParameterInfo[] | undefined) ?? []);

      const states = result.states ?? [];
      setSimulationVariables(states);
      setSelectedSimulationVariables((prev) => {
        // 1. If user already has active selections that exist in the newly simulated states, preserve them!
        if (prev.length > 0) {
          const matchedPrev = prev.filter((v) => states.includes(v));
          if (matchedPrev.length > 0) return matchedPrev;
        }
        // 2. If user explicitly cleared selection, preserve empty selection
        if (userSelectionMadeRef.current && prev.length === 0) {
          return prev;
        }
        // 3. Prioritize GraphFrame curves if declared in the PSCAD schematic
        const frameCurves = (result.pscadExports?.graphFrames ?? [])
          .flatMap((gf) => gf.curves)
          .filter((v, idx, arr) => states.includes(v) && arr.indexOf(v) === idx);
        if (!userSelectionMadeRef.current && frameCurves.length > 0) {
          return frameCurves;
        }
        // 4. Fall back to initialSimulationVariables if valid and user hasn't made a custom selection
        if (!userSelectionMadeRef.current && initialSimulationVariables && initialSimulationVariables.length > 0) {
          const matchedInitial = initialSimulationVariables.filter((v) => states.includes(v));
          if (matchedInitial.length > 0) return matchedInitial;
        }
        // 5. Default: first 3 non-derivative states
        const candidates = states.filter((v) => !v.startsWith("der(") && v !== "time");
        return candidates.length > 0 ? candidates.slice(0, 3) : states.slice(0, 3);
      });

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
            states.forEach((state: string, vIndex: number) => {
              rowObj[state] = result.sweepResults![0]?.y[i]?.[vIndex] ?? 0;
            });
            return rowObj;
          }),
        );
        lastSimTrajectoryRef.current = {
          t: result.t,
          y: result.sweepResults[0]?.y ?? result.y ?? [],
          states,
        };
        if (animationControllerRef.current && cadComponents.length > 0) {
          animationControllerRef.current.loadTimeseries(result.t, result.sweepResults[0]?.y ?? result.y ?? [], states);
        }
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
        lastSimTrajectoryRef.current = { t: result.t, y: result.y, states };
      }
      setPscadComplianceReport(result.complianceReport ?? null);
      setPscadExports(result.pscadExports ?? null);
      setSimulationStatus({ status: "completed" });
      if (!showCadView) {
        setShowResultsView(true);
        if (isNarrow) {
          setMobileTab("results");
          setTreeVisible(false);
          setView(viewDiagramEnum);
        }
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
              bindings: c.dynamicBindings!.map((b) => {
                const ext = b as {
                  property: string;
                  index?: number;
                  variable: string;
                  unit?: string;
                  scaleFactor?: number;
                  scale?: number;
                  offset?: number;
                  format?: string;
                };
                return {
                  property: ext.property,
                  index: ext.index,
                  variable: ext.variable,
                  unit: ext.unit,
                  scaleFactor: ext.scaleFactor ?? ext.scale,
                  offset: ext.offset,
                  format: ext.format,
                };
              }),
            })),
        );
        for (const comp of cadComponents) {
          controller.setDefault(comp.name, {
            position: comp.cad.position ?? [0, 0, 0],
            rotation: comp.cad.rotation ?? [0, 0, 0],
            scale: comp.cad.scale ?? [1, 1, 1],
            ...(comp.defaults ?? {}),
          });
        }
        controller.loadTimeseries(result.t, result.y, result.states);
        const hasDynamic = cadComponents.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
        if (hasDynamic) {
          controller.play();
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "Simulation aborted") {
        return;
      }
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      if (!showCadView) {
        setShowResultsView(true);
        if (isNarrow) {
          setMobileTab("results");
          setTreeVisible(false);
          setView(viewDiagramEnum);
        }
      }
    }
  };

  const handleSimulateImplRef = useRef(handleSimulateImpl);
  handleSimulateImplRef.current = handleSimulateImpl;
  const handleSimulate = useCallback(() => handleSimulateImplRef.current(), []);

  return {
    simulationVariables,
    setSimulationVariables,
    selectedSimulationVariables,
    setSelectedSimulationVariables: setUserSelectedSimulationVariables,
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
    simExperiment,
    setSimExperiment,
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
    pscadComplianceReport,
    pscadExports,
    cadComponents,
    setCadComponents,
    gdtOverlay,
    setGdtOverlay,
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
    handleCommitCadGizmoDelta,
    handleCommitCadDimensionDelta,
    handleCommitCadFaceTag,
    handleCommitCadAssemblyJoint,
    handleSimulate,
    amplSolveResult,
  };
}
