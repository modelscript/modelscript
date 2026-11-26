// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CadStudyWizardModal
 *
 * Guided 3-step wizard ("New CFD / FEA Study from CAD Artifact") launched directly
 * from .step, .scad, .stl, .obj, or .usd files.
 *
 * Step 1: Select CFD 2030, FEA, or 2-Way FSI solver archetype.
 * Step 2: Inspect pre-flight CAD geometry health (watertightness, naked edges)
 *         and configure wind-tunnel domain / Octree AMR or FEA mesh/material/BCs.
 * Step 3: Review generated .cfg (SU2/CFD 2030) or .inp (CalculiX/FEA) deck with
 *         preserved CAD face tags and {{param}} sweep hooks, then launch.
 */

import {
  AlertIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileCodeIcon,
  RocketIcon,
  ShieldCheckIcon,
  SyncIcon,
} from "@primer/octicons-react";
import { Button, Dialog, Select, TextInput } from "@primer/react";
import { useEffect, useMemo, useState } from "react";

export type StudyArchetypeId =
  | "cfd_wmles_lbm"
  | "cfd_octree_lbm"
  | "cfd_compressible_fvm"
  | "cfd_nodal_dg"
  | "cfd_adjoint_opt"
  | "fea_static_tet10"
  | "fea_transient_dyn"
  | "fea_composite_cfrp"
  | "fsi_two_way";

export type FeaElementOrder = "Tet4" | "Tet10";
export type FeaMeshDensity = "Coarse" | "Moderate" | "Fine";
export type FeaMaterialPresetId = "Al6061-T6" | "Ti-6Al-4V" | "Steel 316L" | "CFRP T300/5208";

export interface CadBoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshHealSummary {
  isWatertight: boolean;
  boundaryEdges: number;
  degenerateRemoved: number;
  verticesWelded: number;
  triangleCount: number;
}

export interface CfdDomainMultipliers {
  upstreamX: number;
  downstreamX: number;
  lateralY: number;
  verticalZ: number;
}

export interface StudyArchetypeSpec {
  id: StudyArchetypeId;
  title: string;
  subtitle: string;
  category: "cfd" | "fea" | "fsi";
  dialect: "cfd" | "fea";
  badge: string;
  solverTag: string;
  defaultMach: number;
  defaultVelocity: number;
  defaultReynolds: number;
}

export const STUDY_ARCHETYPES: readonly StudyArchetypeSpec[] = [
  {
    id: "cfd_wmles_lbm",
    title: "Incompressible WMLES / LBM",
    subtitle: "WebGPU D3Q19 + Bouzidi Curved Walls",
    category: "cfd",
    dialect: "cfd",
    badge: "CFD · WebGPU",
    solverTag: "LBM_D3Q19_WMLES",
    defaultMach: 0.12,
    defaultVelocity: 40.0,
    defaultReynolds: 1.5e6,
  },
  {
    id: "cfd_octree_lbm",
    title: "Adaptive 2:1 Octree LBM",
    subtitle: "Local Wake/Body Refinement + Sub-Cycling",
    category: "cfd",
    dialect: "cfd",
    badge: "CFD · AMR",
    solverTag: "LBM_OCTREE_2TO1",
    defaultMach: 0.15,
    defaultVelocity: 50.0,
    defaultReynolds: 2.5e6,
  },
  {
    id: "cfd_compressible_fvm",
    title: "Compressible FVM",
    subtitle: "HLLC/Roe + Spalart-Allmaras / DDES + GMRES",
    category: "cfd",
    dialect: "cfd",
    badge: "CFD · Transonic",
    solverTag: "FVM_RANS_DDES_HLLC",
    defaultMach: 0.78,
    defaultVelocity: 265.0,
    defaultReynolds: 6.5e6,
  },
  {
    id: "cfd_nodal_dg",
    title: "High-Order Nodal DG",
    subtitle: "p=1..3 Compressible Euler Spectral Elements",
    category: "cfd",
    dialect: "cfd",
    badge: "CFD · High-Order",
    solverTag: "NODAL_DG_EULER_P3",
    defaultMach: 0.65,
    defaultVelocity: 221.0,
    defaultReynolds: 4.0e6,
  },
  {
    id: "cfd_adjoint_opt",
    title: "Discrete Adjoint LBM / NILSS",
    subtitle: "Gradient-Based Aerodynamic Shape Optimization",
    category: "cfd",
    dialect: "cfd",
    badge: "CFD · Adjoint",
    solverTag: "ADJOINT_LBM_NILSS",
    defaultMach: 0.18,
    defaultVelocity: 60.0,
    defaultReynolds: 2.0e6,
  },
  {
    id: "fea_static_tet10",
    title: "Static / Nonlinear FEA",
    subtitle: "Tet10 + Corotational Kinematics + SA-AMG",
    category: "fea",
    dialect: "fea",
    badge: "FEA · Structural",
    solverTag: "FEA_NLGEOM_SA_AMG",
    defaultMach: 0,
    defaultVelocity: 0,
    defaultReynolds: 0,
  },
  {
    id: "fea_transient_dyn",
    title: "Transient Elastodynamics",
    subtitle: "Newmark-β Time Integration + Rayleigh Damping",
    category: "fea",
    dialect: "fea",
    badge: "FEA · Dynamics",
    solverTag: "FEA_NEWMARK_BETA",
    defaultMach: 0,
    defaultVelocity: 0,
    defaultReynolds: 0,
  },
  {
    id: "fea_composite_cfrp",
    title: "Aerospace Composite Laminate FEA",
    subtitle: "Orthotropic CFRP / ABD Stiffness + J2 Plasticity",
    category: "fea",
    dialect: "fea",
    badge: "FEA · Composite",
    solverTag: "FEA_CFRP_ABD_J2",
    defaultMach: 0,
    defaultVelocity: 0,
    defaultReynolds: 0,
  },
  {
    id: "fsi_two_way",
    title: "2-Way Partitioned Aeroelastic FSI",
    subtitle: "Vector Aitken Relaxation + Interface Coupling",
    category: "fsi",
    dialect: "cfd",
    badge: "FSI · Coupled",
    solverTag: "FSI_VECTOR_AITKEN",
    defaultMach: 0.35,
    defaultVelocity: 120.0,
    defaultReynolds: 3.5e6,
  },
];

