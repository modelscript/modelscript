// SPDX-License-Identifier: AGPL-3.0-or-later

export type SpaceDomainPresetId =
  | "systems_general"
  | "oil_gas_process"
  | "power_rf_grid"
  | "automotive_robotics"
  | "aerospace_cad"
  | "pharma_chem_bio"
  | "med_radiology"
  | "fabless_electronics";

export interface SpacePresetChannelSpec {
  slug: string;
  name: string;
  topic: string;
  kind: "text" | "announcement" | "bot_feed" | "telemetry" | "ecr_review";
}

export interface SpacePresetDocSpec {
  slug: string;
  title: string;
  summary: string;
  pathInGit: string;
  contentMarkdown: string;
}

export interface SpaceDomainPreset {
  id: SpaceDomainPresetId;
  name: string;
  shortLabel: string;
  icon: string;
  accentColor: string;
  description: string;
  replacesTools: string[];
  complianceStandards: string[];
  languages: string[];
  enabledTabs: string[];
  defaultChannels: SpacePresetChannelSpec[];
  starterDocs: SpacePresetDocSpec[];
  sampleCodeSnippet: {
    language: string;
    title: string;
    code: string;
  };
}

export const SPACE_DOMAIN_PRESETS: Record<SpaceDomainPresetId, SpaceDomainPreset> = {
  systems_general: {
    id: "systems_general",
    name: "Core Systems Engineering & Multiphysics",
    shortLabel: "Systems & DAE",
    icon: "cpu",
    accentColor: "#3b82f6",
    description:
      "Unified MBSE, acausal Modelica DAE simulation, SysML v2 architecture, ReqIF requirements traceability, and FMI co-simulation.",
    replacesTools: ["Confluence", "MagicDraw / Cameo", "Teamcenter", "SharePoint", "Slack"],
    complianceStandards: ["ISO 15288", "OMG SysML v2", "FMI 2.0/3.0", "NIST OSCAL"],
    languages: ["modelica", "modelscript", "sysml2", "ssp", "reqif", "oscal", "owl2", "csv"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "announcements",
        name: "announcements",
        topic: "Official milestone releases, baseline tags, and architecture sign-offs",
        kind: "announcement",
      },
      {
        slug: "general",
        name: "general",
        topic: "Cross-disciplinary systems engineering discussion and executable snippets",
        kind: "text",
      },
      {
        slug: "architecture-reviews",
        name: "architecture-reviews",
        topic: "SysML v2 allocation reviews, ReqIF traceability, and Engineering Change Orders (ECOs)",
        kind: "ecr_review",
      },
      {
        slug: "ci-benchmarks",
        name: "ci-benchmarks",
        topic: "Automated Modelica DAE flattening and trajectory regression results",
        kind: "bot_feed",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "System Architecture & Living Specification",
        summary: "Executable systems engineering overview linking requirements, architecture, and DAE models.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# System Architecture & Living Specification

Welcome to this **Ansatz Engineering Space**. Unlike static wikis (SharePoint/Confluence), this document is backed directly by the Space's Git Vault and executes live multiphysics models in WebAssembly linear memory.

## 1. Governing Dynamics
Below is the baseline harmonic oscillator / thermal-electrical state model verified on every commit:

\`\`\`modelica
model SystemBaseline
  parameter Real k = 45.0 "Stiffness (N/m)";
  parameter Real c = 1.8 "Damping coefficient (N.s/m)";
  Real x(start = 1.0) "Displacement (m)";
  Real v(start = 0.0) "Velocity (m/s)";
equation
  der(x) = v;
  der(v) = -k * x - c * v;
end SystemBaseline;
\`\`\`

## 2. Digital Thread & Verification Matrix
- **Requirements**: Linked via \`ReqIF\` in the **PLM & Thread** tab.
- **Change Control**: All parameter updates require an approved **Engineering Change Order (ECO)** with passing simulation gates.
`,
      },
      {
        slug: "dvpr-verification",
        title: "Design Verification Plan & Report (DVP&R)",
        summary: "Continuous simulation verification baselines and tolerance gates.",
        pathInGit: "docs/dvpr-verification.md",
        contentMarkdown: `# Design Verification Plan & Report (DVP&R)

| Requirement ID | Target Model | Metric | Threshold | Status |
| :--- | :--- | :--- | :--- | :--- |
| \`REQ-SYS-001\` | \`SystemBaseline\` | Settling Time | $< 4.5\\text{ s}$ | ✅ Passing |
| \`REQ-SYS-002\` | \`SystemBaseline\` | Peak Overshoot | $< 15\\%$ | ✅ Passing |
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "Damped Resonator Step Response",
      code: `model Resonator
  parameter Real wn = 12.0;
  parameter Real zeta = 0.15;
  Real x(start = 0.0), v(start = 0.0);
equation
  der(x) = v;
  der(v) = -2 * zeta * wn * v - wn^2 * (x - 1.0);
end Resonator;`,
    },
  },

  oil_gas_process: {
    id: "oil_gas_process",
    name: "Oil, Gas, Process, Subsurface & Civil Water",
    shortLabel: "Oil, Gas & Process",
    icon: "flame",
    accentColor: "#f59e0b",
    description:
      "Multiphase pipeline transient flow (OLGA/LPS), process flowsheets (Aspen), reservoir simulation (ECLIPSE), thermal-hydraulics (RELAP5), and SCADA digital twins.",
    replacesTools: ["AVEVA PI Portals", "Documentum", "Petrel Shared Drives", "SharePoint", "Aspen Basic Manager"],
    complianceStandards: ["API RP 1173", "IEC 61511 (SIL / HAZOP)", "ASME B31.4 / B31.8", "ISO 14224"],
    languages: ["olga", "lps", "aspen", "eclipse", "epanet", "swmm", "relap5", "energyplus", "modelica"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Field operations, flow assurance engineering, and process optimization",
        kind: "text",
      },
      {
        slug: "flow-assurance",
        name: "flow-assurance",
        topic: "OLGA/LPS transient slugging, hydrate formation, wax deposition, and blowdown studies",
        kind: "ecr_review",
      },
      {
        slug: "hazop-safety",
        name: "hazop-safety",
        topic: "HAZOP / LOPA safety reviews, relief valve sizing, and Management of Change (MOC)",
        kind: "ecr_review",
      },
      {
        slug: "scada-twin-alerts",
        name: "scada-twin-alerts",
        topic: "Real-time wellhead pressure/temperature telemetry anomalies and pigging schedules",
        kind: "telemetry",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Flow Assurance & Process Basis of Design",
        summary: "Subsea tieback hydraulic profile, multiphase transient envelope, and operating philosophy.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Flow Assurance & Process Basis of Design

## 1. Subsea Tieback & Pipeline Envelope
This Space manages the transient multiphase models (\`.opi\`, \`.lps\`), reservoir decks (\`.data\`), and chemical process flowsheets (\`.aspen\`) under strict **Management of Change (MOC)** version control.

\`\`\`modelica
model SubseaChokeTransient
  parameter Real Cv = 185.0 "Valve flow coefficient";
  parameter Real P_wellhead = 245.0 "Upstream wellhead pressure (bar)";
  parameter Real P_separator = 65.0 "Topside separator pressure (bar)";
  Real opening(start = 0.2) "Choke opening fraction";
  Real q_mass "Mass flow rate (kg/s)";
equation
  der(opening) = (0.85 - opening) / 1.5;
  q_mass = Cv * opening * sqrt(max(0.0, P_wellhead - P_separator));
end SubseaChokeTransient;
\`\`\`

## 2. Operating Limits & Hydrate Margin
- **Minimum Arrival Temperature**: $> 28.5\\ ^\\circ\\text{C}$ (MEG injection active below $32\\ ^\\circ\\text{C}$).
- **Maximum Allowable Operating Pressure (MAOP)**: $310\\text{ bar}$.
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "Pipeline Pressure Surge & Choke Ramp",
      code: `model PipelineSurge
  parameter Real L = 12000.0 "Pipeline length (m)";
  Real P_in(start = 180.0), flow(start = 42.0);
equation
  der(P_in) = (45.0 - flow) * 0.85;
  der(flow) = (P_in - 165.0) / 12.0 - 0.08 * flow;
end PipelineSurge;`,
    },
  },

  power_rf_grid: {
    id: "power_rf_grid",
    name: "Electrical Power Grids, EMT, RF & Electronics",
    shortLabel: "Power Grids & RF",
    icon: "zap",
    accentColor: "#10b981",
    description:
      "Electromagnetic transients (PSCAD), transmission power flow (PSS/E, CGMES), distribution grids (OpenDSS), analog/RF circuits (SPICE, Verilog-A, Touchstone, IBIS).",
    replacesTools: ["PSS/E Vaults", "PSCAD Zip Shares", "Altium 365", "SharePoint Grid Compliance Portals"],
    complianceStandards: ["NERC CIP", "NERC PRC-024", "IEEE 1547 / IEEE 2800", "ENTSO-E CGMES v3.0"],
    languages: ["pscad", "psse", "cgmes", "opendss", "spice", "verilog-a", "ibis", "touchstone", "modelica"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Transmission/distribution planning, inverter-based resources (IBR), and RF/analog design",
        kind: "text",
      },
      {
        slug: "grid-interconnection",
        name: "grid-interconnection",
        topic: "IEEE 2800 / NERC ride-through studies, SSR analysis, and PSCAD/PSS/E model sign-offs",
        kind: "ecr_review",
      },
      {
        slug: "signal-integrity-rf",
        name: "signal-integrity-rf",
        topic: "SPICE netlists, Touchstone S-parameters (.s2p/.s4p), IBIS buffers, and EMI/EMC reviews",
        kind: "text",
      },
      {
        slug: "contingency-ci",
        name: "contingency-ci",
        topic: "Automated N-1 contingency screening and EMT fault-ride-through regression bot",
        kind: "bot_feed",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Grid Interconnection & EMT Model Quality Manual",
        summary: "IEEE 2800 fault ride-through verification, CGMES topology exchange, and SPICE/RF characterization.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Grid Interconnection & EMT Model Quality Manual

## 1. Inverter-Based Resource (IBR) Plant Model
All \`PSCAD\`, \`PSS/E\`, \`OpenDSS\`, and \`Modelica\` grid models in this Space are automatically benchmarked for Low/High Voltage Ride-Through (LVRT/HVRT) and frequency droop response.

\`\`\`modelica
model GridFormingInverterDroop
  parameter Real f_nom = 60.0 "Nominal grid frequency (Hz)";
  parameter Real m_p = 0.05 "Active power droop gain";
  Real P_out(start = 0.5) "Normalized active power (p.u.)";
  Real f_pll(start = 60.0) "Measured bus frequency (Hz)";
equation
  der(f_pll) = (59.85 - f_pll) / 0.04;
  der(P_out) = ((0.5 + (f_nom - f_pll) / (f_nom * m_p)) - P_out) / 0.08;
end GridFormingInverterDroop;
\`\`\`
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "RLC Converter Filter Transient",
      code: `model BuckFilter
  parameter Real L = 2.5e-3, C = 470e-6, R = 4.0;
  Real i_L(start = 0.0), v_C(start = 0.0);
equation
  der(i_L) = (24.0 - v_C) / L;
  der(v_C) = (i_L - v_C / R) / C;
end BuckFilter;`,
    },
  },

  automotive_robotics: {
    id: "automotive_robotics",
    name: "Automotive, Multibody, Robotics, Marine & Rail",
    shortLabel: "Automotive & Robotics",
    icon: "truck",
    accentColor: "#ef4444",
    description:
      "Vehicle dynamics & multibody kinematics (ADAMS, Simpack, Gensys), powertrain (GT-SUITE), robotics (URDF), ADAS scenarios (OpenDRIVE, OpenSCENARIO), and AUTOSAR.",
    replacesTools: ["Siemens Teamcenter", "PTC Windchill", "Vector vMDM", "Foxglove / ROS Bags"],
    complianceStandards: ["ISO 26262 (ASIL A–D)", "ISO 21448 (SOTIF)", "AUTOSAR R22-11", "EN 14363 (Rail)"],
    languages: [
      "autosar",
      "urdf",
      "opendrive",
      "openscenario",
      "adams",
      "simpack",
      "gensys",
      "gtsuite",
      "sima",
      "modelica",
    ],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Vehicle platform engineering, robotics kinematics, and powertrain thermal management",
        kind: "text",
      },
      {
        slug: "chassis-kinematics",
        name: "chassis-kinematics",
        topic: "ADAMS/Simpack suspension K&C sweeps, URDF joint limits, and wheel-rail contact",
        kind: "ecr_review",
      },
      {
        slug: "adas-functional-safety",
        name: "adas-functional-safety",
        topic: "OpenDRIVE / OpenSCENARIO corner cases and ISO 26262 ASIL requirements sign-off",
        kind: "ecr_review",
      },
      {
        slug: "iso26262-trace-bot",
        name: "iso26262-trace-bot",
        topic: "Automated Hardware-in-the-Loop (HiL) and MIL/SIL scenario verification feed",
        kind: "bot_feed",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Vehicle & Robotic Platform Architecture",
        summary: "Quarter-car suspension dynamics, battery pack thermal loop, and ISO 26262 safety goals.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Vehicle & Robotic Platform Architecture

## 1. Active Suspension & Chassis Dynamics
This Space coordinates multibody assemblies (\`.urdf\`, \`.adm\`, \`.spck\`), E/E architecture (\`.arxml\`), and ADAS scenarios (\`.xodr\`, \`.xosc\`).

\`\`\`modelica
model QuarterCarSuspension
  parameter Real m_sprung = 380.0 "Sprung quarter-body mass (kg)";
  parameter Real k_spring = 28000.0 "Suspension spring rate (N/m)";
  parameter Real c_damper = 2400.0 "Damper coefficient (N.s/m)";
  Real z_body(start = 0.05) "Chassis vertical displacement (m)";
  Real v_body(start = 0.0) "Chassis vertical velocity (m/s)";
equation
  der(z_body) = v_body;
  m_sprung * der(v_body) = -k_spring * z_body - c_damper * v_body;
end QuarterCarSuspension;
\`\`\`
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "EV Battery Cell Thermal Runaway Margin",
      code: `model BatteryCellThermal
  parameter Real C_th = 950.0 "Heat capacity (J/K)";
  parameter Real R_int = 0.018 "Internal resistance (Ohm)";
  parameter Real I_load = 120.0 "Discharge current (A)";
  Real T_cell(start = 298.15) "Cell temperature (K)";
equation
  C_th * der(T_cell) = I_load^2 * R_int - 14.5 * (T_cell - 298.15);
end BatteryCellThermal;`,
    },
  },

  aerospace_cad: {
    id: "aerospace_cad",
    name: "3D CAD, Aerospace, Digital Metrology & Continuum Physics",
    shortLabel: "3D CAD & Aerospace",
    icon: "rocket",
    accentColor: "#8b5cf6",
    description:
      "Git-native 3D CAD PDM (STEP, OpenSCAD, USD, QIF metrology), FEA/CFD continuum solvers, flight dynamics (JSBSim, CCSDS), and rocket propulsion (ROCETS).",
    replacesTools: ["SolidWorks PDM", "Dassault 3DEXPERIENCE", "Autodesk Vault", "GrabCAD", "Ansys Minerva"],
    complianceStandards: ["AS9100 Rev D", "ISO 10303-242 (STEP AP242)", "ISO 23952 (QIF 3.0)", "NASA-STD-7009"],
    languages: [
      "step",
      "qif",
      "scad",
      "usd",
      "fea",
      "cfd",
      "simulink",
      "easy5",
      "jsbsim",
      "rocets",
      "ccsds",
      "plcopen",
      "automationml",
    ],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Mechanical CAD assemblies, propulsion cycles, and GNC flight dynamics",
        kind: "text",
      },
      {
        slug: "cad-assemblies-pdm",
        name: "cad-assemblies-pdm",
        topic: "STEP AP242 / OpenSCAD visual 3D diffs, mass budgets, and QIF GD&T tolerances",
        kind: "ecr_review",
      },
      {
        slug: "aero-cfd-fea",
        name: "aero-cfd-fea",
        topic: "SU2 aerodynamic polars, CalculiX structural stress concentrations, and modal vibration",
        kind: "text",
      },
      {
        slug: "clash-and-mass-bot",
        name: "clash-and-mass-bot",
        topic: "Automated 3D bounding-box interference checks and dry-mass budget tracking",
        kind: "bot_feed",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Mechanical PDM, Mass Budget & Flight Envelope",
        summary: "Git-native 3D CAD assembly control, QIF GD&T inspection criteria, and propulsion performance.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Mechanical PDM, Mass Budget & Flight Envelope

## 1. Git-Native 3D CAD & Continuum Physics
Every \`.step\`, \`.scad\`, \`.qif\`, \`.inp\` (FEA), and \`.cfg\` (CFD) commit in this Space is indexed for 3D visual diffing and mass property verification.

\`\`\`modelica
model PitchAttitudeControl
  parameter Real J_yy = 420.0 "Pitch moment of inertia (kg.m2)";
  parameter Real kp = 1800.0, kd = 650.0;
  Real theta(start = 0.0) "Pitch angle (rad)";
  Real q(start = 0.0) "Pitch rate (rad/s)";
equation
  der(theta) = q;
  J_yy * der(q) = kp * (0.15 - theta) - kd * q;
end PitchAttitudeControl;
\`\`\`
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "Pitch Attitude Autopilot Step",
      code: `model PitchLoop
  Real theta(start = 0.0), q(start = 0.0);
equation
  der(theta) = q;
  der(q) = 18.0 * (0.2 - theta) - 4.2 * q;
end PitchLoop;`,
    },
  },

  pharma_chem_bio: {
    id: "pharma_chem_bio",
    name: "Chemistry, Systems Biology, PK/PD & Pharma",
    shortLabel: "Pharma & Bio",
    icon: "beaker",
    accentColor: "#ec4899",
    description:
      "Electronic Lab Notebook (ELN) & model registry for SBML/Antimony pathways, Cantera kinetics, SMILES molecules, NMTRAN PK/PD, SBOL, and PDB structures.",
    replacesTools: ["Benchling", "BIOVIA Notebook", "Dotmatics", "Paper 21 CFR Part 11 Binders"],
    complianceStandards: ["FDA 21 CFR Part 11", "EMA Annex 11", "ICH Q8/Q9/Q10", "COMBINE / SED-ML"],
    languages: [
      "sbml",
      "antimony",
      "cantera",
      "smiles",
      "nmtran",
      "sbol",
      "bngl",
      "sedml",
      "pdb",
      "genbank",
      "gproms",
      "phreeqc",
      "fortran",
      "c",
    ],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Discovery campaigns, metabolic pathway modeling, and bioreactor scale-up",
        kind: "text",
      },
      {
        slug: "eln-assay-reviews",
        name: "eln-assay-reviews",
        topic: "Electronic Lab Notebook (ELN) protocol sign-offs, PDB crystal structures, and SMILES leads",
        kind: "ecr_review",
      },
      {
        slug: "pkpd-clinical",
        name: "pkpd-clinical",
        topic: "NONMEM/NMTRAN population PK/PD compartments and dose-response simulations",
        kind: "text",
      },
      {
        slug: "cfr11-audit-stream",
        name: "cfr11-audit-stream",
        topic: "Cryptographically signed FDA 21 CFR Part 11 e-signatures and reproducible SED-ML runs",
        kind: "bot_feed",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Two-Compartment PK/PD & Bioreactor Kinetics ELN",
        summary: "FDA 21 CFR Part 11 compliant executable lab notebook for pharmacokinetic and biochemical models.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Two-Compartment PK/PD & Bioreactor Kinetics ELN

## 1. Pharmacokinetic Compartment Dynamics
All changes to \`.sbml\`, \`.ant\`, \`.ctl\` (NMTRAN), and \`.pdb\` files are recorded with immutable cryptographic provenance.

\`\`\`modelica
model TwoCompartmentPK
  parameter Real k_a = 1.2 "Absorption rate (1/h)";
  parameter Real k_el = 0.28 "Elimination rate (1/h)";
  Real A_gut(start = 100.0) "Drug amount in gut (mg)";
  Real C_plasma(start = 0.0) "Central plasma concentration (mg/L)";
equation
  der(A_gut) = -k_a * A_gut;
  der(C_plasma) = (k_a * A_gut) / 14.0 - k_el * C_plasma;
end TwoCompartmentPK;
\`\`\`
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "Michaelis-Menten Enzyme Kinetics",
      code: `model EnzymeKinetics
  parameter Real Vmax = 2.5, Km = 0.8;
  Real S(start = 5.0) "Substrate (mM)", P(start = 0.0) "Product (mM)";
equation
  der(S) = -Vmax * S / (Km + S);
  der(P) = Vmax * S / (Km + S);
end EnzymeKinetics;`,
    },
  },

  med_radiology: {
    id: "med_radiology",
    name: "Radiology, Radiation Oncology & Biomechanics",
    shortLabel: "Medical & Biomech",
    icon: "heart",
    accentColor: "#06b6d4",
    description:
      "Musculoskeletal biomechanics (OpenSim), radiation therapy dosimetry (DICOM-RT, TOPAS), continuum tissue mechanics (FEBio), NIfTI neuroimaging, and 3MF implants.",
    replacesTools: ["Isolated PACS Research Folders", "Orthopedic CAD Silos", "Manual DVH Spreadsheets"],
    complianceStandards: ["IEC 62304 (SaMD)", "ISO 13485", "DICOM-RT / IHE-RO", "HIPAA De-Identification"],
    languages: ["opensim", "dicom-rt", "cellml", "febio", "nifti", "topas", "three-mf", "igtl", "modelica"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Clinical physics research, surgical navigation (OpenIGTLink), and implant biomechanics",
        kind: "text",
      },
      {
        slug: "treatment-plan-qa",
        name: "treatment-plan-qa",
        topic: "DICOM-RT dose-volume histogram (DVH) reviews and TOPAS Monte Carlo verification",
        kind: "ecr_review",
      },
      {
        slug: "musculoskeletal-sim",
        name: "musculoskeletal-sim",
        topic: "OpenSim gait kinematics, FEBio soft-tissue stress, and 3MF patient-specific implants",
        kind: "text",
      },
    ],
    starterDocs: [
      {
        slug: "overview",
        title: "Cardiovascular & Biomechanical Verification Protocol",
        summary: "Lumped-parameter Windkessel hemodynamics, OpenSim kinematics, and DICOM-RT QA standards.",
        pathInGit: "docs/overview.md",
        contentMarkdown: `# Cardiovascular & Biomechanical Verification Protocol

## 1. Windkessel Arterial Hemodynamics
This Space manages de-identified \`.dcm\` (DICOM-RT), \`.osim\` (OpenSim), \`.feb\` (FEBio), and \`.cellml\` models under **ISO 13485 / IEC 62304** design control.

\`\`\`modelica
model ArterialWindkessel
  parameter Real R_p = 1.05 "Peripheral resistance (mmHg.s/mL)";
  parameter Real C_art = 1.4 "Arterial compliance (mL/mmHg)";
  Real P_aorta(start = 85.0) "Aortic pressure (mmHg)";
equation
  C_art * der(P_aorta) = 95.0 * max(0.0, sin(6.283 * time)) - (P_aorta - 12.0) / R_p;
end ArterialWindkessel;
\`\`\`
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelica",
      title: "Windkessel Arterial Pulse Pressure",
      code: `model Windkessel
  parameter Real R = 1.1, C = 1.35;
  Real P(start = 80.0);
equation
  C * der(P) = 90.0 * max(0.0, sin(6.28 * time)) - P / R;
end Windkessel;`,
    },
  },
  fabless_electronics: {
    id: "fabless_electronics",
    name: "Fabless OEM Electronics & Contract Manufacturing (EMS)",
    shortLabel: "Fabless Electronics",
    icon: "circuit-board",
    accentColor: "#10b981",
    description:
      "Digital handoff between fabless hardware OEMs and contract manufacturers (CMs): IPC-2581C, ODB++, live multi-tier distributor BOM scrubbing, DFM/DFA review, and spatial pin-annotated Engineering Queries.",
    replacesTools: ["Altium 365", "Arena PLM", "MacroFab Portal", "Excel BOM Redlines", "Email DFM Review"],
    complianceStandards: ["IPC-2581C (DPMX)", "ODB++ v8.1", "IPC-A-600 / IPC-A-610 Class 2/3", "RoHS 3 / REACH SVHC"],
    languages: ["spice", "ibis", "verilog-a", "touchstone", "step", "qif", "modelica", "modelscript"],
    enabledTabs: ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"],
    defaultChannels: [
      {
        slug: "general",
        name: "general",
        topic: "Production scheduling, EMS coordination, and general hardware release updates",
        kind: "text",
      },
      {
        slug: "dfm-review",
        name: "dfm-review",
        topic: "Design for Manufacturing, Assembly, and Test (DFM/DFA/DFT) reviews",
        kind: "ecr_review",
      },
      {
        slug: "engineering-queries",
        name: "engineering-queries",
        topic: "Pin-annotated Engineering Queries (EQs) on PCB coordinates and deviation sign-offs",
        kind: "ecr_review",
      },
      {
        slug: "production-releases",
        name: "production-releases",
        topic: "Frozen release packages, IPC-2581C/ODB++ manufacturing archives, and Smart RFQ bundles",
        kind: "announcement",
      },
      {
        slug: "telemetry-qc",
        name: "telemetry-qc",
        topic: "In-Circuit Test (ICT), AOI defect maps, and functional test pass/fail telemetry",
        kind: "telemetry",
      },
    ],
    starterDocs: [
      {
        slug: "manufacturing-handbook",
        title: "PCBA Manufacturing & Sourcing Specification",
        summary: "Fabrication rules, stackup guidelines, approved vendor lists (AVL), and deviation workflows.",
        pathInGit: "docs/manufacturing-handbook.md",
        contentMarkdown: `# PCBA Manufacturing & Sourcing Specification

## 1. Scope & Handoff Standard
This Space manages production release bundles under strict **IPC-2581C** and **ODB++ v8.1** digital container formats.

## 2. Engineering Query (EQ) Policy
All component substitutions, clearance deviations, or solder mask adjustments must be submitted via spatial pin annotations in the **#engineering-queries** channel.
`,
      },
    ],
    sampleCodeSnippet: {
      language: "modelscript",
      title: "Manufacturing Specification & Stackup",
      code: `manufacturing TitanBoard {
  layer_count: 6;
  board_thickness: 1.6 mm;
  surface_finish: SurfaceFinish.ENIG;
  ipc_class: IPCClass.Class2;
}`,
    },
  },
};

export function getSpaceDomainPreset(id?: string | null): SpaceDomainPreset {
  if (id && id in SPACE_DOMAIN_PRESETS) {
    return SPACE_DOMAIN_PRESETS[id as SpaceDomainPresetId];
  }
  return SPACE_DOMAIN_PRESETS.systems_general;
}

export function listSpaceDomainPresets(): SpaceDomainPreset[] {
  return Object.values(SPACE_DOMAIN_PRESETS);
}
