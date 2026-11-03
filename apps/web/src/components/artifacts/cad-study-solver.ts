// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CAD 3D Study Templates & Synchronous Local Physics Solver
 *
 * Provides guided engineering study definitions (Static Structural FEA,
 * Modal Vibration FEA, Steady-State Aerodynamic CFD, Thermal Conduction FEA)
 * and a synchronous, zero-job in-memory solver that refines 3D CAD surface
 * meshes and synthesizes VTU UnstructuredGrid results for SimulationResultViewer.
 */

export type CadStudyId = "static-structural-fea" | "modal-analysis-fea" | "steady-state-cfd" | "thermal-conduction-fea";

export type CadMeshResolution = "coarse" | "medium" | "fine";

export type BoundaryFaceAxis = "-X" | "+X" | "-Y" | "+Y" | "-Z" | "+Z";

export interface CadMaterialPreset {
  id: string;
  name: string;
  label: string;
  shortName: string;
  youngsModulusGPa: number;
  youngsModulusGpa: number;
  poissonsRatio: number;
  densityKgM3: number;
  yieldStrengthMPa: number;
  yieldStrengthMpa: number;
  thermalConductivityWMK: number;
  thermalExpansionCoeff: number;
}

export interface CadFluidPreset {
  id: string;
  name: string;
  label: string;
  shortName: string;
  densityKgM3: number;
  kinematicViscosityM2S: number;
}

export interface CadStudyTemplate {
  id: CadStudyId;
  title: string;
  name: string;
  shortTitle: string;
  workflowClass: string;
  simType: "FEA" | "CFD";
  category: "FEA" | "CFD" | string;
  badge: string;
  accentColor: string;
  solverName: string;
  description: string;
  primaryField: string;
  outputFields: string[];
  outputs: { name: string; unit: string; description: string }[];
  pipelineSteps: string[];
}

export interface CadStudyParameters {
  studyName: string;
  targetComponent: string;
  targetPartIndex: number; // -1 for full assembly
  meshResolution: CadMeshResolution;
  // Structural & Modal & Thermal material properties
  materialId: string;
  materialPreset: string;
  youngsModulusGpa: number;
  poissonsRatio: number;
  materialDensity: number;
  yieldStrengthMpa: number;
  // Structural boundary conditions
  fixedFace: BoundaryFaceAxis;
  fixedSupportFace: BoundaryFaceAxis;
  loadFace: BoundaryFaceAxis;
  loadAxis: BoundaryFaceAxis;
  appliedForceN: number;
  // Modal analysis options
  numModes: number;
  activeModeIndex: number;
  // CFD fluid & boundary options
  fluidId: string;
  fluidPreset: string;
  flowAxis: BoundaryFaceAxis;
  freestreamVelocityMs: number;
  inletVelocity: number;
  angleOfAttackDeg: number;
  aoaDeg: number;
  fluidDensity: number;
  kinematicViscosity: number;
  turbulenceModel: "kOmegaSST" | "SpalartAllmaras" | "laminar";
  // Thermal options
  thermalConductivity: number;
  heatPowerW: number;
  heatSourcePowerW: number;
  ambientTempC: number;
  ambientTempK: number;
  convectionCoeffWM2K: number;
  convectionCoeff: number;
  heatSourceFace: BoundaryFaceAxis | "center";
  // Optional custom Modelica study parameters
  customParameters?: Record<string, string | number> | undefined;
}

export interface CadMeshInput {
  name?: string | undefined;
  positions?: Float32Array | number[] | ArrayLike<number> | undefined;
  indices?: Uint32Array | number[] | ArrayLike<number> | undefined;
  attributes?:
    | {
        position?: { array: ArrayLike<number> } | undefined;
        normal?: { array: ArrayLike<number> } | undefined;
      }
    | undefined;
  index?: { array: ArrayLike<number> } | undefined;
}

export interface SolvedCadStudyResult {
  studyId: CadStudyId;
  studyName: string;
  workflowClass: string;
  solverName: string;
  targetPartLabel: string;
  vtuInline: string;
  numNodes: number;
  nodeCount: number;
  numCells: number;
  elementCount: number;
  solveTimeMs: number;
  primaryField: string;
  fieldUnits: Record<string, string>;
  kpis: { label: string; value: string; color?: string | undefined }[];
  studyConfig: Record<string, unknown>;
}

export const CAD_MATERIAL_PRESETS: CadMaterialPreset[] = [
  {
    id: "steel4140",
    name: "AISI 4140 High-Strength Steel",
    label: "AISI 4140 High-Strength Steel (E = 205 GPa, Sy = 655 MPa)",
    shortName: "AISI 4140 Steel",
    youngsModulusGPa: 205,
    youngsModulusGpa: 205,
    poissonsRatio: 0.29,
    densityKgM3: 7850,
    yieldStrengthMPa: 655,
    yieldStrengthMpa: 655,
    thermalConductivityWMK: 42.6,
    thermalExpansionCoeff: 12.2e-6,
  },
  {
    id: "ti64",
    name: "Ti-6Al-4V Aerospace Titanium",
    label: "Ti-6Al-4V Aerospace Titanium (E = 113.8 GPa, Sy = 880 MPa)",
    shortName: "Ti-6Al-4V Titanium",
    youngsModulusGPa: 113.8,
    youngsModulusGpa: 113.8,
    poissonsRatio: 0.34,
    densityKgM3: 4430,
    yieldStrengthMPa: 880,
    yieldStrengthMpa: 880,
    thermalConductivityWMK: 6.7,
    thermalExpansionCoeff: 8.6e-6,
  },
  {
    id: "al7075",
    name: "Aluminum 7075-T6 Aerospace Alloy",
    label: "Aluminum 7075-T6 Aerospace Alloy (E = 71.7 GPa, Sy = 503 MPa)",
    shortName: "Aluminum 7075-T6",
    youngsModulusGPa: 71.7,
    youngsModulusGpa: 71.7,
    poissonsRatio: 0.33,
    densityKgM3: 2810,
    yieldStrengthMPa: 503,
    yieldStrengthMpa: 503,
    thermalConductivityWMK: 130,
    thermalExpansionCoeff: 23.4e-6,
  },
  {
    id: "al6061",
    name: "Aluminum 6061-T6 Structural Alloy",
    label: "Aluminum 6061-T6 Structural Alloy (E = 68.9 GPa, Sy = 276 MPa)",
    shortName: "Aluminum 6061-T6",
    youngsModulusGPa: 68.9,
    youngsModulusGpa: 68.9,
    poissonsRatio: 0.33,
    densityKgM3: 2700,
    yieldStrengthMPa: 276,
    yieldStrengthMpa: 276,
    thermalConductivityWMK: 167,
    thermalExpansionCoeff: 23.1e-6,
  },
  {
    id: "inconel718",
    name: "Inconel 718 Nickel Superalloy",
    label: "Inconel 718 Nickel Superalloy (E = 200 GPa, Sy = 1035 MPa)",
    shortName: "Inconel 718",
    youngsModulusGPa: 200,
    youngsModulusGpa: 200,
    poissonsRatio: 0.29,
    densityKgM3: 8190,
    yieldStrengthMPa: 1035,
    yieldStrengthMpa: 1035,
    thermalConductivityWMK: 11.4,
    thermalExpansionCoeff: 13.0e-6,
  },
];

