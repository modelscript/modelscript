// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shared types and pure geometry/CAE helper functions for CadViewer.
 */

import type { BoundaryActionPayload, BoundaryConditionKind } from "./BoundaryPicker";
import type { CaeCfdStudyOptions, CaeFeaStudyOptions } from "./cae-local-runner";
import type { CaePhysicsConfig } from "./CaePhysicsInspector";
import type { CfdRefinementBox } from "./CfdDomainGizmo";
import type { DigitalThreadHyperedge } from "./DigitalThreadCaePanel";
import type { ProbeData } from "./ProbeTooltip";
import type { VtkProbePoint } from "./VtkRenderer";

// ── Types ────────────────────────────────────────────────────────────────────

export type GizmoMode = "select" | "translate" | "rotate" | "scale" | "tag_face" | "mate";

export interface CommitAssemblyJointPayload {
  jointName: string;
  jointType: "Revolute" | "Prismatic" | "Cylindrical" | "Spherical" | "Fixed";
  partA: string;
  partB: string;
  axis?: [number, number, number] | undefined;
}

export interface CadSourceMetadata {
  uri?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  primitiveStartOffset?: number | undefined;
  primitiveEndOffset?: number | undefined;
  parameterName?: string | undefined;
  transformMethod?: string | undefined;
  argIndex?: number | undefined;
  translateRange?: { startOffset: number; endOffset: number } | undefined;
  rotateRange?: { startOffset: number; endOffset: number } | undefined;
  scaleRange?: { startOffset: number; endOffset: number } | undefined;
  dimensions?: [number, number, number] | undefined;
  dimensionParams?: [string | undefined, string | undefined, string | undefined] | undefined;
  position?: [number, number, number] | undefined;
  translation?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
  primitiveType?: string | undefined;
  color?: [number, number, number, number] | undefined;
}

