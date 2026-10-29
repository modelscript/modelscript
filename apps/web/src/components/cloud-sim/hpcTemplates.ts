// SPDX-License-Identifier: AGPL-3.0-or-later

export type HpcTemplateDomain = "modelica" | "cfd" | "fea" | "monte-carlo";

export type HpcTemplateCategory =
  | "System Dynamics"
  | "Design & UQ"
  | "Fluid Dynamics (CFD)"
  | "Structural & Thermal FEA"
  | "Verification & V&V";

export interface HpcTemplateFieldOption {
  label: string;
  value: string;
}

export interface HpcTemplateField {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  unit?: string | undefined;
  defaultValue: string | number;
  description?: string | undefined;
  options?: HpcTemplateFieldOption[] | undefined;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
}

export interface HpcFidelityPreset {
  id: "fast" | "balanced" | "high";
  label: string;
  badge: string;
  description: string;
  intervals: number;
  tolerance: string;
  recommendedProfile: string;
  extraOverrides?: Record<string, string | number> | undefined;
}

export interface HpcWizardTemplate {
  id: string;
  dbTemplateId?: number | undefined;
  slug: string;
  name: string;
  shortTitle: string;
  description: string;
  category: HpcTemplateCategory;
  domain: HpcTemplateDomain;
  compatibleDialects: string[];
  solver: string;
  engine: "modelscript" | "omc" | "openfoam" | "su2" | "calculix";
  icon: string;
  accentColor: string;
  badge: string;
  featured?: boolean | undefined;
  recommendedProfile: "standard" | "high-memory" | "gpu-a100" | "hpc-mpi-64";
  estimatedDuration: string;
  estimatedCredits: string;
  pipelineSteps: { title: string; detail: string }[];
  defaultExperiment: {
    startTime: number;
    stopTime: number;
    numberOfIntervals: number;
    tolerance: string;
    solverMethod: string;
  };
  presets: HpcFidelityPreset[];
  fields: HpcTemplateField[];
}

export interface HpcModelArtifactItem {
  id: string;
  artifactId?: number | string | undefined;
  title: string;
  modelName: string;
  dialect: string;
  author?: string | undefined;
  category: string;
  summary: string;
  code: string;
  sourceType: "bound" | "feed" | "benchmark";
}

export interface ExtractedModelParameter {
  name: string;
  type: string;
  defaultValue: number;
  unit?: string | undefined;
  description?: string | undefined;
}

export interface ExtractedExperimentMetadata {
  modelName: string;
  startTime?: number | undefined;
  stopTime?: number | undefined;
  interval?: number | undefined;
  numberOfIntervals?: number | undefined;
  tolerance?: number | undefined;
  parameters: ExtractedModelParameter[];
}