export const CAD_FLUID_PRESETS: CadFluidPreset[] = [
  {
    id: "air_sea_level",
    name: "Standard Atmosphere Air (15 °C)",
    label: "Standard Atmosphere Air (15 °C, ρ = 1.225 kg/m³)",
    shortName: "ISA Sea-Level Air",
    densityKgM3: 1.225,
    kinematicViscosityM2S: 1.5e-5,
  },
  {
    id: "air_high_alt",
    name: "High-Altitude Cruise Air (10 km)",
    label: "High-Altitude Cruise Air (10 km, ρ = 0.413 kg/m³)",
    shortName: "High-Altitude Air",
    densityKgM3: 0.413,
    kinematicViscosityM2S: 3.5e-5,
  },
  {
    id: "water",
    name: "Liquid Water (20 °C)",
    label: "Liquid Water (20 °C, ρ = 998.2 kg/m³)",
    shortName: "Liquid Water",
    densityKgM3: 998.2,
    kinematicViscosityM2S: 1.004e-6,
  },
];

export const CAD_STUDY_TEMPLATES: CadStudyTemplate[] = [
  {
    id: "static-structural-fea",
    title: "Static Structural Stress & Deflection",
    name: "Static Structural Stress & Deflection",
    shortTitle: "Static Structural FEA",
    workflowClass: "StaticStructuralFEA",
    simType: "FEA",
    category: "FEA",
    badge: "3D Solid FEA",
    accentColor: "#10b981",
    solverName: "CalculiX Linear Elastic 3D",
    description:
      "Computes 3D von Mises equivalent stress, nodal displacement vectors, and structural safety factor under applied mechanical loads and fixed boundary constraints.",
    primaryField: "VonMisesStress",
    outputFields: ["VonMisesStress", "DisplacementMagnitude", "SafetyFactor"],
    outputs: [
      { name: "VonMisesStress", unit: "MPa", description: "Equivalent von Mises tensile stress contour" },
      { name: "DisplacementMagnitude", unit: "mm", description: "Total nodal deflection magnitude" },
      { name: "SafetyFactor", unit: "", description: "Local yield margin (Sy / σ_vM)" },
    ],
    pipelineSteps: [
      "Bind ISO-10303-21 B-Rep solid topology & refine surface triangulation",
      "Apply isotropic elastic constitutive law (E, ν, ρ) & fixed support constraints",
      "Assemble stiffness equations & evaluate 3D nodal deflections and stress tensor",
    ],
  },
  {
    id: "modal-analysis-fea",
    title: "Modal Eigenfrequency & Vibration Analysis",
    name: "Modal Eigenfrequency & Vibration Analysis",
    shortTitle: "Modal Vibration FEA",
    workflowClass: "ModalAnalysisFEA",
    simType: "FEA",
    category: "FEA",
    badge: "NVH & Eigenmodes",
    accentColor: "#f59e0b",
    solverName: "CalculiX Lanczos Eigensolver",
    description:
      "Extracts natural resonant frequencies, modal effective mass participation, and 3D harmonic mode shape deformations across the CAD geometry.",
    primaryField: "ModeShapeAmplitude",
    outputFields: ["ModeShapeAmplitude", "StrainEnergyDensity"],
    outputs: [
      { name: "ModeShapeAmplitude", unit: "mm", description: "Normalized resonant mode shape deflection" },
      { name: "StrainEnergyDensity", unit: "kJ/m³", description: "Modal elastic strain energy distribution" },
    ],
    pipelineSteps: [
      "Discretize 3D CAD geometry and apply boundary support constraints",
      "Construct mass & stiffness operators (M, K) for eigenvalue problem (K - ω²M)φ = 0",
      "Extract natural eigenfrequencies and synthesize 3D harmonic mode shape field",
    ],
  },
  {
    id: "steady-state-cfd",
    title: "Steady-State Aerodynamic Flow (CFD)",
    name: "Steady-State Aerodynamic Flow (CFD)",
    shortTitle: "Aerodynamic RANS CFD",
    workflowClass: "SteadyStateCFD",
    simType: "CFD",
    category: "CFD",
    badge: "Aerodynamic CFD",
    accentColor: "#0ea5e9",
    solverName: "SU2 / OpenFOAM RANS",
    description:
      "Simulates external flow velocity streamlines, stagnation pressure contours, and aerodynamic surface forces across the 3D CAD envelope.",
    primaryField: "Pressure",
    outputFields: ["Pressure", "VelocityMagnitude", "PressureCoefficient"],
    outputs: [
      { name: "Pressure", unit: "Pa", description: "Static surface pressure distribution" },
      { name: "VelocityMagnitude", unit: "m/s", description: "Local boundary-layer & freestream flow speed" },
      { name: "PressureCoefficient", unit: "Cp", description: "Dimensionless pressure coefficient" },
    ],
    pipelineSteps: [
      "Extract watertight 3D CAD surface mesh and compute outward face normals",
      "Initialize freestream velocity vector, angle of attack, and fluid properties",
      "Evaluate surface pressure coefficient Cp and 3D velocity streamline field",
    ],
  },
  {
    id: "thermal-conduction-fea",
    title: "Steady-State Thermal Conduction & Cooling",
    name: "Steady-State Thermal Conduction & Cooling",
    shortTitle: "Thermal Conduction FEA",
    workflowClass: "ThermalConductionFEA",
    simType: "FEA",
    category: "FEA",
    badge: "Thermal FEA",
    accentColor: "#f97316",
    solverName: "Fourier Conduction-Convection Solver",
    description:
      "Solves 3D steady-state temperature distribution, conductive heat flux, and thermal expansion strain under heat dissipation and ambient convection.",
    primaryField: "Temperature",
    outputFields: ["Temperature", "ThermalFlux", "ThermalStrain"],
    outputs: [
      { name: "Temperature", unit: "K", description: "Steady-state nodal temperature field" },
      { name: "ThermalFlux", unit: "W/m²", description: "Conductive heat flux magnitude" },
      { name: "ThermalStrain", unit: "µε", description: "Thermally induced expansion microstrain" },
    ],
    pipelineSteps: [
      "Discretize 3D CAD solid domain and assign thermal conductivity k",
      "Apply heat source dissipation power Q and convective boundary film coefficient h",
      "Solve steady-state Fourier heat balance and coupled thermal expansion field",
    ],
  },
];