export interface GizmoCommitPayload {
  componentName: string;
  mode?: GizmoMode | undefined;
  delta: [number, number, number];
  newPosition: [number, number, number];
  newRotation?: [number, number, number] | undefined;
  newScale?: [number, number, number] | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CommitDimensionPayload {
  componentName: string;
  dimensionIndex: number;
  newValue: number;
  primitiveType?: string | undefined;
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface CommitFaceTagPayload {
  componentName: string;
  portName: string;
  portType: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface FaceTagHit {
  componentName: string;
  normal?: [number, number, number] | undefined;
  worldPos: [number, number, number];
  sourceMetadata?: CadSourceMetadata | undefined;
}

export interface FaceTagDraft {
  hit: FaceTagHit;
  portName: string;
  portType: string;
}

export interface MateDraft {
  partA: string;
  partB: string;
  jointName: string;
  jointType: CommitAssemblyJointPayload["jointType"];
  axisKey: "z" | "y" | "x";
}

export interface CadAnnotation {
  uri: string;
  position?: [number, number, number] | undefined;
  rotation?: [number, number, number] | undefined;
  scale?: [number, number, number] | undefined;
}

export interface CadPortAnnotation {
  feature: string;
  offsetPosition?: [number, number, number] | undefined;
  offsetRotation?: [number, number, number] | undefined;
  offsetScale?: [number, number, number] | undefined;
}

export interface ProceduralMeshData {
  vertices: number[];
  indices: number[];
  normals: number[];
  color?: [number, number, number, number] | undefined;
  material?: string | undefined;
}

export interface CadComponent {
  /** Qualified Modelica variable name, e.g. "body1" */
  name: string;
  /** Parsed CAD annotation */
  cad: CadAnnotation;
  /** Parsed CADPort annotations from sub-components (connectors) */
  ports?: { name: string; port: CadPortAnnotation }[] | undefined;
  /** Dynamic animation bindings (from DynamicSelect in CAD annotations) */
  dynamicBindings?: { property: string; index: number; variable: string }[] | undefined;
  /** Source code metadata linking to AST parameters and CST byte ranges */
  sourceMetadata?: CadSourceMetadata | undefined;
  /** Procedural triangle mesh for inline CSG/OpenSCAD or MSL Visualizer solids */
  proceduralMesh?: ProceduralMeshData | undefined;
  /** Baseline transform defaults for MSL Visualizers and CAD components */
  defaults?: Record<string, unknown> | undefined;
  /** MSL Visualizer shapeType identifier (e.g., "box", "cylinder", "spring", "torus") */
  shapeType?: string | undefined;
}

export interface CadSceneBounds {
  center: [number, number, number];
  radius: number;
  minY: number;
  min: [number, number, number];
  max: [number, number, number];
}

export interface CfdDomainPreviewState {
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  refinementBoxes?: CfdRefinementBox[] | undefined;
}

export interface AssignedBoundaryCondition {
  id: string;
  kind: BoundaryConditionKind;
  label: string;
  worldPos: [number, number, number];
  normal: [number, number, number];
}

// ── Formatting & URI helpers ─────────────────────────────────────────────────

/** Format a CAD asset URI into a concise human-readable label (hiding inline base64 data URIs). */
export function formatCadAssetLabel(uri?: string): string {
  if (!uri) return "3D Mesh";
  if (uri.startsWith("data:")) return "Embedded 3D Mesh";
  const lastSegment = uri.split("/").pop();
  return lastSegment || "3D Mesh";
}

/**
 * Convert a `modelica://LibraryName/Resources/path.glb` URI into a fetch URL.
 *
 * Strategy: `modelica://Modelica/Resources/CAD/part.glb`
 *   → `{baseUrl}/Modelica/latest/resources/Resources/CAD/part.glb`
 */
export function resolveModelicaUri(uri: string, baseUrl: string): string {
  const match = uri.match(/^modelica:\/\/([^/]+)\/(.+)$/);
  if (!match) return uri; // already a URL
  const [, libraryName, resourcePath] = match;
  return `${baseUrl}/${libraryName}/latest/resources/${resourcePath}`;
}

// ── Physics & Probe mappers ──────────────────────────────────────────────────

export function mapPhysicsToCfdOptions(cfg: CaePhysicsConfig): CaeCfdStudyOptions {
  const solverMap: Record<CaePhysicsConfig["cfd"]["solverFamily"], NonNullable<CaeCfdStudyOptions["solverFamily"]>> = {
    "lbm-d3q19": "lbm",
    "lbm-octree": "octree_lbm",
    "fvm-compressible": "compressible_fvm",
    "dg-nodal": "compressible_dg",
  };
  const turbMap: Record<
    CaePhysicsConfig["cfd"]["turbulenceModel"],
    NonNullable<CaeCfdStudyOptions["turbulenceModel"]>
  > = {
    laminar: "laminar",
    smagorinsky: "smagorinsky_les",
    "dynamic-smagorinsky": "dynamic_smagorinsky",
    "wmles-spalding": "wmles",
    "spalart-allmaras": "spalart-allmaras",
    ddes: "ddes",
  };
  return {
    solverFamily: solverMap[cfg.cfd.solverFamily],
    turbulenceModel: turbMap[cfg.cfd.turbulenceModel],
    collisionOperator: cfg.cfd.collisionOperator,
    curvedBoundary: cfg.cfd.bouzidiCurvedWalls,
    thermal: {
      enabled: cfg.cfd.thermalBoussinesq,
      prandtl: cfg.cfd.prandtl,
      ambientTempK: cfg.cfd.ambientTempK,
      wallTempK: cfg.cfd.wallTempK,
      heatFluxW: cfg.cfd.heatFluxW,
      buoyancy: cfg.cfd.thermalBoussinesq,
    },
    fvmFlux: cfg.cfd.fluxScheme === "roe" ? "roe" : "hllc",
    fvmLimiter: cfg.cfd.limiter,
    implicitGmres: cfg.cfd.implicitGmres,
    dgOrder: cfg.cfd.dgOrder,
    computeFlowFeatures: true,
  };
}

export function mapPhysicsToFeaOptions(cfg: CaePhysicsConfig): CaeFeaStudyOptions {
  const precondMap: Record<
    CaePhysicsConfig["fea"]["preconditioner"],
    NonNullable<CaeFeaStudyOptions["preconditioner"]>
  > = {
    "jacobi-pcg": "jacobi",
    "sa-amg": "sa_amg",
    "mixed-f32-f64-amg": "mixed_precision_amg",
  };
  let laminatePlies: CaeFeaStudyOptions["laminatePlies"];
  if (cfg.fea.materialModel === "cfrp-laminate" && cfg.fea.plyAnglesDeg.length > 0) {
    const angles = cfg.fea.symmetricLayup
      ? [...cfg.fea.plyAnglesDeg, ...[...cfg.fea.plyAnglesDeg].reverse()]
      : cfg.fea.plyAnglesDeg;
    laminatePlies = angles.map((angleDeg) => ({
      angleDeg,
      thickness: cfg.fea.plyThicknessMm * 1e-3,
      E1: cfg.fea.cfrpE1Mpa * 1e6,
      E2: cfg.fea.cfrpE2Mpa * 1e6,
      G12: cfg.fea.cfrpG12Mpa * 1e6,
      nu12: cfg.fea.cfrpNu12,
    }));
  }
  return {
    elementOrder: cfg.fea.elementOrder,
    corotational: cfg.fea.kinematics === "corotational",
    transient: cfg.fea.analysisType === "transient-newmark",
    dt: cfg.fea.newmarkDt,
    steps: cfg.fea.analysisType === "transient-newmark" ? Math.min(16, Math.max(1, cfg.fea.newmarkSteps)) : undefined,
    preconditioner: precondMap[cfg.fea.preconditioner],
    laminatePlies,
  };
}

export function vtkProbeToProbeData(probe: VtkProbePoint, dialect?: "cfd" | "fea"): ProbeData {
  const name = probe.scalarName.toLowerCase();
  const base: ProbeData = {
    screenX: probe.screenX,
    screenY: probe.screenY,
    worldPos: probe.point,
  };
  if (name.includes("stress") || name.includes("mises")) {
    base.vonMisesMpa = probe.value;
  } else if (name.includes("disp")) {
    base.dispMagnitudeMm = probe.value;
  } else if (name.includes("velocity")) {
    base.velocityMs = probe.value;
  } else if (name.includes("pressure")) {
    base.pressurePa = probe.value;
  } else if (name.includes("temp")) {
    base.temperatureK = probe.value;
  } else if (name.includes("q-crit") || name.includes("q_crit")) {
    base.qCriterion = probe.value;
  } else if (name.includes("vort")) {
    base.vorticity = probe.value;
  } else if (name.includes("mach")) {
    base.machNumber = probe.value;
  } else if (dialect === "cfd") {
    base.velocityMs = probe.value;
  } else {
    base.vonMisesMpa = probe.value;
  }
  return base;
}

// ── Scene Geometry & CAE Deck Helpers ────────────────────────────────────────

export function computeSceneBounds(components: CadComponent[]): CadSceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let hasPoints = false;

  for (const comp of components) {
    const p = comp.cad.position ?? [0, 0, 0];
    const s = comp.cad.scale ?? [1, 1, 1];
    if (comp.proceduralMesh && comp.proceduralMesh.vertices.length >= 3) {
      const verts = comp.proceduralMesh.vertices;
      for (let i = 0; i < verts.length; i += 3) {
        const vx = verts[i]! * s[0] + p[0];
        const vy = verts[i + 1]! * s[1] + p[1];
        const vz = verts[i + 2]! * s[2] + p[2];
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
        hasPoints = true;
      }
    } else {
      if (p[0] - 1 < minX) minX = p[0] - 1;
      if (p[1] - 1 < minY) minY = p[1] - 1;
      if (p[2] - 1 < minZ) minZ = p[2] - 1;
      if (p[0] + 1 > maxX) maxX = p[0] + 1;
      if (p[1] + 1 > maxY) maxY = p[1] + 1;
      if (p[2] + 1 > maxZ) maxZ = p[2] + 1;
      hasPoints = true;
    }
  }

  if (!hasPoints) {
    return { center: [0, 0, 0], radius: 2, minY: 0, min: [-1, 0, -1], max: [1, 2, 1] };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const radius = Math.max(0.5, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
  return { center: [cx, cy, cz], radius, minY, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function buildBoundaryCaeSnippet(action: BoundaryActionPayload, targetName: string): string {
  switch (action.kind) {
    case "fixed_support": {
      const maxDof = action.dofs && action.dofs.length > 3 ? 6 : 3;
      return `\n*BOUNDARY\n${targetName}, 1, ${maxDof}, 0.0\n`;
    }
    case "prescribed_displacement": {
      const [dx, dy, dz] = action.displacementVector ?? [0, 0, 0.001];
      return `\n*BOUNDARY\n${targetName}, 1, 1, ${dx}\n${targetName}, 2, 2, ${dy}\n${targetName}, 3, 3, ${dz}\n`;
    }
    case "force_load": {
      const [fx, fy, fz] = action.forceVector ?? [0, 0, -1000];
      return `\n*CLOAD\n${targetName}, 1, ${fx}\n${targetName}, 2, ${fy}\n${targetName}, 3, ${fz}\n`;
    }
    case "pressure_load":
      return `\n*DSLOAD\n${targetName}, P, ${action.pressurePa ?? 100000}\n`;
    case "fluid_inlet":
      return `\nMARKER_INLET= ( ${targetName}, 300.0, 101325.0, 1.0, 0.0, 0.0 ) % U=${action.velocityMs ?? 25} m/s\n`;
    case "fluid_outlet":
      return `\nMARKER_OUTLET= ( ${targetName}, ${action.pressurePa ?? 101325} )\n`;
    case "wall":
      return `\nMARKER_HEATFLUX= ( ${targetName}, 0.0 )\n`;
    case "heatflux":
      return `\nMARKER_HEATFLUX= ( ${targetName}, ${action.heatFluxWm2 ?? 5000} )\n`;
    case "isothermal":
      return `\nMARKER_ISOTHERMAL= ( ${targetName}, ${action.temperatureK ?? 350} )\n`;
    case "farfield":
      return `\nMARKER_FAR= ( ${targetName} )\n`;
    case "symmetry":
      return `\nMARKER_SYM= ( ${targetName} )\n`;
    default:
      return "";
  }
}

export function buildDigitalThreadHyperedges(
  components: CadComponent[],
  dialect: "cfd" | "fea" | "cad" | undefined,
  activeFileName?: string,
): DigitalThreadHyperedge[] {
  if (components.length > 0) {
    return components.slice(0, 8).map((c, idx) => ({
      id: `he-${idx}-${c.name}`,
      cadFaceId: c.name,
      cfdPatchId: dialect === "cfd" ? `patch_${c.name.replace(/[^A-Za-z0-9_]/g, "_")}` : undefined,
      feaSetId: dialect === "fea" ? `NSET_${c.name.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase()}` : undefined,
      modelicaPortId: c.ports?.[0]?.name,
      status: "Synced",
      impactedStudies: [activeFileName ?? "cad_study"],
    }));
  }
  return [
    {
      id: "he-default-domain",
      cadFaceId: activeFileName ?? "CAD_Body",
      cfdPatchId: dialect === "cfd" ? "wall_body" : undefined,
      feaSetId: dialect === "fea" ? "NSET_BODY" : undefined,
      status: "Synced",
      impactedStudies: [activeFileName ?? "cad_study"],
    },
  ];
}