export const BUILTIN_HPC_TEMPLATES: HpcWizardTemplate[] = [
  {
    id: "transient-multiphysics-dae",
    slug: "transient-multiphysics-dae",
    name: "Transient Multiphysics Trajectory (ODE/DAE)",
    shortTitle: "Transient ODE/DAE",
    description:
      "High-accuracy time-domain numerical integration using SUNDIALS CVODE/IDA or OpenModelica DASSL. Ideal for aerospace actuators, power electronics, mechatronics, and ThermoFluid systems.",
    category: "System Dynamics",
    domain: "modelica",
    compatibleDialects: ["modelica", "modelscript", "fmu", "ssp", "pscad", "gensys", "simpack", "scad"],
    solver: "SUNDIALS CVODE / DASSL",
    engine: "modelscript",
    icon: "pulse",
    accentColor: "#06b6d4",
    badge: "Most Popular",
    featured: true,
    recommendedProfile: "standard",
    estimatedDuration: "5–30 sec",
    estimatedCredits: "0.15 cr",
    pipelineSteps: [
      { title: "Flatten & Index DAE", detail: "Lower Modelica CST into linear memory DAE arena & verify balance" },
      { title: "BLT & Alias Elimination", detail: "Block Lower Triangular causalization and tearing optimization" },
      { title: "Allocate Slurm Node", detail: "Provision compute partition with OpenMP multi-threaded runtime" },
      {
        title: "Adaptive Time Integration",
        detail: "Execute variable-step BDF/CVODE solver and stream CSV trajectory",
      },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 500,
      tolerance: "1e-6",
      solverMethod: "cvode",
    },
    presets: [
      {
        id: "fast",
        label: "Fast Draft",
        badge: "~3s",
        description: "Coarse time grid (200 intervals, 1e-4 tol) for rapid sanity checks.",
        intervals: 200,
        tolerance: "1e-4",
        recommendedProfile: "standard",
      },
      {
        id: "balanced",
        label: "Balanced Standard",
        badge: "Recommended",
        description: "Production accuracy (500 intervals, 1e-6 tol) with adaptive step control.",
        intervals: 500,
        tolerance: "1e-6",
        recommendedProfile: "standard",
      },
      {
        id: "high",
        label: "High-Fidelity Stiff",
        badge: "Publication",
        description: "Dense output grid (2500 intervals, 1e-8 tol) for stiff switching transients.",
        intervals: 2500,
        tolerance: "1e-8",
        recommendedProfile: "high-memory",
      },
    ],
    fields: [
      {
        key: "solverMethod",
        label: "Integration Algorithm",
        type: "select",
        defaultValue: "cvode",
        description: "Select numerical integrator for state & algebraic equations",
        options: [
          { label: "SUNDIALS CVODE (Variable-Order BDF — Stiff)", value: "cvode" },
          { label: "DASSL (Differential-Algebraic Petzold)", value: "dassl" },
          { label: "SUNDIALS IDA (Implicit DAE Solver)", value: "ida" },
          { label: "Runge-Kutta 4/5 (Explicit DOPRI5 — Non-Stiff)", value: "rk4" },
        ],
      },
      {
        key: "outputVariablesFilter",
        label: "Output Variable Filter",
        type: "text",
        defaultValue: "all",
        description: "Comma-separated state pattern or 'all' to export full state vector",
      },
    ],
  },
  {
    id: "parametric-sensitivity-sweep",
    slug: "parametric-sensitivity-sweep",
    name: "Parametric Design Sweep (Batched DoE)",
    shortTitle: "Parameter Sweep (DoE)",
    description:
      "Automated Design of Experiments (DoE) sweeping model parameters across parallel cluster workers to map performance envelopes, stability margins, and trade-offs.",
    category: "Design & UQ",
    domain: "modelica",
    compatibleDialects: ["modelica", "modelscript", "fmu", "cfd", "fea"],
    solver: "Batched CVODE Ensemble",
    engine: "modelscript",
    icon: "graph",
    accentColor: "#8b5cf6",
    badge: "Parallel DoE",
    featured: true,
    recommendedProfile: "high-memory",
    estimatedDuration: "15–90 sec",
    estimatedCredits: "0.60 cr",
    pipelineSteps: [
      { title: "Generate DoE Matrix", detail: "Construct full-factorial or Latin Hypercube parameter sample grid" },
      { title: "Compile Base DAE Kernel", detail: "Single compilation shared across all parallel worker threads" },
      { title: "Slurm Array Dispatch", detail: "Execute batched parameter instances concurrently across vCPUs" },
      { title: "Aggregate Envelope", detail: "Merge trajectories and compute sensitivity indices" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 500,
      tolerance: "1e-6",
      solverMethod: "cvode",
    },
    presets: [
      {
        id: "fast",
        label: "5-Point Quick Scan",
        badge: "5 Runs",
        description: "Coarse 5-point linear sweep across ±20% parameter range.",
        intervals: 250,
        tolerance: "1e-5",
        recommendedProfile: "standard",
        extraOverrides: { sweepSteps: 5, variationPct: 20 },
      },
      {
        id: "balanced",
        label: "16-Point Trade Study",
        badge: "Recommended",
        description: "16-point parameter sweep with full trajectory capture.",
        intervals: 500,
        tolerance: "1e-6",
        recommendedProfile: "high-memory",
        extraOverrides: { sweepSteps: 16, variationPct: 25 },
      },
      {
        id: "high",
        label: "64-Point Dense Response Surface",
        badge: "GPU / MPI",
        description: "High-resolution 64-point grid for response surface & surrogate fitting.",
        intervals: 1000,
        tolerance: "1e-7",
        recommendedProfile: "gpu-a100",
        extraOverrides: { sweepSteps: 64, variationPct: 30 },
      },
    ],
    fields: [
      {
        key: "sweepSteps",
        label: "Sweep Sample Points",
        type: "number",
        defaultValue: 16,
        min: 2,
        max: 256,
        description: "Number of parallel simulation instances across the parameter range",
      },
      {
        key: "variationPct",
        label: "Parameter Variation Span",
        type: "number",
        unit: "±%",
        defaultValue: 25,
        min: 1,
        max: 90,
        description: "Percentage perturbation around nominal parameter values",
      },
      {
        key: "samplingMethod",
        label: "Sampling Strategy",
        type: "select",
        defaultValue: "lhs",
        options: [
          { label: "Latin Hypercube Sampling (LHS)", value: "lhs" },
          { label: "Uniform Linear Grid", value: "grid" },
          { label: "Sobol Quasi-Random Sequence", value: "sobol" },
        ],
      },
    ],
  },
  {
    id: "monte-carlo-uq",
    slug: "monte-carlo-uq",
    name: "Monte Carlo Uncertainty Quantification (UQ)",
    shortTitle: "Monte Carlo UQ",
    description:
      "Stochastic ensemble simulation propagating manufacturing tolerances and environmental uncertainties to compute P5/P50/P95 confidence bands and Sobol sensitivity indices.",
    category: "Design & UQ",
    domain: "monte-carlo",
    compatibleDialects: ["modelica", "modelscript", "fmu", "pscad", "gensys"],
    solver: "WebGPU / Slurm Monte Carlo",
    engine: "modelscript",
    icon: "beaker",
    accentColor: "#ec4899",
    badge: "Stochastic UQ",
    featured: true,
    recommendedProfile: "gpu-a100",
    estimatedDuration: "30s – 3 min",
    estimatedCredits: "1.20 cr",
    pipelineSteps: [
      {
        title: "Sample Prior Distributions",
        detail: "Draw Gaussian / Uniform / Weibull realizations via Sobol sequence",
      },
      { title: "Batched Ensemble Execution", detail: "Dispatch vectorized ensemble across GPU / multi-core nodes" },
      { title: "Quantile Aggregation", detail: "Compute mean, standard deviation, and P5/P50/P95 trajectory bands" },
      { title: "Reliability Report", detail: "Export exceedance probabilities and Sobol main-effect indices" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 400,
      tolerance: "1e-5",
      solverMethod: "cvode",
    },
    presets: [
      {
        id: "fast",
        label: "50-Sample Pilot UQ",
        badge: "Fast",
        description: "50 Sobol realizations for rapid variance estimation.",
        intervals: 250,
        tolerance: "1e-5",
        recommendedProfile: "standard",
        extraOverrides: { samples: 50, seed: 42 },
      },
      {
        id: "balanced",
        label: "250-Sample Standard UQ",
        badge: "Recommended",
        description: "250 realizations for converged P5/P95 confidence intervals.",
        intervals: 400,
        tolerance: "1e-6",
        recommendedProfile: "gpu-a100",
        extraOverrides: { samples: 250, seed: 42 },
      },
      {
        id: "high",
        label: "1000-Sample Certification UQ",
        badge: "Six-Sigma",
        description: "1,000 realizations for tail-risk & certification compliance.",
        intervals: 800,
        tolerance: "1e-6",
        recommendedProfile: "gpu-a100",
        extraOverrides: { samples: 1000, seed: 42 },
      },
    ],
    fields: [
      {
        key: "samples",
        label: "Ensemble Sample Count (N)",
        type: "number",
        defaultValue: 250,
        min: 10,
        max: 10000,
        description: "Total Monte Carlo realizations to execute",
      },
      {
        key: "distribution",
        label: "Parameter Uncertainty Distribution",
        type: "select",
        defaultValue: "normal_5pct",
        options: [
          { label: "Gaussian Normal (σ = 5% of nominal)", value: "normal_5pct" },
          { label: "Gaussian Normal (σ = 10% of nominal)", value: "normal_10pct" },
          { label: "Uniform Bounded (±10% interval)", value: "uniform_10pct" },
        ],
      },
      {
        key: "seed",
        label: "PRNG Deterministic Seed",
        type: "number",
        defaultValue: 42,
        description: "Fixed seed for bit-exact reproducible stochastic sampling",
      },
    ],
  },
  {
    id: "steady-state-cfd",
    dbTemplateId: 1,
    slug: "steady-state-cfd",
    name: "Steady-State RANS Aerodynamics (OpenFOAM / SU2)",
    shortTitle: "Steady-State CFD",
    description:
      "Runs a steady-state RANS flow simulation using OpenFOAM simpleFoam or SU2. Suitable for external aerodynamics, duct flows, and HVAC pressure-drop analysis with automated snappyHexMesh generation.",
    category: "Fluid Dynamics (CFD)",
    domain: "cfd",
    compatibleDialects: ["cfd", "step", "cad", "scad", "modelica"],
    solver: "simpleFoam / SU2 RANS",
    engine: "openfoam",
    icon: "wind",
    accentColor: "#0ea5e9",
    badge: "CFD RANS",
    featured: true,
    recommendedProfile: "hpc-mpi-64",
    estimatedDuration: "10–45 min",
    estimatedCredits: "4.50 cr",
    pipelineSteps: [
      { title: "Prepare & Watertight CAD", detail: "Validate surface triangulation and extract boundary patches" },
      { title: "Generate snappyHexMesh", detail: "Octree background mesh with prism boundary layers (y+ < 1)" },
      { title: "Initialize RANS Fields", detail: "Potential flow initialization for velocity, pressure, and k-ω SST" },
      { title: "MPI Parallel simpleFoam", detail: "Execute SIMPLE pressure-velocity coupling to residual convergence" },
      { title: "Extract VTU & Forces", detail: "Compute Cd, Cl, pressure contours, and streamline VTU bundle" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 1000,
      numberOfIntervals: 1000,
      tolerance: "1e-5",
      solverMethod: "simpleFoam",
    },
    presets: [
      {
        id: "fast",
        label: "Coarse Mesh (Draft)",
        badge: "~250k cells",
        description: "Fast aerodynamic trend check (500 iterations, 1e-4 residual).",
        intervals: 500,
        tolerance: "1e-4",
        recommendedProfile: "standard",
        extraOverrides: { meshResolution: "coarse", turbulenceModel: "kOmegaSST" },
      },
      {
        id: "balanced",
        label: "Medium Mesh (Standard)",
        badge: "~1.2M cells",
        description: "Production RANS mesh with 5 boundary prism layers (1000 iterations).",
        intervals: 1000,
        tolerance: "1e-5",
        recommendedProfile: "high-memory",
        extraOverrides: { meshResolution: "medium", turbulenceModel: "kOmegaSST" },
      },
      {
        id: "high",
        label: "Fine Mesh (64-Core MPI)",
        badge: "~4.8M cells",
        description: "High-resolution wake & separation capture over InfiniBand MPI.",
        intervals: 2500,
        tolerance: "1e-6",
        recommendedProfile: "hpc-mpi-64",
        extraOverrides: { meshResolution: "fine", turbulenceModel: "kOmegaSST" },
      },
    ],
    fields: [
      {
        key: "meshResolution",
        label: "Mesh Refinement Level",
        type: "select",
        defaultValue: "medium",
        options: [
          { label: "Coarse (~250k cells — Fast turnaround)", value: "coarse" },
          { label: "Medium (~1.2M cells — Standard engineering)", value: "medium" },
          { label: "Fine (~4.8M cells — High boundary-layer resolution)", value: "fine" },
        ],
      },
      {
        key: "turbulenceModel",
        label: "Turbulence Closure Model",
        type: "select",
        defaultValue: "kOmegaSST",
        options: [
          { label: "k-ω SST (Menter Shear Stress Transport)", value: "kOmegaSST" },
          { label: "Spalart-Allmaras (External Aerospace)", value: "SpalartAllmaras" },
          { label: "Realizable k-ε (Internal & Industrial Flows)", value: "realizableKE" },
        ],
      },
      {
        key: "inletVelocity",
        label: "Freestream / Inlet Velocity",
        type: "number",
        unit: "m/s",
        defaultValue: 25,
        min: 0.01,
        max: 1500,
      },
    ],
  },
  {
    id: "transient-cfd",
    dbTemplateId: 2,
    slug: "transient-cfd",
    name: "Transient Unsteady Wake & Vortex CFD (pimpleFoam)",
    shortTitle: "Transient Wake CFD",
    description:
      "Time-dependent incompressible/compressible flow simulation using pimpleFoam. Ideal for vortex shedding, aeroacoustics, and unsteady wake dynamics with adaptive Courant stepping.",
    category: "Fluid Dynamics (CFD)",
    domain: "cfd",
    compatibleDialects: ["cfd", "step", "cad"],
    solver: "OpenFOAM pimpleFoam",
    engine: "openfoam",
    icon: "clock",
    accentColor: "#38bdf8",
    badge: "URANS / LES",
    recommendedProfile: "hpc-mpi-64",
    estimatedDuration: "1–4 hrs",
    estimatedCredits: "12.0 cr",
    pipelineSteps: [
      { title: "Generate Unsteady Mesh", detail: "Refine wake & shear-layer zones with snappyHexMesh" },
      { title: "Precondition Initial Field", detail: "Initialize from steady RANS solution" },
      { title: "PIMPLE Transient Loop", detail: "Advance unsteady Navier-Stokes with MaxCo <= 1.0" },
      { title: "Export Time-Series VTU", detail: "Bundle transient vorticity and Strouhal frequency spectra" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 2,
      numberOfIntervals: 1000,
      tolerance: "1e-5",
      solverMethod: "pimpleFoam",
    },
    presets: [
      {
        id: "fast",
        label: "Coarse URANS",
        badge: "Fast",
        description: "Coarse transient run with MaxCo = 2.0.",
        intervals: 400,
        tolerance: "1e-4",
        recommendedProfile: "high-memory",
      },
      {
        id: "balanced",
        label: "Standard URANS",
        badge: "Recommended",
        description: "Balanced unsteady vortex shedding capture (MaxCo = 1.0).",
        intervals: 1000,
        tolerance: "1e-5",
        recommendedProfile: "hpc-mpi-64",
      },
      {
        id: "high",
        label: "Fine DDES / LES",
        badge: "64-Rank MPI",
        description: "Scale-resolving Detached Eddy Simulation (MaxCo = 0.5).",
        intervals: 4000,
        tolerance: "1e-6",
        recommendedProfile: "hpc-mpi-64",
      },
    ],
    fields: [
      {
        key: "maxCourant",
        label: "Maximum Courant Number (Co)",
        type: "number",
        defaultValue: 1.0,
        min: 0.1,
        max: 5.0,
        step: 0.1,
      },
      {
        key: "meshResolution",
        label: "Mesh Refinement Level",
        type: "select",
        defaultValue: "medium",
        options: [
          { label: "Coarse", value: "coarse" },
          { label: "Medium", value: "medium" },
          { label: "Fine", value: "fine" },
        ],
      },
    ],
  },
  {
    id: "conjugate-heat-transfer",
    dbTemplateId: 3,
    slug: "conjugate-heat-transfer",
    name: "Conjugate Heat Transfer & Thermal Cooling (CHT)",
    shortTitle: "Conjugate Heat Transfer",
    description:
      "Coupled fluid-solid thermal simulation using chtMultiRegionFoam. Models conduction in solid components and convective cooling in fluid channels for electronics, batteries, and heat exchangers.",
    category: "Fluid Dynamics (CFD)",
    domain: "cfd",
    compatibleDialects: ["cfd", "fea", "step", "cad", "modelica"],
    solver: "chtMultiRegionFoam",
    engine: "openfoam",
    icon: "flame",
    accentColor: "#f97316",
    badge: "Multi-Region Thermal",
    recommendedProfile: "high-memory",
    estimatedDuration: "20–60 min",
    estimatedCredits: "3.20 cr",
    pipelineSteps: [
      { title: "Split Fluid & Solid Regions", detail: "Identify conformal thermal interfaces between domains" },
      { title: "Multi-Region Meshing", detail: "Mesh fluid channels and solid heat sinks simultaneously" },
      { title: "Coupled Energy Solve", detail: "Iterate Navier-Stokes and Fourier heat conduction to equilibrium" },
      { title: "Thermal Hotspot Report", detail: "Extract peak junction temperature and interface heat flux" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 500,
      numberOfIntervals: 500,
      tolerance: "1e-5",
      solverMethod: "chtMultiRegionFoam",
    },
    presets: [
      {
        id: "fast",
        label: "Fast Thermal Check",
        badge: "Coarse",
        description: "Quick steady-state junction temperature estimate.",
        intervals: 300,
        tolerance: "1e-4",
        recommendedProfile: "standard",
      },
      {
        id: "balanced",
        label: "Standard CHT",
        badge: "Recommended",
        description: "Conformal interface mesh with full conjugate coupling.",
        intervals: 500,
        tolerance: "1e-5",
        recommendedProfile: "high-memory",
      },
      {
        id: "high",
        label: "High-Resolution Fin Array",
        badge: "Dense Mesh",
        description: "Fine boundary layers across micro-channel fins.",
        intervals: 1500,
        tolerance: "1e-6",
        recommendedProfile: "hpc-mpi-64",
      },
    ],
    fields: [
      {
        key: "heatSourcePower",
        label: "Total Heat Dissipation",
        type: "number",
        unit: "W",
        defaultValue: 45,
        min: 0,
        max: 100000,
      },
      {
        key: "ambientTempK",
        label: "Coolant Inlet Temperature",
        type: "number",
        unit: "K",
        defaultValue: 298.15,
        min: 100,
        max: 1500,
      },
    ],
  },
  {
    id: "static-structural-fea",
    dbTemplateId: 4,
    slug: "static-structural-fea",
    name: "Static Structural Stress & Deflection FEA (CalculiX)",
    shortTitle: "Static Structural FEA",
    description:
      "3D quadratic tetrahedral (C3D10) finite element analysis using CalculiX. Computes von Mises stress, principal strain, safety factor, and displacement fields under applied mechanical loads.",
    category: "Structural & Thermal FEA",
    domain: "fea",
    compatibleDialects: ["fea", "step", "cad", "scad", "modelica"],
    solver: "CalculiX C3D10",
    engine: "calculix",
    icon: "shield",
    accentColor: "#10b981",
    badge: "3D Solid FEA",
    featured: true,
    recommendedProfile: "high-memory",
    estimatedDuration: "2–15 min",
    estimatedCredits: "0.85 cr",
    pipelineSteps: [
      { title: "Import STEP B-Rep", detail: "Heal CAD topology and identify load/constraint faces" },
      { title: "Gmsh C3D10 Meshing", detail: "Generate second-order 10-node tetrahedral solid mesh" },
      { title: "Assemble Stiffness Matrix", detail: "Apply isotropic/orthotropic material constitutive laws" },
      { title: "Direct Sparse Cholesky Solve", detail: "Solve K·u = F with PaStiX / SPOOLES multi-threaded solver" },
      { title: "Compute Von Mises & Safety Factor", detail: "Export nodal displacements and 3D stress VTU field" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 1,
      numberOfIntervals: 100,
      tolerance: "1e-6",
      solverMethod: "calculix_static",
    },
    presets: [
      {
        id: "fast",
        label: "Coarse Tet10",
        badge: "~25k elems",
        description: "Rapid sizing check with coarse quadratic tets.",
        intervals: 50,
        tolerance: "1e-5",
        recommendedProfile: "standard",
        extraOverrides: { meshResolution: "coarse" },
      },
      {
        id: "balanced",
        label: "Medium Tet10",
        badge: "Recommended",
        description: " ~120k C3D10 elements with local fillet refinement.",
        intervals: 100,
        tolerance: "1e-6",
        recommendedProfile: "high-memory",
        extraOverrides: { meshResolution: "medium" },
      },
      {
        id: "high",
        label: "Stress-Concentration Fine",
        badge: "~500k elems",
        description: "High-density mesh in high-gradient stress regions.",
        intervals: 200,
        tolerance: "1e-7",
        recommendedProfile: "high-memory",
        extraOverrides: { meshResolution: "fine" },
      },
    ],
    fields: [
      {
        key: "materialAlloy",
        label: "Structural Material Preset",
        type: "select",
        defaultValue: "ti64",
        options: [
          { label: "Ti-6Al-4V Aerospace Titanium (E = 113.8 GPa, Sy = 880 MPa)", value: "ti64" },
          { label: "Aluminum 7075-T6 (E = 71.7 GPa, Sy = 503 MPa)", value: "al7075" },
          { label: "Aluminum 6061-T6 (E = 68.9 GPa, Sy = 276 MPa)", value: "al6061" },
          { label: "AISI 4140 High-Strength Steel (E = 205 GPa, Sy = 655 MPa)", value: "steel4140" },
          { label: "Inconel 718 Superalloy (E = 200 GPa, Sy = 1035 MPa)", value: "inconel718" },
        ],
      },
      {
        key: "meshResolution",
        label: "Element Density (C3D10)",
        type: "select",
        defaultValue: "medium",
        options: [
          { label: "Coarse (~25k elements)", value: "coarse" },
          { label: "Medium (~120k elements)", value: "medium" },
          { label: "Fine (~500k elements)", value: "fine" },
        ],
      },
    ],
  },
  {
    id: "modal-analysis-fea",
    dbTemplateId: 5,
    slug: "modal-analysis-fea",
    name: "Modal Eigenfrequency & Vibration Analysis (CalculiX)",
    shortTitle: "Modal Vibration FEA",
    description:
      "Extracts natural frequencies, modal effective mass participation, and 3D resonant mode shapes using CalculiX ARPACK Lanczos eigensolver for NVH and structural dynamics.",
    category: "Structural & Thermal FEA",
    domain: "fea",
    compatibleDialects: ["fea", "step", "cad", "simpack", "modelica"],
    solver: "CalculiX ARPACK Lanczos",
    engine: "calculix",
    icon: "pulse",
    accentColor: "#f59e0b",
    badge: "NVH & Dynamics",
    recommendedProfile: "high-memory",
    estimatedDuration: "3–15 min",
    estimatedCredits: "0.75 cr",
    pipelineSteps: [
      { title: "Generate C3D10 Solid Mesh", detail: "Mesh geometry and apply boundary constraints" },
      {
        title: "Assemble Mass & Stiffness (M, K)",
        detail: "Construct consistent quadratic mass and stiffness matrices",
      },
      { title: "ARPACK Lanczos Eigensolver", detail: "Solve (K - ω²M)φ = 0 for lowest N eigenmodes" },
      { title: "Export Mode Shapes", detail: "Generate eigenfrequency table and deformed VTU mode shapes" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 10,
      tolerance: "1e-6",
      solverMethod: "calculix_modal",
    },
    presets: [
      {
        id: "fast",
        label: "First 6 Modes",
        badge: "Fast",
        description: "Extract primary 6 fundamental modes on coarse mesh.",
        intervals: 6,
        tolerance: "1e-5",
        recommendedProfile: "standard",
        extraOverrides: { numModes: 6 },
      },
      {
        id: "balanced",
        label: "First 12 Modes",
        badge: "Recommended",
        description: "Extract 12 modes with mass participation factors.",
        intervals: 12,
        tolerance: "1e-6",
        recommendedProfile: "high-memory",
        extraOverrides: { numModes: 12 },
      },
      {
        id: "high",
        label: "High-Frequency 30 Modes",
        badge: "NVH",
        description: "Extract 30 eigenmodes on fine mesh for acoustic & harmonic response.",
        intervals: 30,
        tolerance: "1e-7",
        recommendedProfile: "high-memory",
        extraOverrides: { numModes: 30 },
      },
    ],
    fields: [
      {
        key: "numModes",
        label: "Number of Eigenmodes",
        type: "number",
        defaultValue: 12,
        min: 1,
        max: 100,
      },
      {
        key: "freqShiftHz",
        label: "Lower Frequency Cutoff",
        type: "number",
        unit: "Hz",
        defaultValue: 1.0,
        min: 0,
        max: 10000,
      },
    ],
  },
  {
    id: "mesh-sensitivity-study",
    dbTemplateId: 8,
    slug: "mesh-sensitivity-study",
    name: "Automated Grid / Step Convergence & V&V Study",
    shortTitle: "Convergence V&V Study",
    description:
      "Executes a 4-level refinement study (Coarse → Medium → Fine → Reference), computes Richardson extrapolation and Grid Convergence Index (GCI), and certifies discretization independence.",
    category: "Verification & V&V",
    domain: "modelica",
    compatibleDialects: ["modelica", "cfd", "fea", "step", "fmu"],
    solver: "Multi-Fidelity V&V Pipeline",
    engine: "modelscript",
    icon: "shield",
    accentColor: "#14b8a6",
    badge: "ASME V&V 20",
    recommendedProfile: "high-memory",
    estimatedDuration: "10–40 min",
    estimatedCredits: "1.50 cr",
    pipelineSteps: [
      { title: "Level 1 — Coarse Solve", detail: "Execute baseline run at h1 discretization" },
      { title: "Level 2 — Medium Solve", detail: "Refine grid/time-step by factor r = 2.0" },
      { title: "Level 3 — Fine Solve", detail: "Refine grid/time-step by factor r = 4.0" },
      { title: "Richardson Extrapolation", detail: "Calculate observed order of accuracy p and ASME GCI%" },
    ],
    defaultExperiment: {
      startTime: 0,
      stopTime: 10,
      numberOfIntervals: 1000,
      tolerance: "1e-7",
      solverMethod: "cvode",
    },
    presets: [
      {
        id: "fast",
        label: "3-Level Quick V&V",
        badge: "3 Runs",
        description: "Coarse / Medium / Fine convergence check.",
        intervals: 500,
        tolerance: "1e-6",
        recommendedProfile: "standard",
      },
      {
        id: "balanced",
        label: "4-Level ASME V&V 20",
        badge: "Recommended",
        description: "Full 4-level Richardson extrapolation & GCI report.",
        intervals: 1000,
        tolerance: "1e-7",
        recommendedProfile: "high-memory",
      },
      {
        id: "high",
        label: "5-Level Certification",
        badge: "Strict",
        description: "Ultra-fine reference benchmark with L2 norm error bounds.",
        intervals: 4000,
        tolerance: "1e-8",
        recommendedProfile: "gpu-a100",
      },
    ],
    fields: [
      {
        key: "refinementRatio",
        label: "Grid Refinement Ratio (r)",
        type: "select",
        defaultValue: "2.0",
        options: [
          { label: "r = 2.0 (Standard Halving)", value: "2.0" },
          { label: "r = 1.5 (Conservative Refinement)", value: "1.5" },
        ],
      },
    ],
  },
];

export const CURATED_MODEL_ARTIFACTS: HpcModelArtifactItem[] = [
  {
    id: "eha-flight-actuator",
    title: "Electro-Hydrostatic Flight Actuator (EHA)",
    modelName: "ElectroHydrostaticActuator",
    dialect: "modelica",
    author: "@claire_dubois · @elena_vance",
    category: "Aerospace & Flight Control",
    summary:
      "Multi-domain PMSM motor drive, axial piston pump, and compressible hydraulic cylinder under 38 kN aerodynamic hinge load.",
    sourceType: "benchmark",
    code: `model ElectroHydrostaticActuator "Primary Flight Control Surface EHA"
  parameter Real J_motor = 0.0042 "Motor + pump rotor inertia [kg.m2]";
  parameter Real K_t = 1.85 "PMSM torque constant [N.m/A]";
  parameter Real D_pump = 4.5e-6 "Pump displacement [m3/rad]";
  parameter Real A_piston = 0.0028 "Effective cylinder piston area [m2]";
  parameter Real V_chamber = 0.00045 "Hydraulic chamber volume [m3]";
  parameter Real beta_oil = 1.45e9 "Fluid bulk modulus [Pa]";
  parameter Real m_load = 48.0 "Equivalent surface inertia mass [kg]";
  parameter Real d_viscous = 1250.0 "Hydraulic & linkage viscous damping [N.s/m]";
  parameter Real F_hinge = 3800.0 "Aerodynamic hinge load disturbance [N]";
  parameter Real Kp_pos = 42.0 "Outer loop position proportional gain [1/s]";
  parameter Real x_ref = 0.045 "Commanded actuator stroke [m]";

  Real x_pos(start = 0.0, fixed = true) "Actuator piston position [m]";
  Real v_pos(start = 0.0, fixed = true) "Actuator piston velocity [m/s]";
  Real omega_pump(start = 0.0, fixed = true) "Pump angular velocity [rad/s]";
  Real p_diff(start = 0.0, fixed = true) "Differential chamber pressure [Pa]";
  Real i_q "Commanded q-axis motor current [A]";
  Real tau_motor "Electromagnetic motor torque [N.m]";
equation
  i_q = Kp_pos * (x_ref - x_pos) * 18.0 - 0.12 * omega_pump;
  tau_motor = K_t * i_q;
  J_motor * der(omega_pump) = tau_motor - D_pump * p_diff - 0.008 * omega_pump;
  (V_chamber / (2.0 * beta_oil)) * der(p_diff) = D_pump * omega_pump - A_piston * v_pos - 1.2e-11 * p_diff;
  der(x_pos) = v_pos;
  m_load * der(v_pos) = A_piston * p_diff - d_viscous * v_pos - F_hinge * (1.0 - exp(-time / 0.15));

  annotation(experiment(StartTime = 0.0, StopTime = 2.0, Interval = 0.002, Tolerance = 1e-6));
end ElectroHydrostaticActuator;`,
  },
  {
    id: "sic-traction-inverter",
    title: "800V SiC Traction Inverter Electro-Thermal Drive",
    modelName: "SiCTractionInverterThermal",
    dialect: "modelica",
    author: "@claire_dubois",
    category: "Power Electronics & EV",
    summary:
      "Coupled Foster RC thermal network and switching/conduction loss model for a 250 kW automotive SiC MOSFET half-bridge.",
    sourceType: "benchmark",
    code: `model SiCTractionInverterThermal "800V SiC MOSFET Electro-Thermal Model"
  parameter Real V_dc = 800.0 "DC bus voltage [V]";
  parameter Real I_rms = 320.0 "Phase RMS current [A]";
  parameter Real f_sw = 20000.0 "PWM switching frequency [Hz]";
  parameter Real R_ds_on0 = 0.0032 "Nominal on-state resistance at 25C [Ohm]";
  parameter Real alpha_R = 0.0045 "Temperature coefficient of Rds(on) [1/K]";
  parameter Real E_sw_nom = 0.0068 "Switching energy per pulse at nominal V/I [J]";
  parameter Real C_th_j = 1.85 "Junction thermal capacitance [J/K]";
  parameter Real C_th_c = 18.0 "Baseplate thermal capacitance [J/K]";
  parameter Real R_th_jc = 0.085 "Junction-to-case thermal resistance [K/W]";
  parameter Real R_th_ca = 0.14 "Case-to-coolant thermal resistance [K/W]";
  parameter Real T_coolant = 338.15 "Glycol coolant inlet temperature [K]";

  Real T_junction(start = 338.15, fixed = true) "SiC die junction temperature [K]";
  Real T_case(start = 338.15, fixed = true) "Module baseplate temperature [K]";
  Real R_ds_eff "Effective temperature-dependent Rds(on) [Ohm]";
  Real P_cond "Conduction power loss [W]";
  Real P_sw "Switching power loss [W]";
  Real P_total "Total dissipated semiconductor power [W]";
equation
  R_ds_eff = R_ds_on0 * (1.0 + alpha_R * (T_junction - 298.15));
  P_cond = (I_rms * (0.5 + 0.5 * (1.0 - exp(-time / 0.2)))) ^ 2 * R_ds_eff;
  P_sw = f_sw * E_sw_nom * (V_dc / 800.0);
  P_total = P_cond + P_sw;
  C_th_j * der(T_junction) = P_total - (T_junction - T_case) / R_th_jc;
  C_th_c * der(T_case) = (T_junction - T_case) / R_th_jc - (T_case - T_coolant) / R_th_ca;

  annotation(experiment(StartTime = 0.0, StopTime = 5.0, Interval = 0.01, Tolerance = 1e-6));
end SiCTractionInverterThermal;`,
  },
  {
    id: "chua-circuit-chaos",
    title: "Chua's Chaotic Nonlinear Analog Circuit",
    modelName: "ChuaCircuit",
    dialect: "modelica",
    author: "MSL Reference Benchmark",
    category: "Analog Electronics",
    summary: "Classic double-scroll chaotic attractor circuit with piecewise-linear negative resistance Chua diode.",
    sourceType: "benchmark",
    code: `model ChuaCircuit "Chua's Double-Scroll Chaotic Circuit"
  parameter Real G = 0.7 "Conductance [S]";
  parameter Real C1 = 1.0 / 9.0 "Capacitance C1 [F]";
  parameter Real C2 = 1.0 "Capacitance C2 [F]";
  parameter Real L = 1.0 / 7.0 "Inductance L [H]";
  parameter Real m0 = -0.5 "Inner slope of Chua diode [S]";
  parameter Real m1 = -0.8 "Outer slope of Chua diode [S]";
  parameter Real Bp = 1.0 "Breakpoint voltage [V]";

  Real v1(start = 0.15, fixed = true) "Voltage across C1 [V]";
  Real v2(start = 0.0, fixed = true) "Voltage across C2 [V]";
  Real iL(start = 0.0, fixed = true) "Inductor current [A]";
  Real g_v1 "Nonlinear Chua diode current [A]";
equation
  g_v1 = m0 * v1 + 0.5 * (m1 - m0) * (abs(v1 + Bp) - abs(v1 - Bp));
  C1 * der(v1) = G * (v2 - v1) - g_v1;
  C2 * der(v2) = G * (v1 - v2) + iL;
  L * der(iL) = -v2;

  annotation(experiment(StartTime = 0.0, StopTime = 25.0, Interval = 0.025, Tolerance = 1e-6));
end ChuaCircuit;`,
  },
  {
    id: "reusable-booster-tvc",
    title: "Reusable Booster Pitch Attitude & TVC Gimbal Loop",
    modelName: "BoosterAttitudeTVC",
    dialect: "modelica",
    author: "@marcus_chen",
    category: "Aerospace & Propulsion",
    summary:
      "Coupled pitch-axis aerodynamic instability, thrust vector gimbal actuator dynamics, and PD attitude controller during atmospheric descent.",
    sourceType: "benchmark",
    code: `model BoosterAttitudeTVC "Booster Pitch Attitude & TVC Control"
  parameter Real I_yy = 1.85e6 "Booster pitch moment of inertia [kg.m2]";
  parameter Real T_engine = 8.45e5 "Landing burn engine thrust [N]";
  parameter Real l_cg = 18.5 "Gimbal pivot to center-of-gravity moment arm [m]";
  parameter Real M_alpha = 2.4e5 "Aerodynamic destabilizing pitch stiffness [N.m/rad]";
  parameter Real tau_gimbal = 0.035 "TVC actuator time constant [s]";
  parameter Real Kp = 1.65 "Pitch attitude proportional gain";
  parameter Real Kd = 0.85 "Pitch rate derivative gain [s]";
  parameter Real theta_cmd = 0.0 "Target vertical pitch angle [rad]";

  Real theta(start = 0.14, fixed = true) "Pitch attitude angle [rad]";
  Real q_rate(start = 0.0, fixed = true) "Pitch angular rate [rad/s]";
  Real delta_tvc(start = 0.0, fixed = true) "Actual TVC gimbal deflection [rad]";
  Real delta_cmd "Commanded TVC gimbal angle [rad]";
equation
  delta_cmd = Kp * (theta_cmd - theta) - Kd * q_rate;
  tau_gimbal * der(delta_tvc) = delta_cmd - delta_tvc;
  der(theta) = q_rate;
  I_yy * der(q_rate) = T_engine * l_cg * delta_tvc + M_alpha * theta - 4.5e4 * q_rate;

  annotation(experiment(StartTime = 0.0, StopTime = 8.0, Interval = 0.01, Tolerance = 1e-6));
end BoosterAttitudeTVC;`,
  },
];

/**
 * Extracts model name, experiment annotations, and `parameter Real` declarations
 * from Modelica / ModelScript source code so the wizard can pre-populate everything automatically.
 */
export function extractArtifactMetadata(sourceCode: string, fallbackModelName = "Model"): ExtractedExperimentMetadata {
  const result: ExtractedExperimentMetadata = {
    modelName: fallbackModelName,
    parameters: [],
  };

  if (!sourceCode || !sourceCode.trim()) {
    return result;
  }

  // 1. Model / class name
  const modelMatch = sourceCode.match(
    /^\s*(?:within\s+[\w.]+\s*;\s*)?(?:partial\s+)?(?:model|class|block)\s+([A-Za-z_]\w*)/m,
  );
  if (modelMatch?.[1]) {
    result.modelName = modelMatch[1];
  }

  // 2. Experiment annotations
  const startMatch = sourceCode.match(/StartTime\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (startMatch?.[1]) result.startTime = Number(startMatch[1]);

  const stopMatch = sourceCode.match(/StopTime\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (stopMatch?.[1]) result.stopTime = Number(stopMatch[1]);

  const intervalMatch = sourceCode.match(/(?:Interval|StepSize)\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (intervalMatch?.[1]) {
    const iv = Number(intervalMatch[1]);
    if (iv > 0) {
      result.interval = iv;
      const span = (result.stopTime ?? 10) - (result.startTime ?? 0);
      if (span > 0) {
        result.numberOfIntervals = Math.min(20000, Math.max(20, Math.round(span / iv)));
      }
    }
  }

  const numIntervalsMatch = sourceCode.match(/numberOfIntervals\s*=\s*(\d+)/i);
  if (numIntervalsMatch?.[1]) {
    result.numberOfIntervals = Number(numIntervalsMatch[1]);
  }

  const tolMatch = sourceCode.match(/Tolerance\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i);
  if (tolMatch?.[1]) result.tolerance = Number(tolMatch[1]);

  // 3. Extract `parameter Real/Integer name = value "description"`
  const paramRegex =
    /^\s*parameter\s+(Real|Integer)\s+([A-Za-z_]\w*)(?:\s*\([^)]*\))?\s*=\s*([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(?:"([^"]*)")?\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = paramRegex.exec(sourceCode)) !== null) {
    const type = match[1] || "Real";
    const name = match[2] || "";
    const val = Number(match[3]);
    const descRaw = match[4]?.trim();
    if (!name || !Number.isFinite(val)) continue;

    // Extract unit in brackets e.g. "Motor inertia [kg.m2]"
    let unit: string | undefined;
    let description = descRaw;
    if (descRaw) {
      const unitMatch = descRaw.match(/\[([^\]]+)\]\s*$/);
      if (unitMatch?.[1]) {
        unit = unitMatch[1];
        description = descRaw.slice(0, unitMatch.index).trim();
      }
    }

    result.parameters.push({
      name,
      type,
      defaultValue: val,
      unit,
      description,
    });
  }

  return result;
}

/**
 * Generates a preview of the Slurm `#SBATCH` batch script for transparency and reproducibility.
 */
export function generateSbatchPreview(options: {
  jobName: string;
  modelName: string;
  template: HpcWizardTemplate;
  profileId: string;
  cpus: number;
  memoryMb: number;
  gpus?: number | undefined;
  gpuType?: string | undefined;
  partition: string;
  startTime: number;
  stopTime: number;
  numberOfIntervals: number;
  tolerance: string;
  parameterOverrides: Record<string, number>;
}): string {
  const safeName = options.modelName.replace(/[^A-Za-z0-9_]/g, "_") || "Model";
  const memGb = Math.max(1, Math.round(options.memoryMb / 1024));
  const overridePairs = Object.entries(options.parameterOverrides)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

  const gresLine =
    options.gpus && options.gpus > 0 ? `#SBATCH --gres=gpu:${options.gpuType || "a100"}:${options.gpus}\n` : "";

  let solverCmd = `msx simulate ${safeName}.mo \\\n  --start-time=${options.startTime} \\\n  --stop-time=${options.stopTime} \\\n  --intervals=${options.numberOfIntervals} \\\n  --tolerance=${options.tolerance} \\\n  --solver=${options.template.defaultExperiment.solverMethod}`;
  if (overridePairs) {
    solverCmd += ` \\\n  --override="${overridePairs}"`;
  }
  if (options.template.domain === "cfd") {
    solverCmd = `mpirun -np ${options.cpus} simpleFoam -parallel > simulate.log 2>&1`;
  } else if (options.template.domain === "fea") {
    solverCmd = `OMP_NUM_THREADS=${options.cpus} ccx -i ${safeName} > simulate.log 2>&1`;
  }

  return `#!/bin/bash
#SBATCH --job-name=msx_${safeName.toLowerCase()}
#SBATCH --partition=${options.partition || "compute"}
#SBATCH --nodes=1
#SBATCH --cpus-per-task=${options.cpus}
#SBATCH --mem=${memGb}G
${gresLine}#SBATCH --time=00:30:00
#SBATCH --output=slurm-%j.out
#SBATCH --error=slurm-%j.err

export OMP_NUM_THREADS=${options.cpus}
echo "[ModelScript HPC] Starting template '${options.template.name}' on $(hostname)"
${solverCmd}
`;
}