interface FeaMaterialProperties {
  id: FeaMaterialPresetId;
  label: string;
  youngsModulusPa: number;
  poissonRatio: number;
  densityKgM3: number;
  yieldStressPa: number;
  orthotropic?:
    | {
        E1: number;
        E2: number;
        E3: number;
        nu12: number;
        G12: number;
        G13: number;
        G23: number;
      }
    | undefined;
}

const FEA_MATERIALS: Record<FeaMaterialPresetId, FeaMaterialProperties> = {
  "Al6061-T6": {
    id: "Al6061-T6",
    label: "Aluminum 6061-T6 (E = 68.9 GPa, ρ = 2700 kg/m³)",
    youngsModulusPa: 68.9e9,
    poissonRatio: 0.33,
    densityKgM3: 2700,
    yieldStressPa: 276e6,
  },
  "Ti-6Al-4V": {
    id: "Ti-6Al-4V",
    label: "Titanium Ti-6Al-4V (E = 113.8 GPa, ρ = 4430 kg/m³)",
    youngsModulusPa: 113.8e9,
    poissonRatio: 0.342,
    densityKgM3: 4430,
    yieldStressPa: 880e6,
  },
  "Steel 316L": {
    id: "Steel 316L",
    label: "Stainless Steel 316L (E = 193 GPa, ρ = 8000 kg/m³)",
    youngsModulusPa: 193e9,
    poissonRatio: 0.27,
    densityKgM3: 8000,
    yieldStressPa: 290e6,
  },
  "CFRP T300/5208": {
    id: "CFRP T300/5208",
    label: "CFRP T300/5208 Laminate (E1 = 181 GPa, E2 = 10.3 GPa)",
    youngsModulusPa: 181e9,
    poissonRatio: 0.28,
    densityKgM3: 1600,
    yieldStressPa: 1500e6,
    orthotropic: {
      E1: 181e9,
      E2: 10.3e9,
      E3: 10.3e9,
      nu12: 0.28,
      G12: 7.17e9,
      G13: 7.17e9,
      G23: 3.78e9,
    },
  },
};

export interface CadStudyWizardConfig {
  archetype: StudyArchetypeId;
  cadArtifactName: string;
  cadArtifactUri?: string | undefined;
  detectedFaceTags: string[];
  boundingBox?: CadBoundingBox | undefined;
  meshHealSummary?: MeshHealSummary | null | undefined;
  customFileName?: string | undefined;
  // CFD parameters
  domainMultipliers: CfdDomainMultipliers;
  freestreamVelocity: number;
  machNumber: number;
  reynoldsNumber: number;
  enableOctreeRefinement: boolean;
  octreeLevels?: number | undefined;
  // FEA parameters
  elementOrder: FeaElementOrder;
  meshDensity: FeaMeshDensity;
  materialPreset: FeaMaterialPresetId;
  fixedFaceTag: string;
  loadFaceTag: string;
  loadMagnitudeN?: number | undefined;
}

export interface GeneratedCadStudyResult {
  fileName: string;
  dialect: "cfd" | "fea";
  content: string;
  studyOptions: Record<string, unknown>;
}

export interface CadStudyWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cadArtifactName: string;
  cadArtifactUri?: string | undefined;
  detectedFaceTags: string[];
  boundingBox?: CadBoundingBox | undefined;
  meshHealSummary?: MeshHealSummary | null | undefined;
  onRunHealCheck?: (() => Promise<MeshHealSummary> | MeshHealSummary) | undefined;
  onCreateStudy: (result: GeneratedCadStudyResult) => void;
  onPreviewDomainChange?:
    | ((bounds: {
        domainMin: [number, number, number];
        domainMax: [number, number, number];
        enableOctreeRefinement: boolean;
      }) => void)
    | undefined;
  initialArchetype?: StudyArchetypeId | undefined;
  dark?: boolean | undefined;
}

function getArchetypeSpec(id: StudyArchetypeId): StudyArchetypeSpec {
  return STUDY_ARCHETYPES.find((a) => a.id === id) ?? STUDY_ARCHETYPES[0]!;
}

function sanitizeStem(rawName: string): string {
  const base = rawName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  const clean = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "cad_study";
}

function sanitizeTag(tag: string): string {
  const clean = tag
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "WALL";
}

/**
 * Computes physical wind-tunnel [domainMin, domainMax] bounds from a CAD bounding box
 * and upstream/downstream/lateral/vertical multipliers.
 */
export function computeWindTunnelBounds(
  boundingBox: CadBoundingBox | undefined,
  multipliers: CfdDomainMultipliers,
): { domainMin: [number, number, number]; domainMax: [number, number, number] } {
  const min = boundingBox?.min ?? [-0.5, -0.5, -0.5];
  const max = boundingBox?.max ?? [0.5, 0.5, 0.5];

  const lx = Math.max(1e-3, max[0] - min[0]);
  const ly = Math.max(1e-3, max[1] - min[1]);
  const lz = Math.max(1e-3, max[2] - min[2]);
  const refLen = Math.max(lx, ly, lz);

  const domainMin: [number, number, number] = [
    min[0] - multipliers.upstreamX * refLen,
    min[1] - multipliers.lateralY * refLen * 0.5,
    min[2] - multipliers.verticalZ * refLen * 0.5,
  ];
  const domainMax: [number, number, number] = [
    max[0] + multipliers.downstreamX * refLen,
    max[1] + multipliers.lateralY * refLen * 0.5,
    max[2] + multipliers.verticalZ * refLen * 0.5,
  ];
  return { domainMin, domainMax };
}

/**
 * Pure helper generating a clean, comment-annotated .cfg (SU2 / CFD 2030) or .inp (CalculiX / FEA)
 * study deck from a CAD artifact wizard configuration, preserving detected face tags and
 * {{param}} template hooks for parametric sweeps.
 */
