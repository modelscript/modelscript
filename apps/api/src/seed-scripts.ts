import { LibraryDatabase } from "./database.js";

/**
 * Seeds the dev database with reusable script templates and example job instances.
 *
 * Templates are the "blueprints" — reusable recipes like "Steady-State CFD" or "Modal Analysis FEA".
 * Jobs are concrete executions of those templates with specific inputs and status.
 */
export function seedScriptsAndTemplates(db: LibraryDatabase): void {
  // ── Script Templates ─────────────────────────────────────────────

  db.createScriptTemplate(
    "Steady-State CFD (OpenFOAM)",
    "steady-state-cfd",
    "Runs a steady-state RANS simulation using OpenFOAM's simpleFoam solver. Suitable for external aerodynamics, duct flows, and HVAC analysis. Includes automatic mesh generation with snappyHexMesh and post-processing with ParaView.",
    "CFD",
    "wind",
    {
      solver: "simpleFoam",
      turbulenceModel: "kOmegaSST",
      meshTool: "snappyHexMesh",
      defaultBCs: { inlet: "fixedValue", outlet: "zeroGradient", walls: "noSlip" },
      steps: ["Prepare Geometry", "Generate Mesh", "Set Boundary Conditions", "Run Solver", "Post-Process Results"],
      estimatedDuration: "10–45 min",
      requiredInputs: ["CAD geometry (.step/.stl)", "Inlet velocity (m/s)", "Fluid properties"],
    },
  );

  db.createScriptTemplate(
    "Transient CFD (OpenFOAM)",
    "transient-cfd",
    "Time-dependent incompressible flow simulation using pimpleFoam. Ideal for vortex shedding analysis, oscillating flows, and unsteady wake studies. Supports adaptive time-stepping and function objects for force/moment monitoring.",
    "CFD",
    "clock",
    {
      solver: "pimpleFoam",
      turbulenceModel: "kOmegaSST",
      meshTool: "snappyHexMesh",
      timeScheme: "backward",
      maxCo: 1.0,
      steps: [
        "Prepare Geometry",
        "Generate Mesh",
        "Set Boundary Conditions",
        "Initialize Fields",
        "Run Transient Solver",
        "Extract Time Series",
        "Post-Process",
      ],
      estimatedDuration: "1–8 hrs",
      requiredInputs: ["CAD geometry (.step/.stl)", "Inlet velocity (m/s)", "Time range (s)", "Output interval"],
    },
  );

  db.createScriptTemplate(
    "Conjugate Heat Transfer",
    "conjugate-heat-transfer",
    "Coupled fluid-solid heat transfer simulation using chtMultiRegionFoam. Models heat conduction through solid parts and convective cooling by the surrounding fluid. Used for electronics cooling, heat exchanger design, and thermal management.",
    "CFD",
    "flame",
    {
      solver: "chtMultiRegionFoam",
      regions: ["fluid", "solid"],
      meshTool: "snappyHexMesh",
      steps: [
        "Prepare Multi-Region Geometry",
        "Generate Mesh",
        "Set Thermal BCs",
        "Initialize Temperature",
        "Run CHT Solver",
        "Extract Heat Fluxes",
        "Post-Process",
      ],
      estimatedDuration: "30 min – 4 hrs",
      requiredInputs: [
        "CAD assembly (.step)",
        "Heat source power (W)",
        "Ambient temperature (K)",
        "Material thermal properties",
      ],
    },
  );

  db.createScriptTemplate(
    "Static Structural FEA",
    "static-structural-fea",
    "Linear-elastic static analysis using CalculiX (ccx). Computes displacement, stress (von Mises), and strain under applied loads and boundary conditions. Suitable for bracket analysis, fastener preload studies, and proof-of-concept structural validation.",
    "FEA",
    "shield",
    {
      solver: "CalculiX",
      elementType: "C3D10",
      meshTool: "Gmsh",
      steps: [
        "Prepare Geometry",
        "Generate Mesh",
        "Apply BCs & Loads",
        "Run Solver",
        "Extract Stress/Displacement",
        "Post-Process",
      ],
      estimatedDuration: "5–30 min",
      requiredInputs: ["CAD geometry (.step)", "Material (E, ν, ρ)", "Loads (N or Pa)", "Constraints (fixed/pinned)"],
    },
  );

  db.createScriptTemplate(
    "Modal Analysis FEA",
    "modal-analysis-fea",
    "Natural frequency and mode shape extraction using CalculiX. Identifies resonant modes for vibration avoidance, NVH assessment, and dynamic design validation. Reports eigenfrequencies and animated mode shapes.",
    "FEA",
    "pulse",
    {
      solver: "CalculiX",
      analysisType: "frequency",
      numModes: 10,
      elementType: "C3D10",
      meshTool: "Gmsh",
      steps: [
        "Prepare Geometry",
        "Generate Mesh",
        "Apply Constraints",
        "Run Eigensolver",
        "Extract Mode Shapes",
        "Post-Process",
      ],
      estimatedDuration: "5–20 min",
      requiredInputs: ["CAD geometry (.step)", "Material (E, ν, ρ)", "Constraints"],
    },
  );

  db.createScriptTemplate(
    "Thermal FEA (Steady-State)",
    "thermal-fea-steady",
    "Steady-state thermal conduction analysis using CalculiX. Computes temperature distribution, heat flux, and thermal gradients. Used for electronics thermal management, heat sink design, and thermal compliance checks.",
    "FEA",
    "thermometer",
    {
      solver: "CalculiX",
      analysisType: "heat_transfer",
      elementType: "C3D10",
      meshTool: "Gmsh",
      steps: [
        "Prepare Geometry",
        "Generate Mesh",
        "Apply Thermal BCs",
        "Run Solver",
        "Extract Temperature Field",
        "Post-Process",
      ],
      estimatedDuration: "5–15 min",
      requiredInputs: [
        "CAD geometry (.step)",
        "Material thermal conductivity",
        "Heat sources / sinks",
        "Ambient convection (h, T∞)",
      ],
    },
  );

  db.createScriptTemplate(
    "Nonlinear Contact FEA",
    "nonlinear-contact-fea",
    "Nonlinear static analysis with contact and large deformation using CalculiX. Handles surface-to-surface contact, friction, and geometric nonlinearity. Suitable for bolted joints, interference fits, and compliant mechanism analysis.",
    "FEA",
    "link",
    {
      solver: "CalculiX",
      analysisType: "static_nonlinear",
      contactType: "surface-to-surface",
      elementType: "C3D10",
      meshTool: "Gmsh",
      nlgeom: true,
      steps: [
        "Prepare Geometry",
        "Generate Mesh",
        "Define Contact Pairs",
        "Apply BCs & Loads",
        "Run Nonlinear Solver",
        "Check Convergence",
        "Extract Results",
        "Post-Process",
      ],
      estimatedDuration: "15 min – 2 hrs",
      requiredInputs: [
        "CAD assembly (.step)",
        "Material properties",
        "Contact friction coefficient",
        "Loads & constraints",
      ],
    },
  );

  db.createScriptTemplate(
    "Mesh Sensitivity Study",
    "mesh-sensitivity-study",
    "Automated mesh convergence study. Runs the same analysis at 3–5 mesh refinement levels, extracts peak stress/displacement, and plots convergence curves. Essential for establishing mesh-independent results.",
    "Utility",
    "graph",
    {
      solver: "CalculiX",
      refinementLevels: [0.5, 1.0, 2.0, 4.0],
      metric: "vonMisesStressMax",
      steps: [
        "Prepare Geometry",
        "Generate Coarse Mesh",
        "Solve Coarse",
        "Refine → Medium",
        "Solve Medium",
        "Refine → Fine",
        "Solve Fine",
        "Plot Convergence",
      ],
      estimatedDuration: "20 min – 2 hrs",
      requiredInputs: ["CAD geometry (.step)", "Material properties", "Loads & constraints", "Target quantity"],
    },
  );

  console.log("✅ Seeded script templates!");

  // ── Example Job Runs (completed instances) ───────────────────────
  // These simulate past runs so the UI has data to display

  const now = new Date();
  void now; // used conceptually for the seeded timestamps

  const job1 = db.createJob("Steady-State CFD — Drone Chassis", "SUCCESS", "CFD", "ide", null, {
    templateSlug: "steady-state-cfd",
    geometry: "drone_chassis.step",
    inletVelocity: "15 m/s",
    reynoldsNumber: 125000,
    meshCells: 1_200_000,
    iterations: 2000,
    residuals: { Ux: 1e-5, p: 1e-4 },
  });
  const s1a = db.createJobStep(job1, "Prepare Geometry", "SUCCESS");
  db.updateJobStepStatus(s1a, "SUCCESS");
  const s1b = db.createJobStep(job1, "Generate Mesh (snappyHexMesh)", "SUCCESS");
  db.updateJobStepStatus(s1b, "SUCCESS");
  const s1c = db.createJobStep(job1, "Set Boundary Conditions", "SUCCESS");
  db.updateJobStepStatus(s1c, "SUCCESS");
  const s1d = db.createJobStep(job1, "Run simpleFoam (2000 iters)", "SUCCESS");
  db.updateJobStepStatus(s1d, "SUCCESS");
  const s1e = db.createJobStep(job1, "Post-Process Results", "SUCCESS");
  db.updateJobStepStatus(s1e, "SUCCESS");
  db.updateJobStatus(job1, "SUCCESS");

  const job2 = db.createJob("Static Structural FEA — Mounting Bracket", "SUCCESS", "FEA", "ide", null, {
    templateSlug: "static-structural-fea",
    geometry: "bracket_v3.step",
    material: "Aluminum 6061-T6 (E=68.9 GPa, ν=0.33)",
    loadCase: "500N vertical + 200N lateral",
    meshElements: 84_320,
    peakStress: "142.7 MPa",
    maxDisplacement: "0.23 mm",
  });
  const s2a = db.createJobStep(job2, "Prepare Geometry", "SUCCESS");
  db.updateJobStepStatus(s2a, "SUCCESS");
  const s2b = db.createJobStep(job2, "Generate Mesh (Gmsh C3D10)", "SUCCESS");
  db.updateJobStepStatus(s2b, "SUCCESS");
  const s2c = db.createJobStep(job2, "Apply BCs & Loads", "SUCCESS");
  db.updateJobStepStatus(s2c, "SUCCESS");
  const s2d = db.createJobStep(job2, "Run CalculiX Solver", "SUCCESS");
  db.updateJobStepStatus(s2d, "SUCCESS");
  const s2e = db.createJobStep(job2, "Extract Stress/Displacement", "SUCCESS");
  db.updateJobStepStatus(s2e, "SUCCESS");
  db.updateJobStatus(job2, "SUCCESS");

  const job3 = db.createJob("Modal Analysis — Motor Mount", "SUCCESS", "FEA", "ide", null, {
    templateSlug: "modal-analysis-fea",
    geometry: "motor_mount.step",
    material: "Steel AISI 4140 (E=200 GPa, ν=0.3)",
    modes: 10,
    meshElements: 156_800,
    eigenfrequencies: [124.3, 287.6, 412.1, 589.7, 731.2, 890.4, 1024.8, 1156.3, 1298.7, 1445.2],
  });
  const s3a = db.createJobStep(job3, "Prepare Geometry", "SUCCESS");
  db.updateJobStepStatus(s3a, "SUCCESS");
  const s3b = db.createJobStep(job3, "Generate Mesh", "SUCCESS");
  db.updateJobStepStatus(s3b, "SUCCESS");
  const s3c = db.createJobStep(job3, "Apply Constraints", "SUCCESS");
  db.updateJobStepStatus(s3c, "SUCCESS");
  const s3d = db.createJobStep(job3, "Run Eigensolver (10 modes)", "SUCCESS");
  db.updateJobStepStatus(s3d, "SUCCESS");
  const s3e = db.createJobStep(job3, "Post-Process Mode Shapes", "SUCCESS");
  db.updateJobStepStatus(s3e, "SUCCESS");
  db.updateJobStatus(job3, "SUCCESS");

  const job4 = db.createJob("Transient CFD — Vortex Shedding", "FAILED", "CFD", "manual", null, {
    templateSlug: "transient-cfd",
    geometry: "cylinder_domain.step",
    inletVelocity: "2.5 m/s",
    reynoldsNumber: 200,
    error: "Divergence detected at t=0.42s — CFL number exceeded 10.0",
  });
  const s4a = db.createJobStep(job4, "Prepare Geometry", "SUCCESS");
  db.updateJobStepStatus(s4a, "SUCCESS");
  const s4b = db.createJobStep(job4, "Generate Mesh", "SUCCESS");
  db.updateJobStepStatus(s4b, "SUCCESS");
  const s4c = db.createJobStep(job4, "Initialize Fields", "SUCCESS");
  db.updateJobStepStatus(s4c, "SUCCESS");
  const s4d = db.createJobStep(job4, "Run pimpleFoam", "FAILED");
  db.updateJobStepStatus(s4d, "FAILED");
  db.updateJobStatus(job4, "FAILED");

  const job5 = db.createJob("Conjugate Heat Transfer — PCB Enclosure", "RUNNING", "CFD", "ide", null, {
    templateSlug: "conjugate-heat-transfer",
    geometry: "pcb_enclosure_asm.step",
    heatSource: "12W (IC package)",
    ambientTemp: "298.15 K",
  });
  const s5a = db.createJobStep(job5, "Prepare Multi-Region Geometry", "SUCCESS");
  db.updateJobStepStatus(s5a, "SUCCESS");
  const s5b = db.createJobStep(job5, "Generate Mesh", "SUCCESS");
  db.updateJobStepStatus(s5b, "SUCCESS");
  const s5c = db.createJobStep(job5, "Set Thermal BCs", "SUCCESS");
  db.updateJobStepStatus(s5c, "SUCCESS");
  db.createJobStep(job5, "Run chtMultiRegionFoam", "RUNNING");

  const job6 = db.createJob("Mesh Sensitivity — Lug Joint", "SUCCESS", "Utility", "manual", null, {
    templateSlug: "mesh-sensitivity-study",
    geometry: "lug_joint.step",
    material: "Ti-6Al-4V",
    refinements: 4,
    convergence: [
      { meshSize: "Coarse (12k)", vonMises: "198 MPa" },
      { meshSize: "Medium (48k)", vonMises: "231 MPa" },
      { meshSize: "Fine (192k)", vonMises: "245 MPa" },
      { meshSize: "Very Fine (768k)", vonMises: "247 MPa" },
    ],
  });
  const s6a = db.createJobStep(job6, "Prepare Geometry", "SUCCESS");
  db.updateJobStepStatus(s6a, "SUCCESS");
  const s6b = db.createJobStep(job6, "Solve — Coarse (12k elements)", "SUCCESS");
  db.updateJobStepStatus(s6b, "SUCCESS");
  const s6c = db.createJobStep(job6, "Solve — Medium (48k elements)", "SUCCESS");
  db.updateJobStepStatus(s6c, "SUCCESS");
  const s6d = db.createJobStep(job6, "Solve — Fine (192k elements)", "SUCCESS");
  db.updateJobStepStatus(s6d, "SUCCESS");
  const s6e = db.createJobStep(job6, "Solve — Very Fine (768k elements)", "SUCCESS");
  db.updateJobStepStatus(s6e, "SUCCESS");
  const s6f = db.createJobStep(job6, "Plot Convergence", "SUCCESS");
  db.updateJobStepStatus(s6f, "SUCCESS");
  db.updateJobStatus(job6, "SUCCESS");

  console.log("✅ Seeded example job runs!");
}