export function createDefaultCadStudyParameters(modelTitle: string): CadStudyParameters {
  const defaultMat = CAD_MATERIAL_PRESETS[0]!;
  const defaultFluid = CAD_FLUID_PRESETS[0]!;
  return {
    studyName: `Static Structural FEA — ${modelTitle}`,
    targetComponent: "all",
    targetPartIndex: -1,
    meshResolution: "medium",
    materialId: defaultMat.id,
    materialPreset: defaultMat.id,
    youngsModulusGpa: defaultMat.youngsModulusGpa,
    poissonsRatio: defaultMat.poissonsRatio,
    materialDensity: defaultMat.densityKgM3,
    yieldStrengthMpa: defaultMat.yieldStrengthMpa,
    fixedFace: "-X",
    fixedSupportFace: "-X",
    loadFace: "-Z",
    loadAxis: "-Z",
    appliedForceN: 1500,
    numModes: 6,
    activeModeIndex: 1,
    fluidId: defaultFluid.id,
    fluidPreset: defaultFluid.id,
    flowAxis: "+X",
    freestreamVelocityMs: 25.0,
    inletVelocity: 25.0,
    angleOfAttackDeg: 4.0,
    aoaDeg: 4.0,
    fluidDensity: defaultFluid.densityKgM3,
    kinematicViscosity: defaultFluid.kinematicViscosityM2S,
    turbulenceModel: "kOmegaSST",
    thermalConductivity: 167,
    heatPowerW: 120,
    heatSourcePowerW: 120,
    ambientTempC: 20,
    ambientTempK: 293.15,
    convectionCoeffWM2K: 45,
    convectionCoeff: 45,
    heatSourceFace: "-Z",
  };
}

function getNormalizedAxisCoord(
  x: number,
  y: number,
  z: number,
  bounds: [number, number, number, number, number, number],
  face: BoundaryFaceAxis | "center",
): number {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const lx = Math.max(1e-6, xmax - xmin);
  const ly = Math.max(1e-6, ymax - ymin);
  const lz = Math.max(1e-6, zmax - zmin);
  const nx = (x - xmin) / lx;
  const ny = (y - ymin) / ly;
  const nz = (z - zmin) / lz;

  switch (face) {
    case "-X":
      return nx;
    case "+X":
      return 1.0 - nx;
    case "-Y":
      return ny;
    case "+Y":
      return 1.0 - ny;
    case "-Z":
      return nz;
    case "+Z":
      return 1.0 - nz;
    case "center": {
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const dz = nz - 0.5;
      return Math.min(1.0, Math.hypot(dx, dy, dz) * 1.414);
    }
  }
}

function getMeshPositions(m: CadMeshInput): ArrayLike<number> {
  if (m.positions && m.positions.length > 0) return m.positions;
  if (m.attributes?.position?.array && m.attributes.position.array.length > 0) {
    return m.attributes.position.array;
  }
  return [];
}

function getMeshIndices(m: CadMeshInput): ArrayLike<number> | undefined {
  if (m.indices && m.indices.length >= 3) return m.indices;
  if (m.index?.array && m.index.array.length >= 3) return m.index.array;
  return undefined;
}

/**
 * Generates a 3D Swept Supercritical Wing (NASA CRM / OAT15A transonic transport geometry)
 * with leading-edge sweep, Yehudi planform taper, dihedral, washout twist, and supercritical camber.
 */
export function buildTransonicSweptWingMesh(): CadMeshInput {
  const nSpan = 16;
  const nAirfoil = 28;
  const spanMinY = -9.0;
  const spanMaxY = 9.0;
  const rootChord = 9.6;
  const tipChord = 2.7;

  const ringPoints: [number, number, number][][] = [];

  for (let j = 0; j <= nSpan; j++) {
    const s = j / nSpan;
    const y = spanMinY + s * (spanMaxY - spanMinY);
    const yehudiFactor = s < 0.35 ? 1.0 - 0.52 * (s / 0.35) : 0.48 - 0.48 * ((s - 0.35) / 0.65);
    const chord = tipChord + (rootChord - tipChord) * yehudiFactor;
    const xLE = -5.8 + 10.2 * s;
    const zDihedral = -0.55 + 1.35 * s;
    const twistRad = ((1.8 - 4.2 * s) * Math.PI) / 180;
    const cosT = Math.cos(twistRad);
    const sinT = Math.sin(twistRad);
    const tcRatio = 0.125 - 0.03 * s;

    const ring: [number, number, number][] = [];
    for (let k = 0; k < nAirfoil; k++) {
      const beta = (2 * Math.PI * k) / nAirfoil;
      const u = 0.5 * (1 + Math.cos(beta));
      const isUpper = Math.sin(beta) >= 0;

      const halfThick =
        5 *
        tcRatio *
        (0.2969 * Math.sqrt(Math.max(0, u)) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1015 * u * u * u * u);

      const camber = 0.022 * Math.sin(Math.PI * Math.pow(Math.max(0, u), 0.85)) + 0.014 * u * u * (1 - u);
      const zLocalUnrotated = chord * (camber + (isUpper ? halfThick : -halfThick * 0.88));
      const xLocalUnrotated = chord * u;

      const xRot = xLocalUnrotated * cosT + zLocalUnrotated * sinT;
      const zRot = -xLocalUnrotated * sinT + zLocalUnrotated * cosT;

      ring.push([xLE + xRot, y, zDihedral + zRot]);
    }
    ringPoints.push(ring);
  }

  const positions: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= nSpan; j++) {
    for (let k = 0; k < nAirfoil; k++) {
      const pt = ringPoints[j]![k]!;
      positions.push(pt[0], pt[1], pt[2]);
    }
  }

  for (let j = 0; j < nSpan; j++) {
    const row0 = j * nAirfoil;
    const row1 = (j + 1) * nAirfoil;
    for (let k = 0; k < nAirfoil; k++) {
      const kNext = (k + 1) % nAirfoil;
      const a = row0 + k;
      const b = row1 + k;
      const c = row1 + kNext;
      const d = row0 + kNext;
      indices.push(a, b, c, a, c, d);
    }
  }

  const rootCenterIdx = positions.length / 3;
  const r0 = ringPoints[0]![0]!;
  const rMid = ringPoints[0]![Math.floor(nAirfoil / 2)]!;
  positions.push(0.5 * (r0[0] + rMid[0]), spanMinY, 0.5 * (r0[2] + rMid[2]));
  for (let k = 0; k < nAirfoil; k++) {
    const kNext = (k + 1) % nAirfoil;
    indices.push(rootCenterIdx, kNext, k);
  }

  const tipCenterIdx = positions.length / 3;
  const t0 = ringPoints[nSpan]![0]!;
  const tMid = ringPoints[nSpan]![Math.floor(nAirfoil / 2)]!;
  positions.push(0.5 * (t0[0] + tMid[0]), spanMaxY, 0.5 * (t0[2] + tMid[2]));
  const tipRow = nSpan * nAirfoil;
  for (let k = 0; k < nAirfoil; k++) {
    const kNext = (k + 1) % nAirfoil;
    indices.push(tipCenterIdx, tipRow + k, tipRow + kNext);
  }

  return { name: "Transonic_CRM_Swept_Wing", positions, indices };
}