export function generateStudyDeckFromCad(config: CadStudyWizardConfig): GeneratedCadStudyResult {
  const spec = getArchetypeSpec(config.archetype);
  const dialect: "cfd" | "fea" = spec.dialect;
  const stem = sanitizeStem(config.cadArtifactName);
  const ext = dialect === "cfd" ? ".cfg" : ".inp";
  const defaultFileName = `${stem}_${config.archetype}${ext}`;
  const fileName = config.customFileName?.trim()
    ? config.customFileName.trim().endsWith(ext)
      ? config.customFileName.trim()
      : `${config.customFileName.trim()}${ext}`
    : defaultFileName;

  const faceTags = config.detectedFaceTags.length > 0 ? config.detectedFaceTags.map(sanitizeTag) : ["BODY_WALL"];

  const { domainMin, domainMax } = computeWindTunnelBounds(config.boundingBox, config.domainMultipliers);

  if (dialect === "cfd") {
    const markerList = faceTags.join(", ");
    const solverBlock = (() => {
      switch (config.archetype) {
        case "cfd_wmles_lbm":
          return [
            "SOLVER= INC_LBM_WMLES",
            "LBM_LATTICE= D3Q19",
            "LBM_WALL_TREATMENT= BOUZIDI_CURVED",
            "LBM_SGS_MODEL= WALE",
            "BACKEND_DEVICE= WEBGPU",
          ];
        case "cfd_octree_lbm":
          return [
            "SOLVER= INC_LBM_OCTREE",
            "LBM_LATTICE= D3Q19",
            "AMR_OCTREE_RATIO= 2_TO_1",
            `AMR_MAX_LEVELS= ${config.octreeLevels ?? 3}`,
            "LBM_WALL_TREATMENT= BOUZIDI_CURVED",
          ];
        case "cfd_compressible_fvm":
          return [
            "SOLVER= RANS",
            "KIND_TURB_MODEL= SA_DDES",
            "CONV_NUM_METHOD_FLOW= HLLC",
            "LINEAR_SOLVER= FGMRES",
            "LINEAR_SOLVER_PREC= ILU",
          ];
        case "cfd_nodal_dg":
          return [
            "SOLVER= EULER_NODAL_DG",
            "DG_POLYNOMIAL_ORDER= {{dg_order}}",
            "DG_RIEMANN_FLUX= ROE",
            "TIME_DISCRE_FLOW= RK4_SSP",
          ];
        case "cfd_adjoint_opt":
          return [
            "SOLVER= INC_LBM_WMLES",
            "MATH_PROBLEM= DISCRETE_ADJOINT",
            "ADJOINT_SENSITIVITY_METHOD= NILSS",
            "OBJECTIVE_FUNCTION= DRAG",
            "OPT_DESIGN_VARS= FFD_CONTROL_POINTS",
          ];
        case "fsi_two_way":
          return [
            "SOLVER= INC_LBM_WMLES",
            "MULTIPHYSICS= FSI_TWO_WAY",
            "FSI_COUPLING_SCHEME= VECTOR_AITKEN",
            "FSI_RELAXATION_INIT= 0.25",
            `FSI_STRUCTURAL_ELEMENT= ${config.elementOrder}`,
            `FSI_STRUCTURAL_MATERIAL= ${config.materialPreset.replace(/\s+/g, "_")}`,
          ];
        default:
          return ["SOLVER= INC_LBM_WMLES"];
      }
    })();

    const lines: string[] = [
      "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
      `% ModelScript CFD 2030 Study Deck — ${spec.title}`,
      `% Source CAD Artifact: ${config.cadArtifactName}`,
      ...(config.cadArtifactUri ? [`% CAD URI: ${config.cadArtifactUri}`] : []),
      `% Archetype: ${config.archetype} (${spec.solverTag})`,
      ...(config.meshHealSummary
        ? [
            `% Pre-Flight Mesh Health: ${config.meshHealSummary.isWatertight ? "WATERTIGHT" : "OPEN_EDGES"} ` +
              `(triangles=${config.meshHealSummary.triangleCount}, boundaryEdges=${config.meshHealSummary.boundaryEdges}, ` +
              `welded=${config.meshHealSummary.verticesWelded})`,
          ]
        : []),
      "%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%",
      "",
      "% --- Solver & Physical Model ---",
      ...solverBlock,
      "",
      "% --- Freestream & Parametric Sweep Hooks ({{param}}) ---",
      `MACH_NUMBER= {{mach_number}}              % Default: ${config.machNumber.toFixed(3)}`,
      `FREESTREAM_VELOCITY= {{freestream_velocity}} % Default: ${config.freestreamVelocity.toFixed(2)} m/s`,
      `REYNOLDS_NUMBER= {{reynolds_number}}      % Default: ${config.reynoldsNumber.toExponential(2)}`,
      "AOA= {{aoa_deg}}                          % Default: 0.0 deg",
      "SIDESLIP_ANGLE= 0.0",
      "FREESTREAM_TEMPERATURE= 288.15",
      "",
      "% --- External Wind-Tunnel Computational Domain (meters) ---",
      `DOMAIN_MIN= ( ${domainMin[0].toFixed(4)}, ${domainMin[1].toFixed(4)}, ${domainMin[2].toFixed(4)} )`,
      `DOMAIN_MAX= ( ${domainMax[0].toFixed(4)}, ${domainMax[1].toFixed(4)}, ${domainMax[2].toFixed(4)} )`,
      `DOMAIN_MULTIPLIERS= ( ${config.domainMultipliers.upstreamX}, ${config.domainMultipliers.downstreamX}, ${config.domainMultipliers.lateralY}, ${config.domainMultipliers.verticalZ} )`,
      `OCTREE_REFINEMENT_ENABLED= ${config.enableOctreeRefinement ? "YES" : "NO"}`,
      ...(config.enableOctreeRefinement ? [`OCTREE_REFINEMENT_LEVELS= ${config.octreeLevels ?? 2}`] : []),
      "",
      "% --- CAD Geometry & Preserved Face Tag Boundary Conditions ---",
      `MESH_FILENAME= ${config.cadArtifactName}`,
      "MARKER_FAR= ( INLET, OUTLET, SYMMETRY_Y_MIN, SYMMETRY_Y_MAX, SYMMETRY_Z_MIN, SYMMETRY_Z_MAX )",
      `MARKER_HEATFLUX= ( ${markerList
        .split(", ")
        .map((t) => `${t}, 0.0`)
        .join(", ")} )`,
      `MARKER_PLOTTING= ( ${markerList} )`,
      `MARKER_MONITORING= ( ${markerList} )`,
      ...(config.archetype === "fsi_two_way"
        ? [
            "",
            "% --- 2-Way FSI Structural Interface ---",
            `FSI_WET_INTERFACE= ( ${markerList} )`,
            `FSI_FIXED_SURFACE= ${sanitizeTag(config.fixedFaceTag)}`,
          ]
        : []),
      "",
      "% --- Convergence & Output ---",
      "ITER= 2000",
      "CONV_RESIDUAL_MINVAL= -8",
      "OUTPUT_FILES= ( RESTART, PARAVIEW, SURFACE_PARAVIEW )",
      "VOLUME_FILENAME= flow_solution",
      "SURFACE_FILENAME= surface_flow",
      "",
    ];

    const studyOptions: Record<string, unknown> = {
      archetype: config.archetype,
      solverTag: spec.solverTag,
      cadArtifactName: config.cadArtifactName,
      cadArtifactUri: config.cadArtifactUri,
      detectedFaceTags: faceTags,
      domainMin,
      domainMax,
      domainMultipliers: config.domainMultipliers,
      enableOctreeRefinement: config.enableOctreeRefinement,
      octreeLevels: config.enableOctreeRefinement ? (config.octreeLevels ?? 2) : 0,
      templateDefaults: {
        mach_number: config.machNumber,
        freestream_velocity: config.freestreamVelocity,
        reynolds_number: config.reynoldsNumber,
        aoa_deg: 0.0,
        ...(config.archetype === "cfd_nodal_dg" ? { dg_order: 2 } : {}),
      },
      ...(config.archetype === "fsi_two_way"
        ? {
            feaElementOrder: config.elementOrder,
            feaMeshDensity: config.meshDensity,
            feaMaterialPreset: config.materialPreset,
            fixedFaceTag: sanitizeTag(config.fixedFaceTag),
            loadFaceTag: sanitizeTag(config.loadFaceTag),
          }
        : {}),
    };

    return {
      fileName,
      dialect,
      content: lines.join("\n"),
      studyOptions,
    };
  }

  // FEA (.inp CalculiX / ModelScript FEA deck)
  const mat = FEA_MATERIALS[config.materialPreset];
  const elType = config.elementOrder === "Tet10" ? "C3D10" : "C3D4";
  const fixedTag = sanitizeTag(config.fixedFaceTag || faceTags[0] || "FIXED_SUPPORT");
  const loadTag = sanitizeTag(config.loadFaceTag || faceTags[1] || faceTags[0] || "LOAD_FACE");
  const loadMag = config.loadMagnitudeN ?? 1000;
  const matName = config.materialPreset.replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase();

  const materialLines: string[] =
    config.archetype === "fea_composite_cfrp" && mat.orthotropic
      ? [
          `*MATERIAL, NAME=${matName}`,
          "*ELASTIC, TYPE=ENGINEERING CONSTANTS",
          `${mat.orthotropic.E1.toExponential(3)}, ${mat.orthotropic.E2.toExponential(3)}, ${mat.orthotropic.E3.toExponential(3)}, ${mat.orthotropic.nu12}, ${mat.orthotropic.nu12}, 0.40, ${mat.orthotropic.G12.toExponential(3)}, ${mat.orthotropic.G13.toExponential(3)}`,
          `${mat.orthotropic.G23.toExponential(3)}`,
          "*DENSITY",
          `${mat.densityKgM3}`,
          "** Aerospace CFRP Laminate Layup (ABD Stiffness + J2 Matrix Plasticity)",
          "*SHELL SECTION, COMPOSITE, ELSET=EALL",
          "0.00025, , CFRP_T300_5208, 0.0",
          "0.00025, , CFRP_T300_5208, 45.0",
          "0.00025, , CFRP_T300_5208, -45.0",
          "0.00025, , CFRP_T300_5208, 90.0",
        ]
      : [
          `*MATERIAL, NAME=${matName}`,
          "*ELASTIC",
          `{{youngs_modulus_pa}}, ${mat.poissonRatio}`,
          "*DENSITY",
          `${mat.densityKgM3}`,
          "*PLASTIC",
          `${mat.yieldStressPa.toExponential(3)}, 0.0`,
          `${(mat.yieldStressPa * 1.18).toExponential(3)}, 0.05`,
          `*SOLID SECTION, ELSET=EALL, MATERIAL=${matName}`,
        ];

  const stepLines: string[] =
    config.archetype === "fea_transient_dyn"
      ? [
          "** Transient Elastodynamics — Newmark-beta + Rayleigh Damping",
          "*DAMPING, ALPHA=2.5, BETA=1.0E-5",
          "*STEP, NLGEOM",
          "*DYNAMIC, ALPHA=-0.05",
          "0.001, 0.1, 1.0E-5, 0.005",
        ]
      : [
          "** Static / Corotational Nonlinear FEA — SA-AMG Preconditioned Solver",
          "*STEP, NLGEOM",
          "*STATIC",
          "0.1, 1.0, 1.0E-5, 0.25",
        ];

  const lines: string[] = [
    "** =============================================================================",
    `** ModelScript FEA Study Deck — ${spec.title}`,
    `** Source CAD Artifact: ${config.cadArtifactName}`,
    ...(config.cadArtifactUri ? [`** CAD URI: ${config.cadArtifactUri}`] : []),
    `** Archetype: ${config.archetype} (${spec.solverTag})`,
    `** Mesh: ${config.elementOrder} (${elType}), Density=${config.meshDensity}`,
    ...(config.meshHealSummary
      ? [
          `** Pre-Flight Mesh Health: ${config.meshHealSummary.isWatertight ? "WATERTIGHT" : "OPEN_EDGES"} ` +
            `(triangles=${config.meshHealSummary.triangleCount}, boundaryEdges=${config.meshHealSummary.boundaryEdges})`,
        ]
      : []),
    "** =============================================================================",
    "",
    `*HEADING`,
    `${spec.title} for ${config.cadArtifactName}`,
    "",
    "** --- CAD Geometry & Preserved Face Tag Node/Surface Sets ---",
    `*INCLUDE, INPUT=${stem}_${config.meshDensity.toLowerCase()}_${elType.toLowerCase()}.msh`,
    ...faceTags.map((tag) => `** Detected CAD Face Tag: ${tag}`),
    ...faceTags.map((tag) => `*NSET, NSET=NS_${tag}\n** (auto-populated from CAD face tag '${tag}')`),
    "",
    "** --- Material & Section Definition ({{youngs_modulus_pa}} sweep hook) ---",
    ...materialLines,
    "",
    "** --- Boundary Conditions & Loads ({{load_magnitude_n}} sweep hook) ---",
    ...stepLines,
    "*BOUNDARY",
    `NS_${fixedTag}, 1, 3, 0.0`,
    "*CLOAD",
    `NS_${loadTag}, 3, {{load_magnitude_n}}`,
    "*NODE FILE",
    "U, RF",
    "*EL FILE",
    "S, E, ENER",
    "*END STEP",
    "",
  ];

  const studyOptions: Record<string, unknown> = {
    archetype: config.archetype,
    solverTag: spec.solverTag,
    cadArtifactName: config.cadArtifactName,
    cadArtifactUri: config.cadArtifactUri,
    detectedFaceTags: faceTags,
    elementOrder: config.elementOrder,
    elementType: elType,
    meshDensity: config.meshDensity,
    materialPreset: config.materialPreset,
    fixedFaceTag: fixedTag,
    loadFaceTag: loadTag,
    templateDefaults: {
      youngs_modulus_pa: mat.youngsModulusPa,
      load_magnitude_n: -Math.abs(loadMag),
    },
  };

  return {
    fileName,
    dialect,
    content: lines.join("\n"),
    studyOptions,
  };
}

export function CadStudyWizardModal({
  isOpen,
  onClose,
  cadArtifactName,
  cadArtifactUri,
  detectedFaceTags,
  boundingBox,
  meshHealSummary,
  onRunHealCheck,
  onCreateStudy,
  onPreviewDomainChange,
  initialArchetype = "cfd_wmles_lbm",
  dark = true,
}: CadStudyWizardModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [archetype, setArchetype] = useState<StudyArchetypeId>(initialArchetype);

  // Geometry heal state
  const [localHealSummary, setLocalHealSummary] = useState<MeshHealSummary | null>(meshHealSummary ?? null);
  const [isRunningHeal, setIsRunningHeal] = useState(false);

  // CFD domain & physics state
  const [domainMultipliers, setDomainMultipliers] = useState<CfdDomainMultipliers>({
    upstreamX: 3.0,
    downstreamX: 8.0,
    lateralY: 3.0,
    verticalZ: 3.0,
  });
  const [freestreamVelocity, setFreestreamVelocity] = useState<number>(40.0);
  const [machNumber, setMachNumber] = useState<number>(0.12);
  const [reynoldsNumber, setReynoldsNumber] = useState<number>(1.5e6);
  const [enableOctreeRefinement, setEnableOctreeRefinement] = useState<boolean>(false);
  const [octreeLevels, setOctreeLevels] = useState<number>(2);

  // FEA mesh, material & BC state
  const [elementOrder, setElementOrder] = useState<FeaElementOrder>("Tet10");
  const [meshDensity, setMeshDensity] = useState<FeaMeshDensity>("Moderate");
  const [materialPreset, setMaterialPreset] = useState<FeaMaterialPresetId>("Al6061-T6");
  const [fixedFaceTag, setFixedFaceTag] = useState<string>(detectedFaceTags[0] ?? "FIXED_SUPPORT");
  const [loadFaceTag, setLoadFaceTag] = useState<string>(detectedFaceTags[1] ?? detectedFaceTags[0] ?? "LOAD_FACE");
  const [loadMagnitudeN, setLoadMagnitudeN] = useState<number>(1000);

  // Step 3 custom file name
  const [customFileName, setCustomFileName] = useState<string>("");

  // Sync incoming meshHealSummary prop
  useEffect(() => {
    setLocalHealSummary(meshHealSummary ?? null);
  }, [meshHealSummary]);

  // Reset step & face tags when modal opens for a new CAD artifact
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setCustomFileName("");
      setFixedFaceTag(detectedFaceTags[0] ?? "FIXED_SUPPORT");
      setLoadFaceTag(detectedFaceTags[1] ?? detectedFaceTags[0] ?? "LOAD_FACE");
    }
  }, [isOpen, cadArtifactName, detectedFaceTags]);

  const activeSpec = useMemo(() => getArchetypeSpec(archetype), [archetype]);
  const showCfdControls = activeSpec.category === "cfd" || activeSpec.category === "fsi";
  const showFeaControls = activeSpec.category === "fea" || activeSpec.category === "fsi";

  // Apply archetype physics defaults when archetype changes
  const handleSelectArchetype = (nextId: StudyArchetypeId) => {
    setArchetype(nextId);
    const spec = getArchetypeSpec(nextId);
    if (spec.category === "cfd" || spec.category === "fsi") {
      setMachNumber(spec.defaultMach);
      setFreestreamVelocity(spec.defaultVelocity);
      setReynoldsNumber(spec.defaultReynolds);
      setEnableOctreeRefinement(nextId === "cfd_octree_lbm");
    }
    if (nextId === "fea_composite_cfrp") {
      setMaterialPreset("CFRP T300/5208");
    }
  };

  // Live preview domain callback for 3D CfdDomainGizmo sync
  const computedBounds = useMemo(
    () => computeWindTunnelBounds(boundingBox, domainMultipliers),
    [boundingBox, domainMultipliers],
  );

  useEffect(() => {
    if (isOpen && showCfdControls && onPreviewDomainChange) {
      onPreviewDomainChange({
        domainMin: computedBounds.domainMin,
        domainMax: computedBounds.domainMax,
        enableOctreeRefinement,
      });
    }
  }, [isOpen, showCfdControls, computedBounds, enableOctreeRefinement, onPreviewDomainChange]);

  const wizardConfig: CadStudyWizardConfig = useMemo(
    () => ({
      archetype,
      cadArtifactName,
      cadArtifactUri,
      detectedFaceTags,
      boundingBox,
      meshHealSummary: localHealSummary,
      customFileName: customFileName || undefined,
      domainMultipliers,
      freestreamVelocity,
      machNumber,
      reynoldsNumber,
      enableOctreeRefinement,
      octreeLevels,
      elementOrder,
      meshDensity,
      materialPreset,
      fixedFaceTag,
      loadFaceTag,
      loadMagnitudeN,
    }),
    [
      archetype,
      cadArtifactName,
      cadArtifactUri,
      detectedFaceTags,
      boundingBox,
      localHealSummary,
      customFileName,
      domainMultipliers,
      freestreamVelocity,
      machNumber,
      reynoldsNumber,
      enableOctreeRefinement,
      octreeLevels,
      elementOrder,
      meshDensity,
      materialPreset,
      fixedFaceTag,
      loadFaceTag,
      loadMagnitudeN,
    ],
  );

  const generatedResult = useMemo(() => generateStudyDeckFromCad(wizardConfig), [wizardConfig]);

  const handleRunHealCheckClick = async () => {
    if (!onRunHealCheck || isRunningHeal) return;
    setIsRunningHeal(true);
    try {
      const summary = await onRunHealCheck();
      setLocalHealSummary(summary);
    } finally {
      setIsRunningHeal(false);
    }
  };

  const handleLaunchStudy = () => {
    onCreateStudy(generatedResult);
    onClose();
  };

  if (!isOpen) return null;

  const borderCol = dark ? "#30363d" : "#d0d7de";
  const subtleBg = dark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.02)";
  const mutedFg = dark ? "#8b949e" : "#57606a";
  const primaryFg = dark ? "#f0f6fc" : "#1f2328";

  const faceOptions = detectedFaceTags.length > 0 ? detectedFaceTags : ["FIXED_SUPPORT", "LOAD_FACE", "BODY_WALL"];

  const parseNumeric = (raw: string, fallback: number): number => {
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : fallback;
  };

  return (
    <Dialog
      onClose={onClose}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <RocketIcon size={16} />
          <span>New CFD / FEA Study from CAD Artifact</span>
        </span>
      }
      subtitle={
        <span>
          Source CAD:{" "}
          <code style={{ color: "var(--fgColor-accent, var(--ms-brand))", fontWeight: 600 }}>{cadArtifactName}</code>
          {` • ${detectedFaceTags.length} face tag${detectedFaceTags.length === 1 ? "" : "s"} detected`}
        </span>
      }
      width="xlarge"
      footerButtons={[
        {
          buttonType: "default",
          content: "Cancel",
          onClick: onClose,
        },
        ...(step > 1
          ? [
              {
                buttonType: "default" as const,
                content: "Back",
                leadingVisual: ChevronLeftIcon,
                onClick: () => setStep((s) => (s === 3 ? 2 : 1)),
              },
            ]
          : []),
        ...(step < 3
          ? [
              {
                buttonType: "primary" as const,
                content: step === 1 ? "Next: Geometry & Domain" : "Next: Review & Generate",
                trailingVisual: ChevronRightIcon,
                onClick: () => setStep((s) => (s === 1 ? 2 : 3)),
              },
            ]
          : [
              {
                buttonType: "primary" as const,
                content: `Create & Launch ${generatedResult.dialect.toUpperCase()} Study`,
                leadingVisual: CheckIcon,
                onClick: handleLaunchStudy,
              },
            ]),
      ]}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* 3-Step Wizard Indicator */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "8px",
            padding: "8px",
            borderRadius: "8px",
            background: subtleBg,
            border: `1px solid ${borderCol}`,
          }}
        >
          {(
            [
              { num: 1 as const, label: "1. Study Archetype" },
              { num: 2 as const, label: "2. Geometry Health & Domain" },
              { num: 3 as const, label: "3. Generate & Launch" },
            ] as const
          ).map((item) => {
            const isActive = step === item.num;
            const isDone = step > item.num;
            return (
              <button
                key={item.num}
                type="button"
                onClick={() => setStep(item.num)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: isActive ? "1px solid var(--borderColor-accent-emphasis, #38bdf8)" : "1px solid transparent",
                  background: isActive ? (dark ? "rgba(56, 189, 248, 0.14)" : "rgba(9, 105, 218, 0.1)") : "transparent",
                  color: isActive ? primaryFg : isDone ? "#10b981" : mutedFg,
                  fontSize: "12px",
                  fontWeight: isActive ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {isDone && <CheckCircleIcon size={13} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* STEP 1: STUDY ARCHETYPE */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "12px", color: mutedFg }}>
              Select a solver architecture for <strong>{cadArtifactName}</strong>. ModelScript will synthesize a
              parametric CFD 2030 (<code>.cfg</code>) or CalculiX FEA (<code>.inp</code>) deck with preserved CAD face
              tags.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: "10px",
              }}
            >
              {STUDY_ARCHETYPES.map((item) => {
                const selected = archetype === item.id;
                const badgeColor =
                  item.category === "cfd" ? "#06b6d4" : item.category === "fea" ? "#a855f7" : "#f59e0b";
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectArchetype(item.id)}
                    style={{
                      textAlign: "left",
                      padding: "12px",
                      borderRadius: "8px",
                      border: selected ? `2px solid ${badgeColor}` : `1px solid ${borderCol}`,
                      background: selected ? (dark ? "rgba(56, 189, 248, 0.08)" : "rgba(9, 105, 218, 0.06)") : subtleBg,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          padding: "2px 6px",
                          borderRadius: "999px",
                          color: badgeColor,
                          border: `1px solid ${badgeColor}`,
                        }}
                      >
                        {item.badge}
                      </span>
                      {selected && <CheckCircleIcon size={14} fill={badgeColor} />}
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 700, color: primaryFg }}>{item.title}</div>
                    <div style={{ fontSize: "11px", color: mutedFg, lineHeight: 1.4 }}>{item.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: PRE-FLIGHT GEOMETRY HEALTH & DOMAIN */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {/* Pre-Flight Geometry Health Panel */}
            <div
              style={{
                padding: "12px 14px",
                borderRadius: "8px",
                background: subtleBg,
                border: `1px solid ${borderCol}`,
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ShieldCheckIcon size={16} />
                  <span style={{ fontSize: "13px", fontWeight: 700, color: primaryFg }}>
                    Pre-Flight CAD Geometry Health
                  </span>
                  {localHealSummary ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: localHealSummary.isWatertight
                          ? "rgba(16, 185, 129, 0.16)"
                          : "rgba(245, 158, 11, 0.18)",
                        color: localHealSummary.isWatertight ? "#10b981" : "#f59e0b",
                        border: `1px solid ${localHealSummary.isWatertight ? "#10b981" : "#f59e0b"}`,
                      }}
                    >
                      {localHealSummary.isWatertight ? (
                        <>
                          <CheckCircleIcon size={12} /> Watertight Manifold
                        </>
                      ) : (
                        <>
                          <AlertIcon size={12} /> Auto-Healed / Open Edges ({localHealSummary.boundaryEdges})
                        </>
                      )}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        color: mutedFg,
                        border: `1px solid ${borderCol}`,
                      }}
                    >
                      Not Checked
                    </span>
                  )}
                </div>

                {onRunHealCheck && (
                  <Button
                    size="small"
                    variant="default"
                    leadingVisual={SyncIcon}
                    disabled={isRunningHeal}
                    onClick={() => {
                      void handleRunHealCheckClick();
                    }}
                  >
                    {isRunningHeal ? "Checking Geometry…" : "Run Geometry Health Check"}
                  </Button>
                )}
              </div>

              {/* Metrics + Detected Face Tags + Bounding Box */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: "8px",
                  fontSize: "11px",
                }}
              >
                <div style={{ padding: "6px 8px", borderRadius: "6px", border: `1px solid ${borderCol}` }}>
                  <div style={{ color: mutedFg }}>Triangles</div>
                  <div style={{ fontWeight: 700, fontFamily: "monospace", color: primaryFg }}>
                    {localHealSummary ? localHealSummary.triangleCount.toLocaleString() : "—"}
                  </div>
                </div>
                <div style={{ padding: "6px 8px", borderRadius: "6px", border: `1px solid ${borderCol}` }}>
                  <div style={{ color: mutedFg }}>Boundary / Naked Edges</div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontFamily: "monospace",
                      color: localHealSummary && localHealSummary.boundaryEdges > 0 ? "#f59e0b" : primaryFg,
                    }}
                  >
                    {localHealSummary ? localHealSummary.boundaryEdges : "—"}
                  </div>
                </div>
                <div style={{ padding: "6px 8px", borderRadius: "6px", border: `1px solid ${borderCol}` }}>
                  <div style={{ color: mutedFg }}>Vertices Welded</div>
                  <div style={{ fontWeight: 700, fontFamily: "monospace", color: primaryFg }}>
                    {localHealSummary ? localHealSummary.verticesWelded : "—"}
                  </div>
                </div>
                <div style={{ padding: "6px 8px", borderRadius: "6px", border: `1px solid ${borderCol}` }}>
                  <div style={{ color: mutedFg }}>Degenerate Removed</div>
                  <div style={{ fontWeight: 700, fontFamily: "monospace", color: primaryFg }}>
                    {localHealSummary ? localHealSummary.degenerateRemoved : "—"}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  fontSize: "11px",
                  color: mutedFg,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>
                  <span>Detected Face Tags:</span>
                  {faceOptions.map((tag) => (
                    <code
                      key={tag}
                      style={{
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                        color: primaryFg,
                      }}
                    >
                      {tag}
                    </code>
                  ))}
                </div>
                {boundingBox && (
                  <span style={{ fontFamily: "monospace" }}>
                    BBox: [{boundingBox.min.map((n) => n.toFixed(2)).join(", ")}] → [
                    {boundingBox.max.map((n) => n.toFixed(2)).join(", ")}] m
                  </span>
                )}
              </div>
            </div>

            {/* CFD Wind-Tunnel Domain & Freestream Controls */}
            {showCfdControls && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: subtleBg,
                  border: `1px solid ${borderCol}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: primaryFg }}>
                    Wind-Tunnel Computational Domain & Freestream
                  </span>
                  <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#06b6d4" }}>
                    Domain: [{computedBounds.domainMin.map((n) => n.toFixed(2)).join(", ")}] → [
                    {computedBounds.domainMax.map((n) => n.toFixed(2)).join(", ")}] m
                  </span>
                </div>

                {/* Multipliers */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                  {(
                    [
                      { key: "upstreamX" as const, label: "Upstream X (×L)" },
                      { key: "downstreamX" as const, label: "Downstream X (×L)" },
                      { key: "lateralY" as const, label: "Lateral Y (×L)" },
                      { key: "verticalZ" as const, label: "Vertical Z (×L)" },
                    ] as const
                  ).map((field) => (
                    <label
                      key={field.key}
                      style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}
                    >
                      <span style={{ color: mutedFg }}>{field.label}</span>
                      <TextInput
                        size="small"
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={String(domainMultipliers[field.key])}
                        onChange={(e) =>
                          setDomainMultipliers((prev) => ({
                            ...prev,
                            [field.key]: Math.max(0.5, parseNumeric(e.target.value, prev[field.key])),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>

                {/* Flow Conditions */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Freestream Velocity (m/s)</span>
                    <TextInput
                      size="small"
                      type="number"
                      step="1"
                      value={String(freestreamVelocity)}
                      onChange={(e) => setFreestreamVelocity(parseNumeric(e.target.value, freestreamVelocity))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Mach Number</span>
                    <TextInput
                      size="small"
                      type="number"
                      step="0.01"
                      value={String(machNumber)}
                      onChange={(e) => setMachNumber(parseNumeric(e.target.value, machNumber))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Reynolds Number</span>
                    <TextInput
                      size="small"
                      type="number"
                      step="100000"
                      value={String(reynoldsNumber)}
                      onChange={(e) => setReynoldsNumber(parseNumeric(e.target.value, reynoldsNumber))}
                    />
                  </label>
                </div>

                {/* 2:1 Octree Refinement Box Toggle */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingTop: "4px",
                  }}
                >
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "12px",
                      color: primaryFg,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={enableOctreeRefinement}
                      onChange={(e) => setEnableOctreeRefinement(e.target.checked)}
                    />
                    <span>Enable 2:1 Octree Local Wake / Body Refinement Box</span>
                  </label>

                  {enableOctreeRefinement && (
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px" }}>
                      <span style={{ color: mutedFg }}>AMR Levels:</span>
                      <Select
                        size="small"
                        aria-label="AMR Octree Levels"
                        value={String(octreeLevels)}
                        onChange={(e) => setOctreeLevels(parseInt(e.target.value, 10) || 2)}
                      >
                        <Select.Option value="1">1 Level (2×)</Select.Option>
                        <Select.Option value="2">2 Levels (4×)</Select.Option>
                        <Select.Option value="3">3 Levels (8×)</Select.Option>
                        <Select.Option value="4">4 Levels (16×)</Select.Option>
                      </Select>
                    </label>
                  )}
                </div>
              </div>
            )}

            {/* FEA Mesh, Material & Boundary Condition Controls */}
            {showFeaControls && (
              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: "8px",
                  background: subtleBg,
                  border: `1px solid ${borderCol}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: 700, color: primaryFg }}>
                  Structural FEA Mesh, Material & Boundary Conditions
                </span>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Element Order</span>
                    <Select
                      size="small"
                      aria-label="Element Order"
                      value={elementOrder}
                      onChange={(e) => setElementOrder(e.target.value as FeaElementOrder)}
                    >
                      <Select.Option value="Tet4">Tet4 (Linear C3D4)</Select.Option>
                      <Select.Option value="Tet10">Tet10 (Quadratic C3D10)</Select.Option>
                    </Select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Mesh Density</span>
                    <Select
                      size="small"
                      aria-label="Mesh Density"
                      value={meshDensity}
                      onChange={(e) => setMeshDensity(e.target.value as FeaMeshDensity)}
                    >
                      <Select.Option value="Coarse">Coarse</Select.Option>
                      <Select.Option value="Moderate">Moderate</Select.Option>
                      <Select.Option value="Fine">Fine</Select.Option>
                    </Select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Material Preset</span>
                    <Select
                      size="small"
                      aria-label="Material Preset"
                      value={materialPreset}
                      onChange={(e) => setMaterialPreset(e.target.value as FeaMaterialPresetId)}
                    >
                      {(Object.keys(FEA_MATERIALS) as FeaMaterialPresetId[]).map((matKey) => (
                        <Select.Option key={matKey} value={matKey}>
                          {matKey}
                        </Select.Option>
                      ))}
                    </Select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "10px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Fixed Support Face Tag</span>
                    <Select
                      size="small"
                      aria-label="Fixed Face Tag"
                      value={fixedFaceTag}
                      onChange={(e) => setFixedFaceTag(e.target.value)}
                    >
                      {faceOptions.map((tag) => (
                        <Select.Option key={tag} value={tag}>
                          {tag}
                        </Select.Option>
                      ))}
                    </Select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Applied Load Face Tag</span>
                    <Select
                      size="small"
                      aria-label="Load Face Tag"
                      value={loadFaceTag}
                      onChange={(e) => setLoadFaceTag(e.target.value)}
                    >
                      {faceOptions.map((tag) => (
                        <Select.Option key={tag} value={tag}>
                          {tag}
                        </Select.Option>
                      ))}
                    </Select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px" }}>
                    <span style={{ color: mutedFg }}>Applied Load Magnitude (N)</span>
                    <TextInput
                      size="small"
                      type="number"
                      step="100"
                      value={String(loadMagnitudeN)}
                      onChange={(e) => setLoadMagnitudeN(parseNumeric(e.target.value, loadMagnitudeN))}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 3: GENERATE & LAUNCH */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "10px 14px",
                borderRadius: "8px",
                background: subtleBg,
                border: `1px solid ${borderCol}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <FileCodeIcon size={16} />
                <span style={{ fontSize: "13px", fontWeight: 700, color: primaryFg }}>
                  Generated {generatedResult.dialect.toUpperCase()} Study Deck
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "999px",
                    color: generatedResult.dialect === "cfd" ? "#06b6d4" : "#a855f7",
                    border: `1px solid ${generatedResult.dialect === "cfd" ? "#06b6d4" : "#a855f7"}`,
                  }}
                >
                  {activeSpec.solverTag}
                </span>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "11px", color: mutedFg }}>Output File:</span>
                <TextInput
                  size="small"
                  aria-label="Study Deck File Name"
                  placeholder={generatedResult.fileName}
                  value={customFileName}
                  onChange={(e) => setCustomFileName(e.target.value)}
                  style={{ width: "260px", fontFamily: "monospace", fontSize: "12px" }}
                />
              </div>
            </div>

            <pre
              style={{
                margin: 0,
                padding: "12px 14px",
                borderRadius: "8px",
                border: `1px solid ${borderCol}`,
                background: dark ? "#0d1117" : "#f6f8fa",
                color: dark ? "#e6edf3" : "#24292f",
                fontSize: "11px",
                lineHeight: 1.5,
                fontFamily: "monospace",
                maxHeight: "300px",
                overflow: "auto",
                whiteSpace: "pre",
              }}
            >
              {generatedResult.content}
            </pre>

            <div
              style={{
                fontSize: "11px",
                color: mutedFg,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span>
                Preserved <code>{"{{param}}"}</code> template hooks enable one-click parametric sweeps and DOE
                campaigns.
              </span>
              <span style={{ fontFamily: "monospace" }}>{generatedResult.fileName}</span>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