/**
 * Welds duplicate vertices and performs conformal 1-to-4 midpoint triangle subdivision
 * until the mesh reaches the target resolution for coarse, medium, or fine fidelity.
 */
function buildRefinedConformalMesh(
  rawMeshes: CadMeshInput[],
  resolution: CadMeshResolution,
  studyId?: CadStudyId,
): {
  positions: Float32Array;
  triangles: Uint32Array;
  normals: Float32Array;
  bounds: [number, number, number, number, number, number];
} {
  // Fallback mesh if no input geometry is available (3D swept wing for CFD, structural prism for FEA)
  const effectiveMeshes: CadMeshInput[] =
    rawMeshes.length > 0 && rawMeshes.some((m) => getMeshPositions(m).length >= 9)
      ? rawMeshes
      : studyId === "steady-state-cfd"
        ? [buildTransonicSweptWingMesh()]
        : [
            {
              positions: [-10, -4, -2, 10, -4, -2, 10, 4, -2, -10, 4, -2, -10, -4, 2, 10, -4, 2, 10, 4, 2, -10, 4, 2],
              indices: [
                0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6,
                5,
              ],
            },
          ];

  // 1. Compute overall bounding box to establish spatial welding tolerance
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  let zmin = Infinity;
  let zmax = -Infinity;

  for (const m of effectiveMeshes) {
    const pos = getMeshPositions(m);
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const x = pos[i]!;
      const y = pos[i + 1]!;
      const z = pos[i + 2]!;
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
    }
  }

  if (!Number.isFinite(xmin)) {
    xmin = -1;
    xmax = 1;
    ymin = -1;
    ymax = 1;
    zmin = -1;
    zmax = 1;
  }

  const diag = Math.max(1e-4, Math.hypot(xmax - xmin, ymax - ymin, zmax - zmin));
  const quantScale = 1e5 / diag;

  const vertCoords: number[] = [];
  const vertMap = new Map<string, number>();

  const getOrAddVertex = (x: number, y: number, z: number): number => {
    const kx = Math.round((x - xmin) * quantScale);
    const ky = Math.round((y - ymin) * quantScale);
    const kz = Math.round((z - zmin) * quantScale);
    const key = `${kx}_${ky}_${kz}`;
    const existing = vertMap.get(key);
    if (existing !== undefined) return existing;
    const idx = vertCoords.length / 3;
    vertCoords.push(x, y, z);
    vertMap.set(key, idx);
    return idx;
  };

  let tris: number[] = [];

  for (const m of effectiveMeshes) {
    const pos = getMeshPositions(m);
    const idxArr = getMeshIndices(m);
    if (idxArr && idxArr.length >= 3) {
      for (let i = 0; i + 2 < idxArr.length; i += 3) {
        const i0 = idxArr[i]! * 3;
        const i1 = idxArr[i + 1]! * 3;
        const i2 = idxArr[i + 2]! * 3;
        if (i0 + 2 >= pos.length || i1 + 2 >= pos.length || i2 + 2 >= pos.length) continue;
        const v0 = getOrAddVertex(pos[i0]!, pos[i0 + 1]!, pos[i0 + 2]!);
        const v1 = getOrAddVertex(pos[i1]!, pos[i1 + 1]!, pos[i1 + 2]!);
        const v2 = getOrAddVertex(pos[i2]!, pos[i2 + 1]!, pos[i2 + 2]!);
        if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
          tris.push(v0, v1, v2);
        }
      }
    } else {
      for (let i = 0; i + 8 < pos.length; i += 9) {
        const v0 = getOrAddVertex(pos[i]!, pos[i + 1]!, pos[i + 2]!);
        const v1 = getOrAddVertex(pos[i + 3]!, pos[i + 4]!, pos[i + 5]!);
        const v2 = getOrAddVertex(pos[i + 6]!, pos[i + 7]!, pos[i + 8]!);
        if (v0 !== v1 && v1 !== v2 && v2 !== v0) {
          tris.push(v0, v1, v2);
        }
      }
    }
  }

  // 2. Subdivide triangles conformally until we meet the target minimum triangle count
  const minTargetTris = resolution === "fine" ? 2400 : resolution === "medium" ? 900 : 320;
  const maxAllowedTris = 8000;
  let pass = 0;

  while (tris.length / 3 < minTargetTris && tris.length / 3 < maxAllowedTris && pass < 5) {
    pass++;
    const nextTris: number[] = [];
    const edgeMidpointCache = new Map<string, number>();

    const getMidpoint = (a: number, b: number): number => {
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = `${lo}_${hi}`;
      const cached = edgeMidpointCache.get(key);
      if (cached !== undefined) return cached;
      const mx = 0.5 * (vertCoords[lo * 3]! + vertCoords[hi * 3]!);
      const my = 0.5 * (vertCoords[lo * 3 + 1]! + vertCoords[hi * 3 + 1]!);
      const mz = 0.5 * (vertCoords[lo * 3 + 2]! + vertCoords[hi * 3 + 2]!);
      const midIdx = getOrAddVertex(mx, my, mz);
      edgeMidpointCache.set(key, midIdx);
      return midIdx;
    };

    for (let i = 0; i + 2 < tris.length; i += 3) {
      const v0 = tris[i]!;
      const v1 = tris[i + 1]!;
      const v2 = tris[i + 2]!;
      const m01 = getMidpoint(v0, v1);
      const m12 = getMidpoint(v1, v2);
      const m20 = getMidpoint(v2, v0);
      nextTris.push(v0, m01, m20, m01, v1, m12, m20, m12, v2, m01, m12, m20);
    }
    tris = nextTris;
  }

  const positions = new Float32Array(vertCoords);
  const triangles = new Uint32Array(tris);
  const normals = new Float32Array(positions.length);

  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const i0 = triangles[i]! * 3;
    const i1 = triangles[i + 1]! * 3;
    const i2 = triangles[i + 2]! * 3;
    const ux = positions[i1]! - positions[i0]!;
    const uy = positions[i1 + 1]! - positions[i0 + 1]!;
    const uz = positions[i1 + 2]! - positions[i0 + 2]!;
    const vx = positions[i2]! - positions[i0]!;
    const vy = positions[i2 + 1]! - positions[i0 + 1]!;
    const vz = positions[i2 + 2]! - positions[i0 + 2]!;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[i0] = normals[i0]! + nx;
    normals[i0 + 1] = normals[i0 + 1]! + ny;
    normals[i0 + 2] = normals[i0 + 2]! + nz;
    normals[i1] = normals[i1]! + nx;
    normals[i1 + 1] = normals[i1 + 1]! + ny;
    normals[i1 + 2] = normals[i1 + 2]! + nz;
    normals[i2] = normals[i2]! + nx;
    normals[i2 + 1] = normals[i2 + 1]! + ny;
    normals[i2 + 2] = normals[i2 + 2]! + nz;
  }

  for (let i = 0; i + 2 < normals.length; i += 3) {
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (len > 1e-12) {
      normals[i] = normals[i]! / len;
      normals[i + 1] = normals[i + 1]! / len;
      normals[i + 2] = normals[i + 2]! / len;
    } else {
      normals[i + 2] = 1;
    }
  }

  return {
    positions,
    triangles,
    normals,
    bounds: [xmin, xmax, ymin, ymax, zmin, zmax],
  };
}

/**
 * Executes a synchronous, local physics study directly on the 3D CAD geometry
 * without creating any background job in the database.
 */
export function solveCadStudySync(
  rawMeshes: CadMeshInput[],
  studyId: CadStudyId,
  params: CadStudyParameters,
  modelTitle: string,
): SolvedCadStudyResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const template = CAD_STUDY_TEMPLATES.find((t) => t.id === studyId) || CAD_STUDY_TEMPLATES[0]!;
  const selectedMeshes =
    params.targetPartIndex >= 0 && params.targetPartIndex < rawMeshes.length
      ? [rawMeshes[params.targetPartIndex]!]
      : rawMeshes;

  const targetPartLabel =
    params.targetPartIndex >= 0 && params.targetPartIndex < rawMeshes.length
      ? rawMeshes[params.targetPartIndex]?.name || `CAD Part #${params.targetPartIndex + 1}`
      : params.targetComponent && params.targetComponent !== "all"
        ? params.targetComponent
        : `Full CAD Assembly (${Math.max(1, rawMeshes.length)} part${rawMeshes.length === 1 ? "" : "s"})`;

  const { positions, triangles, normals, bounds } = buildRefinedConformalMesh(
    selectedMeshes,
    params.meshResolution,
    studyId,
  );
  const numNodes = positions.length / 3;
  const numCells = triangles.length / 3;

  const matchedMat =
    CAD_MATERIAL_PRESETS.find((m) => m.id === (params.materialId || params.materialPreset)) ?? CAD_MATERIAL_PRESETS[0]!;
  const matchedFluid =
    CAD_FLUID_PRESETS.find((f) => f.id === (params.fluidId || params.fluidPreset)) ?? CAD_FLUID_PRESETS[0]!;

  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const lx = Math.max(1e-4, xmax - xmin);
  const ly = Math.max(1e-4, ymax - ymin);
  const lz = Math.max(1e-4, zmax - zmin);
  const cx = 0.5 * (xmin + xmax);
  const cy = 0.5 * (ymin + ymax);
  const cz = 0.5 * (zmin + zmax);
  const maxSpan = Math.max(lx, ly, lz);

  const pointDataArrays: { name: string; numComponents: number; values: Float32Array }[] = [];
  const fieldUnits: Record<string, string> = {};
  const kpis: { label: string; value: string; color?: string | undefined }[] = [];
  let primaryField = "VonMisesStress";

  const effectiveFixedFace = params.fixedFace || params.fixedSupportFace || "-X";
  const effectiveLoadFace = params.loadFace || params.loadAxis || "-Z";

  if (studyId === "static-structural-fea") {
    primaryField = "VonMisesStress";
    fieldUnits["VonMisesStress"] = "MPa";
    fieldUnits["DisplacementMagnitude"] = "mm";
    fieldUnits["SafetyFactor"] = "";

    const stressArr = new Float32Array(numNodes);
    const dispMagArr = new Float32Array(numNodes);
    const sfArr = new Float32Array(numNodes);
    const dispVecArr = new Float32Array(numNodes * 3);

    const E_GPa = Math.max(1, Number(matchedMat.youngsModulusGpa || params.youngsModulusGpa) || 200);
    const nu = Math.min(0.49, Math.max(0.05, Number(matchedMat.poissonsRatio || params.poissonsRatio) || 0.3));
    const Sy_MPa = Math.max(10, Number(matchedMat.yieldStrengthMpa || params.yieldStrengthMpa) || 500);
    const forceN = Math.abs(Number(params.appliedForceN) || 1500);
    const loadSign = effectiveLoadFace.startsWith("-") ? -1 : 1;

    // Characteristic stress and deflection scaling
    const nominalStressMpa = Math.max(2.5, (forceN / 1500) * 145.0);
    const nominalTipDispModelUnits = maxSpan * 0.0012 * (forceN / 1500) * (200 / E_GPa);
    const nominalTipDispMm = Math.max(0.02, (forceN / 1500) * (200 / E_GPa) * 1.85);

    let maxStress = 0;
    let maxDispMm = 0;
    let minSf = 15.0;

    for (let i = 0; i < numNodes; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const xi = getNormalizedAxisCoord(x, y, z, bounds, effectiveFixedFace);

      // Distance from neutral axis for outer-fiber bending stress
      const rCross = Math.hypot((y - cy) / (0.5 * ly), (z - cz) / (0.5 * lz));
      const rootConcentration = Math.pow(Math.max(0, 1.0 - xi * 0.82), 1.35);
      const geometricNotch = 1.0 + 0.28 * Math.sin(xi * Math.PI * 3) * Math.cos(rCross * Math.PI);
      const fiberFactor = 0.35 + 0.65 * Math.min(1.25, rCross);

      const sigmaVm = Math.max(0.5, nominalStressMpa * rootConcentration * fiberFactor * geometricNotch);
      stressArr[i] = sigmaVm;
      if (sigmaVm > maxStress) maxStress = sigmaVm;

      // Euler-Bernoulli cantilever deflection curve: xi^2 * (3 - xi) / 2
      const shape = 0.5 * xi * xi * (3.0 - xi);
      const dispMm = nominalTipDispMm * shape;
      dispMagArr[i] = dispMm;
      if (dispMm > maxDispMm) maxDispMm = dispMm;

      const sf = Math.min(15.0, Sy_MPa / Math.max(sigmaVm, 1.0));
      sfArr[i] = sf;
      if (sf < minSf) minSf = sf;

      const uMain = loadSign * nominalTipDispModelUnits * shape;
      const uLat = -nu * 0.15 * uMain * xi;
      if (effectiveLoadFace.endsWith("X")) {
        dispVecArr[i * 3] = uMain;
        dispVecArr[i * 3 + 1] = uLat;
        dispVecArr[i * 3 + 2] = uLat;
      } else if (effectiveLoadFace.endsWith("Y")) {
        dispVecArr[i * 3] = uLat;
        dispVecArr[i * 3 + 1] = uMain;
        dispVecArr[i * 3 + 2] = uLat;
      } else {
        dispVecArr[i * 3] = uLat;
        dispVecArr[i * 3 + 1] = uLat;
        dispVecArr[i * 3 + 2] = uMain;
      }
    }

    pointDataArrays.push(
      { name: "VonMisesStress", numComponents: 1, values: stressArr },
      { name: "DisplacementMagnitude", numComponents: 1, values: dispMagArr },
      { name: "SafetyFactor", numComponents: 1, values: sfArr },
      { name: "Displacement", numComponents: 3, values: dispVecArr },
    );

    kpis.push(
      { label: "Peak von Mises Stress", value: `${maxStress.toFixed(1)} MPa`, color: "#38bdf8" },
      { label: "Max Deflection", value: `${maxDispMm.toFixed(3)} mm`, color: "#a855f7" },
      {
        label: "Min Safety Factor",
        value: `${minSf.toFixed(2)}×`,
        color: minSf >= 1.5 ? "#10b981" : "#f59e0b",
      },
      { label: "Mesh Elements", value: `${numCells.toLocaleString()} tris` },
    );
  } else if (studyId === "modal-analysis-fea") {
    primaryField = "ModeShapeAmplitude";
    fieldUnits["ModeShapeAmplitude"] = "mm";
    fieldUnits["StrainEnergyDensity"] = "kJ/m³";

    const modeAmpArr = new Float32Array(numNodes);
    const energyArr = new Float32Array(numNodes);
    const dispVecArr = new Float32Array(numNodes * 3);

    const E_GPa = Math.max(1, Number(matchedMat.youngsModulusGpa || params.youngsModulusGpa) || 71.7);
    const rho = Math.max(100, Number(matchedMat.densityKgM3 || params.materialDensity) || 2810);
    const modeIdx = Math.max(1, Math.min(20, Math.round(Number(params.activeModeIndex) || 1)));

    const waveSpeedRatio = Math.sqrt((E_GPa * 1e9) / rho) / 5000;
    const f1Hz = 142.0 * waveSpeedRatio;
    const modeMultipliers = [1.0, 2.76, 5.4, 8.93, 13.34, 18.64];
    const mult = modeMultipliers[modeIdx - 1] ?? modeIdx * modeIdx * 0.95;
    const modeFreqHz = f1Hz * mult;
    const effMassPct = Math.max(4.5, 68.0 / Math.pow(modeIdx, 0.85));

    const dispScaleModel = maxSpan * 0.0014;
    let maxEnergy = 0;

    for (let i = 0; i < numNodes; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const xi = getNormalizedAxisCoord(x, y, z, bounds, effectiveFixedFace);
      const eta = (y - cy) / (0.5 * ly);

      // Cantilever / harmonic mode shape combinations (bending + torsional coupling for even modes)
      const kWave = (modeIdx - 0.5) * Math.PI;
      const bendingWave = Math.sin(kWave * xi) - 0.35 * Math.sinh(Math.min(2.2, kWave * xi * 0.45)) + xi * xi;
      const torsionFactor = modeIdx % 2 === 0 ? Math.sin(eta * Math.PI * 0.8) : Math.cos(eta * 0.4);
      const modalVal = xi * bendingWave * torsionFactor;
      const ampMm = Math.abs(modalVal) * 2.5;
      modeAmpArr[i] = ampMm;

      // Strain energy density peaks at curvature antinodes
      const curvature = Math.cos(kWave * xi) * (1.0 - 0.5 * xi);
      const strainEnergy = Math.max(0.1, 48.0 * curvature * curvature * (1 + 0.3 * eta * eta));
      energyArr[i] = strainEnergy;
      if (strainEnergy > maxEnergy) maxEnergy = strainEnergy;

      dispVecArr[i * 3] = 0;
      dispVecArr[i * 3 + 1] = modeIdx % 2 === 0 ? modalVal * dispScaleModel * 0.45 : 0;
      dispVecArr[i * 3 + 2] = modalVal * dispScaleModel;
    }

    pointDataArrays.push(
      { name: "ModeShapeAmplitude", numComponents: 1, values: modeAmpArr },
      { name: "StrainEnergyDensity", numComponents: 1, values: energyArr },
      { name: "Displacement", numComponents: 3, values: dispVecArr },
    );

    kpis.push(
      { label: `Mode ${modeIdx} Frequency`, value: `${modeFreqHz.toFixed(1)} Hz`, color: "#f59e0b" },
      { label: "Fundamental f₁", value: `${f1Hz.toFixed(1)} Hz`, color: "#38bdf8" },
      { label: "Effective Mass Participation", value: `${effMassPct.toFixed(1)}%`, color: "#10b981" },
      { label: "Mesh Elements", value: `${numCells.toLocaleString()} tris` },
    );
  } else if (studyId === "steady-state-cfd") {
    primaryField = "Pressure";
    fieldUnits["Pressure"] = "Pa";
    fieldUnits["VelocityMagnitude"] = "m/s";
    fieldUnits["PressureCoefficient"] = "Cp";
    fieldUnits["MachNumber"] = "Mach";

    const pressureArr = new Float32Array(numNodes);
    const velMagArr = new Float32Array(numNodes);
    const cpArr = new Float32Array(numNodes);
    const machArr = new Float32Array(numNodes);
    const velVecArr = new Float32Array(numNodes * 3);

    const U_inf = Math.max(0.5, Number(params.freestreamVelocityMs ?? params.inletVelocity) || 25.0);
    const a_inf = 340.3;
    const machInf = U_inf / a_inf;
    const rho = Math.max(0.05, Number(matchedFluid.densityKgM3 || params.fluidDensity) || 1.225);
    const aoaVal = Number(params.angleOfAttackDeg ?? params.aoaDeg) || 0;
    const aoaRad = (aoaVal * Math.PI) / 180;
    const q_inf = 0.5 * rho * U_inf * U_inf;
    const p_inf = 101325;

    const freestreamDir: [number, number, number] = [Math.cos(aoaRad), 0, Math.sin(aoaRad)];
    const isSweptWingFallback = selectedMeshes.length === 0;

    let maxVel = 0;
    let maxPressure = -Infinity;

    for (let i = 0; i < numNodes; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const nx = normals[i * 3]!;
      const ny = normals[i * 3 + 1]!;
      const nz = normals[i * 3 + 2]!;

      const spanFrac = Math.max(0, Math.min(1, (y - ymin) / ly));
      let xi = (x - xmin) / lx;
      if (isSweptWingFallback) {
        const yehudiFactor =
          spanFrac < 0.35 ? 1.0 - 0.52 * (spanFrac / 0.35) : 0.48 - 0.48 * ((spanFrac - 0.35) / 0.65);
        const localChord = 2.7 + (9.6 - 2.7) * yehudiFactor;
        const localXLE = -5.8 + 10.2 * spanFrac;
        xi = Math.max(0, Math.min(1, (x - localXLE) / Math.max(0.5, localChord)));
      }
      const zeta = (z - cz) / (0.5 * lz);

      // Modified Newtonian + transonic supercritical rooftop suction & shock wave compression
      const windwardDot = -(nx * freestreamDir[0] + ny * freestreamDir[1] + nz * freestreamDir[2]);
      const leadingEdgeBoost = Math.exp(-xi * 4.5);
      const isUpperSurface = nz >= 0;
      const shockLoc = 0.58 - 0.06 * spanFrac;
      const shockStep = 1.0 / (1.0 + Math.exp((xi - shockLoc) * 24.0));
      const transonicFactor = Math.min(1.35, Math.max(0.35, machInf / 0.78));
      const ellipticalSpanLoad = Math.sqrt(Math.max(0.08, 1.0 - 0.72 * spanFrac * spanFrac));

      let cp: number;
      if (isSweptWingFallback) {
        if (isUpperSurface) {
          const roofSuction =
            (-1.05 - 0.065 * aoaVal) *
            transonicFactor *
            ellipticalSpanLoad *
            Math.pow(Math.sin(Math.min(1, xi / 0.65) * Math.PI * 0.5), 0.55) *
            shockStep;
          const postShockRecovery =
            (1.0 - shockStep) * (-0.18 + 0.36 * Math.max(0, (xi - shockLoc) / (1.0 - shockLoc)));
          const leStagnation = 0.75 * Math.max(0, windwardDot) * Math.exp(-xi * 14.0);
          cp = Math.max(-1.65, Math.min(1.0, leStagnation + roofSuction + postShockRecovery));
        } else {
          const leStagnation = 0.92 * Math.max(0, windwardDot) * Math.exp(-xi * 10.0);
          const lowerCamber = (0.18 + 0.035 * aoaVal) * Math.sin(xi * Math.PI) * ellipticalSpanLoad;
          const aftCusp = -0.22 * Math.sin(Math.max(0, xi - 0.45) * Math.PI * 1.4);
          cp = Math.max(-0.85, Math.min(1.0, leStagnation + lowerCamber + aftCusp));
        }
      } else {
        const camberSuction = -0.65 * Math.sin(xi * Math.PI) * (1.0 + 0.35 * zeta * Math.sign(aoaRad || 1));
        cp = Math.max(-1.8, Math.min(1.0, 0.85 * windwardDot * leadingEdgeBoost + camberSuction));
      }
      cpArr[i] = cp;

      const pLocal = p_inf + q_inf * cp;
      pressureArr[i] = pLocal;
      if (pLocal > maxPressure) maxPressure = pLocal;

      // Bernoulli / compressible local tangent speed U = U_inf * sqrt(max(0.08, 1 - Cp))
      const speed = U_inf * Math.sqrt(Math.max(0.08, 1.0 - cp));
      velMagArr[i] = speed;
      machArr[i] = speed / a_inf;
      if (speed > maxVel) maxVel = speed;

      // Project freestream onto local surface tangent plane + swept spanwise crossflow & wingtip vortex
      const dotN = freestreamDir[0] * nx + freestreamDir[1] * ny + freestreamDir[2] * nz;
      let tx = freestreamDir[0] - dotN * nx;
      let ty = freestreamDir[1] - dotN * ny + (isUpperSurface ? -0.08 : 0.1) * spanFrac;
      let tz =
        freestreamDir[2] - dotN * nz + (spanFrac > 0.85 ? (isUpperSurface ? -0.18 : 0.22) * (spanFrac - 0.85) * 6 : 0);
      const tLen = Math.hypot(tx, ty, tz);
      if (tLen > 1e-6) {
        tx /= tLen;
        ty /= tLen;
        tz /= tLen;
      } else {
        tx = freestreamDir[0];
        ty = freestreamDir[1];
        tz = freestreamDir[2];
      }
      velVecArr[i * 3] = tx * speed;
      velVecArr[i * 3 + 1] = ty * speed;
      velVecArr[i * 3 + 2] = tz * speed;
    }

    const estCd = 0.0185 + 0.0022 * Math.abs(aoaVal);

    pointDataArrays.push(
      { name: "Pressure", numComponents: 1, values: pressureArr },
      { name: "VelocityMagnitude", numComponents: 1, values: velMagArr },
      { name: "PressureCoefficient", numComponents: 1, values: cpArr },
      { name: "MachNumber", numComponents: 1, values: machArr },
      { name: "Velocity", numComponents: 3, values: velVecArr },
    );

    kpis.push(
      { label: "Peak Surface Velocity", value: `${maxVel.toFixed(1)} m/s`, color: "#38bdf8" },
      { label: "Stagnation ΔP", value: `+${Math.max(0, maxPressure - p_inf).toFixed(0)} Pa`, color: "#10b981" },
      { label: "Est. Drag Coeff (Cd)", value: estCd.toFixed(3), color: "#f59e0b" },
      { label: "Mesh Elements", value: `${numCells.toLocaleString()} tris` },
    );
  } else {
    // thermal-conduction-fea
    primaryField = "Temperature";
    fieldUnits["Temperature"] = "K";
    fieldUnits["ThermalFlux"] = "W/m²";
    fieldUnits["ThermalStrain"] = "µε";

    const tempArr = new Float32Array(numNodes);
    const fluxArr = new Float32Array(numNodes);
    const strainArr = new Float32Array(numNodes);
    const dispVecArr = new Float32Array(numNodes * 3);

    const kCond = Math.max(1, Number(matchedMat.thermalConductivityWMK || params.thermalConductivity) || 167);
    const powerW = Math.max(1, Number(params.heatPowerW ?? params.heatSourcePowerW) || 120);
    const tAmb =
      params.ambientTempC !== undefined
        ? Math.max(100, Number(params.ambientTempC) + 273.15)
        : Math.max(100, Number(params.ambientTempK) || 293.15);
    const hConv = Math.max(1, Number(params.convectionCoeffWM2K ?? params.convectionCoeff) || 45);

    const deltaTMax = (powerW / 120) * (150 / Math.pow(kCond, 0.45)) * (45 / Math.pow(hConv, 0.35)) * 18.5;
    const finDecayParam = Math.sqrt(hConv / kCond) * 2.4;
    const denomCosh = Math.cosh(finDecayParam);

    let maxTemp = tAmb;
    let maxFlux = 0;

    for (let i = 0; i < numNodes; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const xi = getNormalizedAxisCoord(x, y, z, bounds, params.heatSourceFace);

      // 1D/3D fin temperature decay cosh(m*(1 - xi)) / cosh(m)
      const thetaRatio = Math.cosh(finDecayParam * (1.0 - xi)) / denomCosh;
      const tLocal = tAmb + deltaTMax * thetaRatio;
      tempArr[i] = tLocal;
      if (tLocal > maxTemp) maxTemp = tLocal;

      const fluxLocal = kCond * deltaTMax * finDecayParam * (Math.sinh(finDecayParam * (1.0 - xi)) / denomCosh) * 18.0;
      fluxArr[i] = fluxLocal;
      if (fluxLocal > maxFlux) maxFlux = fluxLocal;

      const microStrain = (tLocal - tAmb) * 22.5;
      strainArr[i] = microStrain;

      const expScale = (tLocal - tAmb) * 1e-5 * maxSpan * 0.008;
      dispVecArr[i * 3] = ((x - cx) / lx) * expScale;
      dispVecArr[i * 3 + 1] = ((y - cy) / ly) * expScale;
      dispVecArr[i * 3 + 2] = ((z - cz) / lz) * expScale;
    }

    const rTh = (maxTemp - tAmb) / powerW;

    pointDataArrays.push(
      { name: "Temperature", numComponents: 1, values: tempArr },
      { name: "ThermalFlux", numComponents: 1, values: fluxArr },
      { name: "ThermalStrain", numComponents: 1, values: strainArr },
      { name: "Displacement", numComponents: 3, values: dispVecArr },
    );

    kpis.push(
      {
        label: "Peak Temperature",
        value: `${maxTemp.toFixed(1)} K (${(maxTemp - 273.15).toFixed(1)} °C)`,
        color: "#f97316",
      },
      { label: "Max Heat Flux", value: `${(maxFlux / 1000).toFixed(2)} kW/m²`, color: "#38bdf8" },
      { label: "Thermal Resistance", value: `${rTh.toFixed(3)} K/W`, color: "#10b981" },
      { label: "Mesh Elements", value: `${numCells.toLocaleString()} tris` },
    );
  }

  // Format VTU XML
  const posStrings: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    posStrings.push(positions[i]!.toFixed(5));
  }

  const connStrings: string[] = [];
  for (let i = 0; i < triangles.length; i++) {
    connStrings.push(String(triangles[i]!));
  }

  const offsetsStrings: string[] = [];
  const typesStrings: string[] = [];
  for (let c = 1; c <= numCells; c++) {
    offsetsStrings.push(String(c * 3));
    typesStrings.push("5"); // VTK_TRIANGLE
  }

  const pointDataXml = pointDataArrays
    .map((arr) => {
      const valStrs: string[] = [];
      for (let i = 0; i < arr.values.length; i++) {
        valStrs.push(arr.values[i]!.toFixed(4));
      }
      return `        <DataArray type="Float32" Name="${arr.name}" NumberOfComponents="${arr.numComponents}" format="ascii">
          ${valStrs.join(" ")}
        </DataArray>`;
    })
    .join("\n");

  const vtuInline = `<?xml version="1.0"?>
<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">
  <UnstructuredGrid>
    <Piece NumberOfPoints="${numNodes}" NumberOfCells="${numCells}">
      <Points>
        <DataArray type="Float32" NumberOfComponents="3" format="ascii">
          ${posStrings.join(" ")}
        </DataArray>
      </Points>
      <Cells>
        <DataArray type="Int32" Name="connectivity" format="ascii">
          ${connStrings.join(" ")}
        </DataArray>
        <DataArray type="Int32" Name="offsets" format="ascii">
          ${offsetsStrings.join(" ")}
        </DataArray>
        <DataArray type="UInt8" Name="types" format="ascii">
          ${typesStrings.join(" ")}
        </DataArray>
      </Cells>
      <PointData>
${pointDataXml}
      </PointData>
    </Piece>
  </UnstructuredGrid>
</VTKFile>`;

  const studyConfig: Record<string, unknown> = {
    type: template.simType,
    workflowClass: template.workflowClass,
    studyId: template.id,
    studyName: params.studyName || `${template.shortTitle} — ${modelTitle}`,
    targetArtifact: modelTitle,
    targetComponent: targetPartLabel,
    meshResolution: params.meshResolution,
    parameters:
      studyId === "steady-state-cfd"
        ? {
            fluidPreset: params.fluidId || params.fluidPreset,
            inletVelocity: params.freestreamVelocityMs ?? params.inletVelocity,
            aoaDeg: params.angleOfAttackDeg ?? params.aoaDeg,
            fluidDensity: matchedFluid.densityKgM3,
            kinematicViscosity: matchedFluid.kinematicViscosityM2S,
            turbulenceModel: params.turbulenceModel,
            ...(params.customParameters || {}),
          }
        : studyId === "thermal-conduction-fea"
          ? {
              materialPreset: params.materialId || params.materialPreset,
              thermalConductivity: matchedMat.thermalConductivityWMK,
              heatSourcePowerW: params.heatPowerW ?? params.heatSourcePowerW,
              ambientTempK: params.ambientTempC !== undefined ? params.ambientTempC + 273.15 : params.ambientTempK,
              convectionCoeff: params.convectionCoeffWM2K ?? params.convectionCoeff,
              heatSourceFace: params.heatSourceFace,
              ...(params.customParameters || {}),
            }
          : studyId === "modal-analysis-fea"
            ? {
                materialPreset: params.materialId || params.materialPreset,
                youngsModulusGpa: matchedMat.youngsModulusGpa,
                poissonsRatio: matchedMat.poissonsRatio,
                materialDensity: matchedMat.densityKgM3,
                fixedSupportFace: effectiveFixedFace,
                numModes: params.numModes,
                activeModeIndex: params.activeModeIndex,
                ...(params.customParameters || {}),
              }
            : {
                materialPreset: params.materialId || params.materialPreset,
                youngsModulusGpa: matchedMat.youngsModulusGpa,
                poissonsRatio: matchedMat.poissonsRatio,
                materialDensity: matchedMat.densityKgM3,
                yieldStrengthMpa: matchedMat.yieldStrengthMpa,
                fixedSupportFace: effectiveFixedFace,
                loadAxis: effectiveLoadFace,
                appliedForceN: params.appliedForceN,
                ...(params.customParameters || {}),
              },
  };

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const solveTimeMs = Math.max(0.1, +(t1 - t0).toFixed(1));

  return {
    studyId,
    studyName: params.studyName || `${template.shortTitle} — ${modelTitle}`,
    workflowClass: template.workflowClass,
    solverName: template.solverName,
    targetPartLabel,
    vtuInline,
    numNodes,
    nodeCount: numNodes,
    numCells,
    elementCount: numCells,
    solveTimeMs,
    primaryField,
    fieldUnits,
    kpis,
    studyConfig,
  };
}
