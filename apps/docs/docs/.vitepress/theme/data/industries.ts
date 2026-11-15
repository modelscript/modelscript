// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Industry catalog powering the "Industries" mega menu, the `/industries/<slug>`
 * dynamic pages, and the homepage industries grid.
 *
 * Content guidelines:
 *  - Only list standards that are actually implemented/verified in the codebase.
 *  - CLI snippets must use commands documented in `/cli/commands`.
 *  - `featuredExamples`, `benchmarkSuites`, `mcpTools`, and `relatedSlugs` must
 *    reference verified entries checked by `apps/docs/scripts/check-docs.ts`.
 */

import type { IconName } from "./icons";
import type { Tone } from "./tones";

export type IndustryGroupId = "transportation" | "energy" | "industry";

export interface IndustryPain {
  title: string;
  body: string;
}

export interface IndustryStep {
  label: string;
  detail: string;
}

export interface IndustryCapability {
  title: string;
  body: string;
}

export interface IndustryTrack {
  id: string;
  label: string;
  summary: string;
  languages: string[];
}

export interface IndustryWorkspaceRef {
  name: string;
  path: string;
  summary: string;
  languages: string[];
  highlights: string[];
}

export interface IndustryComplianceProfile {
  ciFormats: string[];
  enterpriseFeatures: string[];
  docsLinks: { label: string; to: string }[];
}

export interface IndustryRelatedRef {
  slug: string;
  reason: string;
}

export interface Industry {
  slug: string;
  name: string;
  group: IndustryGroupId;
  icon: IconName;
  /** Accent hue for the industry (CSS color). */
  accent: string;
  /** Light/dark adaptive two-tone palette for schematics and icon tiles. */
  tone: Tone;
  /** Short line shown in the mega menu. */
  tagline: string;
  /** Hero headline on the industry page. */
  headline: string;
  /** Hero paragraph / meta description. */
  summary: string;
  /** Language slugs (see `languages.ts`). First entries are the primary formats. */
  languages: string[];
  /** Optional sub-domain tracks for multi-discipline sectors. */
  tracks?: IndustryTrack[];
  /** Implemented standards / interchange formats. */
  standards: string[];
  pains: IndustryPain[];
  capabilities: IndustryCapability[];
  workflow: IndustryStep[];
  /** Representative CLI session (documented commands only). */
  cli: string[];
  /** Up to 3 language slugs from `language-examples.generated.json` for interactive code + SVG preview. */
  featuredExamples: string[];
  /** Verified suite IDs in `benchmarks.generated.json` (`catalogById`). */
  benchmarkSuites: string[];
  /** Reference multi-language workspaces under `packages/examples/`. */
  workspaces?: IndustryWorkspaceRef[];
  /** Verified MCP tool names from `@modelscript/mcp` (`mcp-tools.generated.json`). */
  mcpTools: string[];
  /** CI, enterprise governance, and certification readiness profile. */
  compliance: IndustryComplianceProfile;
  /** Cross-sector related industries with explicit shared-thread rationale. */
  relatedSlugs: IndustryRelatedRef[];
}

export const INDUSTRY_GROUPS: { id: IndustryGroupId; code: string; label: string; summary: string }[] = [
  {
    id: "transportation",
    code: "01",
    label: "Transportation & Mobility",
    summary: "Flight dynamics, software-defined vehicles, rail homologation & offshore marine operations",
  },
  {
    id: "energy",
    code: "02",
    label: "Energy & Critical Infrastructure",
    summary: "Grid EMT compliance, multiphase flow assurance, reactor thermal-hydraulics & civil water networks",
  },
  {
    id: "industry",
    code: "03",
    label: "Electronics, Process & Life Sciences",
    summary: "SPICE/RF signal integrity, virtual PLC commissioning, chemical flowsheets & clinical CAS",
  },
];

export const INDUSTRIES: Industry[] = [
  // ───────────────────────────── Transportation ─────────────────────────────
  {
    slug: "aerospace",
    name: "Aerospace & Aviation",
    group: "transportation",
    icon: "plane",
    accent: "#38bdf8",
    tone: ["cyan", "indigo"],
    tagline: "Flight dynamics, propulsion & mission telemetry",
    headline: "From requirements to flight dynamics in a single, verifiable thread",
    summary:
      "Connect SysML v2 architectures and ReqIF requirements to JSBSim flight models, NASA ROCETS propulsion decks, Modelica subsystems, and CCSDS telemetry, then simulate, formally verify, and export SSP / FMU packages without leaving one toolchain.",
    languages: [
      "jsbsim",
      "rocets",
      "ccsds",
      "easy5",
      "modelica",
      "ssp",
      "sysml2",
      "reqif",
      "oscal",
      "step",
      "qif",
      "cfd",
      "fea",
      "fortran",
    ],
    tracks: [
      {
        id: "flight-propulsion",
        label: "Flight, Propulsion & Telemetry",
        summary: "6-DOF airframe dynamics, rocket engine transients, spacecraft ephemeris, and Modelica/SSP co-simulation.",
        languages: ["jsbsim", "rocets", "ccsds", "easy5", "modelica", "ssp", "fortran"],
      },
      {
        id: "systems-certification",
        label: "Systems, CAD & Assurance",
        summary: "SysML v2 traceability, ReqIF specs, NIST OSCAL security controls, STEP geometry, QIF GD&T, and CFD/FEA.",
        languages: ["sysml2", "reqif", "oscal", "step", "qif", "cfd", "fea"],
      },
    ],
    standards: [
      "SysML v2 / KerML",
      "ReqIF",
      "NIST OSCAL 1.1",
      "CCSDS OEM / OPM / XTCE",
      "STEP AP242",
      "ISO 23952 QIF 3.0",
      "SSP 1.0 (FMI 2.0 / 3.0)",
      "DO-178C MC/DC & Formal Proof",
    ],
    pains: [
      {
        title: "Requirements drift from analysis",
        body: "Requirements live in one tool, physics in another. Traceability is rebuilt by hand before every review.",
      },
      {
        title: "Legacy Fortran & decks",
        body: "Decades of validated propulsion and flight code are locked in card decks and Fortran routines nobody wants to touch.",
      },
      {
        title: "Certification evidence is manual",
        body: "Verification artifacts are assembled from screenshots and spreadsheets instead of generated from the models.",
      },
    ],
    capabilities: [
      {
        title: "6-DOF flight dynamics",
        body: "Parse JSBSim aircraft definitions and lower them to DAEs for simulation and linearization.",
      },
      {
        title: "Propulsion transients",
        body: "Ingest ROCETS engine decks and turbomachinery maps, with a bridge for embedded Fortran user routines.",
      },
      {
        title: "Mission telemetry",
        body: "Read CCSDS orbit and XTCE telemetry definitions and align them with simulated trajectories.",
      },
      {
        title: "Formal verification",
        body: "Check SysML v2 constraints, k-induction safety proofs, and MC/DC test vectors across airframe and controls.",
      },
    ],
    workflow: [
      { label: "Capture", detail: "SysML v2 architecture + ReqIF requirements" },
      { label: "Model", detail: "JSBSim airframe, ROCETS engine, Modelica subsystems" },
      { label: "Simulate", detail: "Stiff DAE solvers, SSP co-sim & Monte Carlo" },
      { label: "Verify", detail: "MC/DC, barrier proofs & SARIF evidence" },
    ],
    cli: [
      "msx rocets simulate engine.roc",
      "msx render SpacecraftPower spacecraft.sysml --view IBD -o ibd.svg",
      "msx verify BrakingController brake.mo --format sarif",
    ],
    featuredExamples: ["jsbsim", "rocets", "ccsds"],
    benchmarkSuites: [
      "jsbsim-flight-dynamics",
      "rocets-liquid-propulsion",
      "ccsds-orbit-mechanics",
      "cfd-naca0012-transonic",
    ],
    workspaces: [
      {
        name: "Drone Reachability & Clearance Twin",
        path: "packages/examples/drone-reachability",
        summary: "End-to-end CAD/STEP geometry, finite-element checks, Modelica actuator loops, and SysML v2 safety envelopes.",
        languages: ["sysml2", "modelica", "step", "fea"],
        highlights: ["Reachability tube verification", "Dynamic clearance checks", "SysML-to-Modelica RTM links"],
      },
      {
        name: "Drone Chassis Multiphysics Pack",
        path: "packages/examples/drone-chassis",
        summary: "Couples STEP CAD assemblies, CFD aerodynamics, FEA stress, Modelica propulsion, and SysML v2 trade studies.",
        languages: ["sysml2", "modelica", "step", "cfd", "fea"],
        highlights: ["Automated manufacturing gate", "SysML v2 parameter trade study", "3D CFD/FEA result coupling"],
      },
      {
        name: "SysML v2 + AssemblyScript WASM Pack",
        path: "packages/examples/sysml-wasm-pack",
        summary: "Self-contained Systems Engineering package pairing SysML v2 architecture with a Modelica plant and WASM kernel.",
        languages: ["sysml2", "modelica"],
        highlights: ["Portable WASM plant compilation", "Zero-dependency CI verification", "Deterministic step-response checks"],
      },
    ],
    mcpTools: [
      "validate_system_consistency",
      "formal_verify_safety_and_mcdc",
      "ssp_diagnose_cosim_stability",
      "cad_fea_closed_loop_size",
    ],
    compliance: {
      ciFormats: ["SARIF", "JUnit XML", "CTRF", "DHF"],
      enterpriseFeatures: [
        "ITAR / EAR Export Control & OFAC Screening",
        "Ed25519 Offline Air-Gapped License & Desktop Studio",
        "IC3/PDR Barrier Proofs & MC/DC Independence Vectors",
      ],
      docsLinks: [
        { label: "Formal Verification & CI/CD", to: "/guide/ci-cd" },
        { label: "MCP Agent Tools", to: "/reference/mcp-and-ide" },
        { label: "Export Formats", to: "/reference/export-formats" },
      ],
    },
    relatedSlugs: [
      { slug: "automotive", reason: "Shared SysML v2, SSP co-simulation, and MC/DC safety assurance workflows." },
      { slug: "nuclear", reason: "Shared ReqIF requirement traceability, Fortran deck ingestion, and OSCAL 1.1 compliance." },
      { slug: "robotics", reason: "Shared STEP AP242 CAD, QIF metrology, and FEA/CFD closed-loop sizing." },
    ],
  },
  {
    slug: "automotive",
    name: "Automotive & Mobility",
    group: "transportation",
    icon: "car",
    accent: "#a78bfa",
    tone: ["violet", "cyan"],
    tagline: "AUTOSAR, powertrain & autonomous-driving scenarios",
    headline: "Software-defined vehicles need a software-defined toolchain",
    summary:
      "Bring AUTOSAR architectures, Simulink controllers, GT-SUITE powertrains, ReqIF safety specs, and ASAM OpenDRIVE / OpenSCENARIO scenarios into one workspace, then co-simulate, verify ISO 26262 parity, and export FMUs.",
    languages: [
      "autosar",
      "simulink",
      "gtsuite",
      "opendrive",
      "openscenario",
      "gtfs",
      "reqif",
      "adams",
      "simpack",
      "qif",
      "oscal",
      "ssp",
      "modelica",
      "c",
    ],
    tracks: [
      {
        id: "sdv-powertrain",
        label: "SDV, Controls & Powertrain",
        summary: "AUTOSAR ARXML runnable scheduling, Simulink-to-Modelica migration, GT-SUITE thermal/powertrain, ReqIF, and C99.",
        languages: ["autosar", "simulink", "gtsuite", "reqif", "ssp", "modelica", "c"],
      },
      {
        id: "adas-chassis",
        label: "ADAS Scenarios, Chassis & Quality",
        summary: "ASAM OpenDRIVE roads, OpenSCENARIO cut-in safety, Adams/SIMPACK chassis dynamics, and QIF 3.0 SPC metrology.",
        languages: ["opendrive", "openscenario", "gtfs", "adams", "simpack", "qif", "oscal"],
      },
    ],
    standards: [
      "AUTOSAR Classic & Adaptive",
      "ASAM OpenDRIVE",
      "ASAM OpenSCENARIO",
      "GTFS Transit Feeds",
      "FMI 2.0 / 3.0",
      "SSP 1.0",
      "ISO 26262 (via ReqIF & B2B / MC/DC)",
    ],
    pains: [
      {
        title: "Toolchain sprawl",
        body: "Architecture, controls, plant, and scenario tools each speak their own format, so integrating them takes weeks.",
      },
      {
        title: "Scenario coverage",
        body: "Proving AV safety means running thousands of scenarios, not a handful of hand-picked test drives.",
      },
      {
        title: "Vendor lock-in",
        body: "Per-seat licenses limit who can run models, so CI and supplier collaboration suffer.",
      },
    ],
    capabilities: [
      {
        title: "AUTOSAR RTE simulation",
        body: "Inspect and lint ARXML, project it to SysML v2, and simulate runnable scheduling.",
      },
      {
        title: "Simulink → Modelica",
        body: "Parse .slx / .mdl block diagrams and translate them to equation-based Modelica with Back-to-Back parity checks.",
      },
      {
        title: "Scenario safety",
        body: "Orchestrate OpenSCENARIO runs on OpenDRIVE roads with time-to-collision and RSS margin checks.",
      },
      { title: "Co-simulation", body: "Package FMUs with SSP and orchestrate multi-rate co-simulation." },
    ],
    workflow: [
      { label: "Architect", detail: "AUTOSAR ARXML & ReqIF → SysML v2" },
      { label: "Integrate", detail: "Simulink controllers + GT-SUITE plant" },
      { label: "Scenario", detail: "OpenDRIVE roads, OpenSCENARIO maneuvers" },
      { label: "Deliver", detail: "FMI 3.0 FMUs & SSP 1.0 packages" },
    ],
    cli: [
      "msx autosar lint BrakeController.arxml",
      "msx simulink to-modelica Suspension.slx --out=Suspension.mo",
      "msx fmu DC_Motor motor.mo --fmi-version 3 --type cs",
    ],
    featuredExamples: ["autosar", "simulink", "openscenario"],
    benchmarkSuites: [
      "openscenario-highway-cutin",
      "gtfs-electric-bus-depot",
      "qif-sample-files",
      "modelica-msl-suite",
    ],
    mcpTools: [
      "polyglot_migrate_and_verify_b2b",
      "formal_verify_safety_and_mcdc",
      "ssp_diagnose_cosim_stability",
      "tgg_query_thread",
    ],
    compliance: {
      ciFormats: ["SARIF", "JUnit XML", "CTRF", "DHF"],
      enterpriseFeatures: [
        "ISO 26262 Back-to-Back (B2B) & C99 Codegen Equivalence",
        "Enterprise PLM Connectors (ARXML, Simulink, GT-SUITE, ReqIF)",
        "AASX / KPAR Digital Twin Archives & Black-Box FMU Gates",
      ],
      docsLinks: [
        { label: "CI/CD & Verification", to: "/guide/ci-cd" },
        { label: "FMI / SSP Co-Simulation", to: "/reference/export-formats" },
        { label: "CLI Reference", to: "/cli/commands" },
      ],
    },
    relatedSlugs: [
      { slug: "power-systems", reason: "EV charging depots (OCPP 2.0.1 / GTFS) and vehicle-to-grid power electronics." },
      { slug: "robotics", reason: "Shared Adams / SIMPACK multibody chassis models and QIF 3.0 factory metrology." },
      { slug: "aerospace", reason: "Shared MC/DC safety proofs, SSP co-simulation, and ReqIF requirement traceability." },
    ],
  },
  {
    slug: "rail",
    name: "Rail",
    group: "transportation",
    icon: "train",
    accent: "#f59e0b",
    tone: ["amber", "cyan"],
    tagline: "Vehicle dynamics, track geometry & EN 14363",
    headline: "Railway vehicle dynamics and homologation, open and reproducible",
    summary:
      "Read GENSYS and SIMPACK models, GTFS transit schedules, run track-vehicle simulations with measured irregularities, and generate EN 14363 acceptance and UIC 518 ride-comfort evidence automatically.",
    languages: ["gensys", "simpack", "gtfs", "adams", "modelica", "step", "csv"],
    standards: ["EN 14363", "UIC 518", "Kalker FASTSIM Contact", "GTFS Transit Feeds", "STEP AP242", "FMI 2.0 / 3.0"],
    pains: [
      {
        title: "Homologation is slow",
        body: "Acceptance reports take weeks of manual post-processing and are hard to reproduce.",
      },
      {
        title: "Tool silos",
        body: "Vehicle dynamics, track data, and CAD geometry live in separate tools and formats.",
      },
      {
        title: "Opaque legacy models",
        body: "Validated models are hard to inspect, diff, or review in pull requests.",
      },
    ],
    capabilities: [
      {
        title: "Track-vehicle simulation",
        body: "Track geometry, irregularities, and wheel-rail contact lowered into a single DAE.",
      },
      { title: "EN 14363 acceptance", body: "Automated homologation checks (Nadal Y/Q and Prud'homme limits) with HTML reports." },
      { title: "Ride comfort", body: "UIC 518 comfort indices across speed and track-quality sweeps." },
      { title: "Model translation", body: "Translate SIMPACK and Adams mechanisms to Modelica for open simulation." },
    ],
    workflow: [
      { label: "Import", detail: "GENSYS .calc / SIMPACK .spck" },
      { label: "Inspect", detail: "Topology, mobility & lint" },
      { label: "Simulate", detail: "Track irregularities & contact" },
      { label: "Certify", detail: "EN 14363 homologation report" },
    ],
    cli: [
      "msx gensys lint ManchesterBenchmark.calc",
      "msx gensys verify --y-force 40 --q-force 80 --axle-load 160",
      "msx gensys report ManchesterBenchmark.calc --format html --out homologation.html",
    ],
    featuredExamples: ["gensys", "simpack", "gtfs"],
    benchmarkSuites: ["gtfs-electric-bus-depot", "modelica-msl-suite", "fea-beam-vibration"],
    mcpTools: ["gensys_lint", "gensys_verify_en14363", "gensys_fastsim", "simpack_mobility"],
    compliance: {
      ciFormats: ["HTML Homologation", "CTRF", "JUnit XML", "JSON"],
      enterpriseFeatures: [
        "Reproducible EN 14363 & UIC 518 Acceptance Evidence",
        "Slurm HPC Sweep Orchestration for Track Quality Matrices",
        "Git/PR Model Diffs & SAML/OIDC Engineering Reviews",
      ],
      docsLinks: [
        { label: "GENSYS & Rail CLI", to: "/cli/commands" },
        { label: "MCP Rail Tools", to: "/reference/mcp-and-ide" },
        { label: "CI/CD Integration", to: "/guide/ci-cd" },
      ],
    },
    relatedSlugs: [
      { slug: "automotive", reason: "Shared Adams/SIMPACK multibody suspension modeling and GTFS transit schedule feeds." },
      { slug: "robotics", reason: "Shared spatial mobility analysis and STEP AP242 mechanical assembly interchange." },
      { slug: "marine", reason: "Shared time-domain multibody response and DNV/EN structural acceptance workflows." },
    ],
  },
  {
    slug: "marine",
    name: "Marine & Offshore",
    group: "transportation",
    icon: "anchor",
    accent: "#2dd4bf",
    tone: ["teal", "cyan"],
    tagline: "Marine operations, risers & mooring",
    headline: "Offshore dynamics with design-code checks built in",
    summary:
      "Ingest SINTEF Ocean SIMO and RIFLEX models, simulate marine operations and slender-structure dynamics, and check results against DNV offshore standards.",
    languages: ["sima", "olga", "fea", "cfd", "modelica", "csv"],
    standards: ["DNV-OS-E301 (Mooring)", "DNV-ST-0119 (Floating Wind)", "OC4 Semi-Submersible", "FMI 2.0 / 3.0"],
    pains: [
      {
        title: "Coupled physics",
        body: "Hydrodynamics, mooring, risers, and flow assurance are analyzed separately and reconciled by hand.",
      },
      {
        title: "Code-check overhead",
        body: "Applying design codes to every load case is repetitive and easy to get wrong.",
      },
      { title: "Limited automation", body: "Desktop-only tools make CI pipelines and large sensitivity studies hard." },
    ],
    capabilities: [
      {
        title: "SIMO / RIFLEX ingestion",
        body: "Parse marine operation and riser input files into a typed workspace.",
      },
      { title: "Mooring code checks", body: "Mooring line capacity and fatigue checks against DNV standards." },
      { title: "Multi-domain projection", body: "Project offshore systems into Modelica for coupled simulation." },
      { title: "Flow assurance link", body: "Couple riser dynamics with OLGA multiphase flow models." },
    ],
    workflow: [
      { label: "Import", detail: "SIMO / RIFLEX inputs" },
      { label: "Couple", detail: "Mooring, risers & flow" },
      { label: "Simulate", detail: "Time-domain DAE" },
      { label: "Check", detail: "DNV code compliance" },
    ],
    cli: ["msx sima lint mooring.sima", "msx sima verify mooring.sima", "msx sima offset mooring.sima"],
    featuredExamples: ["sima", "olga", "cfd"],
    benchmarkSuites: ["sima-oc4-semi-fowt", "cfd-naca0012-transonic", "fea-beam-vibration"],
    mcpTools: ["olga_verify", "olga_diagram", "cad_fea_closed_loop_size", "validate_system_consistency"],
    compliance: {
      ciFormats: ["JSON", "CTRF", "JUnit XML", "SARIF"],
      enterpriseFeatures: [
        "Distributed MQTT / FMI Co-Simulation Master Orchestrator",
        "Air-Gapped Vessel & Offshore Engineering Appliance Mode",
        "Automated DNV Load-Case Sweep & Code-Check Evidence",
      ],
      docsLinks: [
        { label: "SIMA CLI Reference", to: "/cli/commands" },
        { label: "Co-Simulation Export", to: "/reference/export-formats" },
        { label: "Enterprise Deployment", to: "/guide/administration" },
      ],
    },
    relatedSlugs: [
      { slug: "oil-gas", reason: "Couples subsea riser structural dynamics with OLGA multiphase flow assurance." },
      { slug: "power-systems", reason: "Floating offshore wind turbines connecting to EMT subsea transmission grids." },
      { slug: "rail", reason: "Shared slender-structure/multibody time-domain DAE verification workflows." },
    ],
  },

  // ─────────────────────────── Energy & Infrastructure ───────────────────────────
  {
    slug: "power-systems",
    name: "Power Systems & Grid",
    group: "energy",
    icon: "zap",
    accent: "#facc15",
    tone: ["amber", "emerald"],
    tagline: "EMT, power flow & grid-code compliance",
    headline: "Grid-code compliance, from PSCAD to IEEE 2800 in one pipeline",
    summary:
      "Run PSCAD/EMTDC electromagnetic transients, Siemens PSS/E, DIgSILENT PowerFactory, and GE PSLF transmission studies alongside OpenDSS distribution, IEC 61850 substations, OCPP EV charging, and OpenADR demand response — with IEEE 2800, NERC PRC-029, and ENTSO-E RfG verification built in.",
    languages: [
      "pscad",
      "psse",
      "powerfactory",
      "pslf",
      "cgmes",
      "matpower",
      "opendss",
      "atp",
      "comtrade",
      "scl",
      "dnp3",
      "oneliner",
      "sel",
      "ocpp",
      "openadr",
      "ampl",
      "oscal",
      "modelica",
      "c",
      "fortran",
      "csv",
    ],
    tracks: [
      {
        id: "transmission-emt",
        label: "Transmission & EMT Stability",
        summary: "PSCAD/ATP electromagnetic transients, PSS/E, PowerFactory, PSLF, CGMES/MATPOWER power flow & IBR compliance.",
        languages: ["pscad", "psse", "powerfactory", "pslf", "cgmes", "matpower", "atp"],
      },
      {
        id: "distribution-der",
        label: "Distribution, DER & EV Edge",
        summary: "Unbalanced 3-phase OpenDSS hosting capacity, OCPP 1.6J/2.0.1 EV fleets, OpenADR 2.0b DR, and AMPL/Modelica OPF.",
        languages: ["opendss", "ocpp", "openadr", "ampl", "modelica"],
      },
      {
        id: "protection-cyber",
        label: "Protection, Telemetry & CIP",
        summary: "IEEE C37.111 COMTRADE, IEC 61850 SCL (GOOSE/SV), DNP3 telemetry, OneLiner/SEL relays, and NERC CIP OSCAL.",
        languages: ["comtrade", "scl", "dnp3", "oneliner", "sel", "oscal", "c", "fortran", "csv"],
      },
    ],
    standards: [
      "IEEE 2800-2022 & NERC PRC-029-1",
      "ENTSO-E RfG & IEEE 1547-2018",
      "DIgSILENT PowerFactory (.dz / .pfd / .dsl)",
      "GE PSLF (.epc / .dyd) & PSS/E RAW v30–35",
      "IEC 61970-600 CGMES & IEC 61850 SCL (GOOSE / SV)",
      "IEEE 1815 (DNP3) & C37.111 COMTRADE",
      "OCPP 1.6J / 2.0.1 & OpenADR 2.0b",
      "NIST OSCAL 1.1 (NERC CIP) & CIGRE B4.82 / TB 881",
    ],
    pains: [
      {
        title: "Interconnection queues",
        body: "Inverter-based resources need extensive EMT and ride-through studies before they can connect.",
      },
      {
        title: "Black-box vendor models",
        body: "OEM controller DLLs only run inside specific desktop tools on specific operating systems.",
      },
      {
        title: "Fragmented studies",
        body: "Transmission, distribution, and EMT models are maintained separately and drift apart.",
      },
    ],
    capabilities: [
      { title: "EMT simulation", body: "Native PSCAD project ingestion and electromagnetic transient solving." },
      {
        title: "Ride-through verification",
        body: "Automated IEEE 2800 LVRT/HVRT and NERC PRC-029 checks with JSON reports.",
      },
      {
        title: "Power flow & DER hosting",
        body: "PSS/E, PowerFactory, CGMES, and PSLF transmission cases plus OpenDSS unbalanced distribution and hosting capacity.",
      },
      {
        title: "COMTRADE waveforms",
        body: "Read and write IEEE C37.111 transient recordings and validate IEC 61850 GOOSE / SEL protection coordination.",
      },
    ],
    workflow: [
      { label: "Import", detail: "PSCAD .pscx, PSS/E .raw, PowerFactory .dz/.pfd/.dsl, PSLF .epc, OpenDSS .dss" },
      { label: "Simulate", detail: "EMT, RMS & power flow solvers" },
      { label: "Record", detail: "COMTRADE waveforms" },
      { label: "Comply", detail: "IEEE 2800 / NERC PRC-029 / ENTSO-E RfG report" },
    ],
    cli: [
      "msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 3.0 --step 20us -o report.json",
      "msx psse solve case.raw",
      "msx psse diagram case.raw",
    ],
    featuredExamples: ["pscad", "powerfactory", "opendss"],
    benchmarkSuites: [
      "opendss-ieee-feeders",
      "cgmes-conformity-grid",
      "cgmes-entsoe-corridor",
      "ocpp-fleet-smart-charging",
      "openadr-grid-curtailment",
    ],
    workspaces: [
      {
        name: "PSCAD IBR Microgrid & IEEE 2800 Pack",
        path: "packages/examples/pscad-microgrid",
        summary: "Full 250 MVA / 100 MVA IBR substation project with EMT simulation, 7-clause IEEE 2800 verification, COMTRADE, and SSP.",
        languages: ["pscad", "modelica", "ssp", "comtrade"],
        highlights: ["7-clause IEEE 2800 pass report", "COMTRADE .cfg/.dat export", "PSCAD-to-Modelica & SSP bridge"],
      },
      {
        name: "EMT Screening & PMView Pipeline",
        path: "packages/examples/emt-screening-pack",
        summary: "Multi-engine SysML v2 verification DAG screening PSS/E .raw/.dyr cases for NERC MOD-032 & short-circuit strength.",
        languages: ["psse", "sysml2"],
        highlights: ["POI short-circuit MVA check", "Automated NERC MOD-032 audit", "Composable SDK pipeline stages"],
      },
      {
        name: "Telecom CO -48V DC Microgrid",
        path: "packages/examples/telecom-co-microgrid",
        summary: "Modelica standby diesel, N+1 rectifiers, ATS switching, and dual battery strings modeled in ModelScript.",
        languages: ["modelica"],
        highlights: ["72-hour outage resilience test", "Automated CTRF test artifacts", "Continuous/discrete ATS switching"],
      },
    ],
    mcpTools: [
      "pscad_verify_ieee2800",
      "pscad_lint",
      "opendss_solve_powerflow",
      "opendss_hosting_capacity",
      "scl_validate_goose",
      "comtrade_extract_phasor",
    ],
    compliance: {
      ciFormats: ["SARIF", "JSON", "JUnit XML", "CTRF"],
      enterpriseFeatures: [
        "NERC CIP / FERC CEII RBAC & Immutable Audit Logging",
        "Automated ISO Interconnection Gatekeeper (msx gatekeeper)",
        "CIGRE B4.82 Black-Box DLL Execution & Air-Gapped Deployments",
      ],
      docsLinks: [
        { label: "OPF & Grid Solvers", to: "/cli/opf" },
        { label: "PSCAD & PSS/E CLI", to: "/cli/commands" },
        { label: "Enterprise Grid Governance", to: "/guide/administration" },
      ],
    },
    relatedSlugs: [
      { slug: "electronics", reason: "Shared SPICE/Verilog-A converter physics and Telecom CO -48V backup microgrids." },
      { slug: "buildings", reason: "Grid-interactive campuses coupling EnergyPlus loads with OpenADR 2.0b and OCPP chargers." },
      { slug: "automotive", reason: "EV fleet smart-charging depots (OCPP) and heavy powertrain electrification." },
    ],
  },
  {
    slug: "oil-gas",
    name: "Oil, Gas & Subsurface",
    group: "energy",
    icon: "flame",
    accent: "#fb923c",
    tone: ["amber", "rose"],
    tagline: "Flow assurance, pipelines & reservoirs",
    headline: "Flow assurance from reservoir to export pipeline",
    summary:
      "Connect ECLIPSE and TOUGH2/TOUGH3 subsurface reservoir decks, OLGA multiphase flow models, PipelineStudio networks, and PHREEQC brine geochemistry, and simulate transients, phase envelopes, and gas properties in one workspace.",
    languages: ["olga", "lps", "eclipse", "tough", "phreeqc", "aspen", "gproms", "sima", "modelica", "csv"],
    standards: [
      "ISO 20765-1 (AGA-8)",
      "ISO 20765-2 (GERG-2008)",
      "OLGA (.opi / .key / .genkey) & PipelineStudio (.lps)",
      "TOUGH2 / TOUGH3 EOS & ECLIPSE",
      "USGS PHREEQC & FMI 2.0 / 3.0",
    ],
    pains: [
      {
        title: "Siloed disciplines",
        body: "Reservoir, wells, pipelines, and facilities teams each use different simulators.",
      },
      {
        title: "Costly transients",
        body: "Slugging, shutdown, and restart studies need many long runs across scenarios.",
      },
      { title: "Hard-to-audit decks", body: "Large keyword decks are difficult to review, lint, and version-control." },
    ],
    capabilities: [
      {
        title: "Multiphase transients",
        body: "Parse OLGA cases, run transient multiphase simulations, and plot spatial pipeline elevation profiles.",
      },
      {
        title: "EOS & phase envelopes",
        body: "Compute Peng-Robinson / SRK phase envelopes, hydrate margins, and GERG-2008 compressibility.",
      },
      { title: "Pipeline networks", body: "PipelineStudio TGNET/TLNET hydraulics with ISO 20765 gas properties." },
      { title: "Reservoir & scaling", body: "Parse ECLIPSE and TOUGH decks and evaluate PHREEQC mineral saturation indices." },
    ],
    workflow: [
      { label: "Reservoir", detail: "ECLIPSE, TOUGH & PHREEQC decks" },
      { label: "Flowline", detail: "OLGA multiphase" },
      { label: "Network", detail: "PipelineStudio hydraulics" },
      { label: "Facility", detail: "Aspen & gPROMS flowsheets" },
    ],
    cli: [
      "msx olga simulate subsea_tieback.opi --duration=3600 --out=traj.csv",
      'msx olga flash --comp="C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03" --p=50 --t=295.15 --envelope',
      "msx olga diagram tieback.opi --view=profile --out=profile.svg",
    ],
    featuredExamples: ["olga", "lps", "eclipse"],
    benchmarkSuites: ["eclipse-spe10-reservoir", "tough-geothermal-reservoir", "phreeqc-karst-aquifer"],
    workspaces: [
      {
        name: "ASME BPVC Section VIII Div 1 Pack",
        path: "packages/examples/asme-bpvc-viii-1",
        summary: "Reference engineering rule pack validating pressure-vessel wall thickness, MAOP margins, and safety constraints.",
        languages: ["olga"],
        highlights: ["Reusable ModelScript rule pack", "Automated pressure-vessel MAOP checks", "Drop-in workspace import"],
      },
    ],
    mcpTools: ["olga_simulate", "olga_lint", "olga_verify", "olga_tune", "olga_survey", "olga_gate"],
    compliance: {
      ciFormats: ["JSON", "SARIF", "CTRF", "JUnit XML"],
      enterpriseFeatures: [
        "Air-Gapped On-Premises Docker / Kubernetes Appliance",
        "TimescaleDB Production Historian & Live Digital Twins",
        "Automated OLGA Flow Assurance Safety Gates in Git PRs",
      ],
      docsLinks: [
        { label: "OLGA & Pipeline CLI", to: "/cli/commands" },
        { label: "MCP Flow Assurance Tools", to: "/reference/mcp-and-ide" },
        { label: "Enterprise Administration", to: "/guide/administration" },
      ],
    },
    relatedSlugs: [
      { slug: "marine", reason: "Subsea tieback risers, FPSO hydrodynamics, and DNV mooring code checks." },
      { slug: "process", reason: "Upstream separation feeding Aspen / gPROMS refining and gas-processing facilities." },
      { slug: "buildings", reason: "Shared USGS PHREEQC reactive transport and porous-media groundwater hydrology." },
    ],
  },
  {
    slug: "nuclear",
    name: "Nuclear",
    group: "energy",
    icon: "atom",
    accent: "#4ade80",
    tone: ["emerald", "teal"],
    tagline: "Reactor thermal-hydraulics & point kinetics",
    headline: "Reactor thermal-hydraulics you can read, diff, and verify",
    summary:
      "Parse RELAP5-3D card decks, simulate non-equilibrium two-phase hydrodynamics with delayed-neutron point kinetics, and project loops to Modelica with SysML v2 / ReqIF / OSCAL traceability.",
    languages: ["relap5", "modelica", "fortran", "sysml2", "reqif", "oscal", "csv"],
    standards: [
      "RELAP5-3D Input Decks (10 CFR 50 App. B)",
      "SysML v2 / KerML",
      "ReqIF Traceability",
      "NIST OSCAL 1.1",
      "FMI 2.0 / 3.0",
    ],
    pains: [
      {
        title: "80-column legacy decks",
        body: "Safety-critical models are written as fixed-format cards, which makes review error-prone.",
      },
      {
        title: "Traceability for licensing",
        body: "Regulators expect clear links between requirements, models, and results.",
      },
      { title: "Long iteration loops", body: "Desktop-only workflows slow down parametric and uncertainty studies." },
    ],
    capabilities: [
      { title: "Card deck parsing", body: "High-fidelity parsing of 80-column RELAP5 input with structural linting." },
      { title: "Two-phase hydrodynamics", body: "Non-equilibrium two-phase flow lowered to DAEs." },
      { title: "Point kinetics", body: "6-group delayed neutron point kinetics coupled to thermal-hydraulics." },
      { title: "Requirement traceability", body: "Link models to SysML v2 / ReqIF safety requirements and OSCAL cyber baselines." },
    ],
    workflow: [
      { label: "Import", detail: "RELAP5 card decks" },
      { label: "Lint", detail: "Structural & unit checks" },
      { label: "Simulate", detail: "Two-phase + kinetics" },
      { label: "Trace", detail: "ReqIF & OSCAL evidence" },
    ],
    cli: ["msx lint ./decks --format json", "msx mc Loop loop.mo", "msx verify Loop loop.mo --format sarif"],
    featuredExamples: ["relap5", "modelica", "reqif"],
    benchmarkSuites: ["relap5-nuclear-transients", "sysml2-xpect-tests", "modelica-msl-suite"],
    mcpTools: [
      "rtm_query_matrix",
      "rtm_diagnose_suspect",
      "validate_system_consistency",
      "oscal_audit_cps_compliance",
    ],
    compliance: {
      ciFormats: ["SARIF", "DHF", "CTRF", "JUnit XML"],
      enterpriseFeatures: [
        "ITAR / EAR Export Control & Air-Gapped Desktop Studio",
        "ReqIF ↔ SysML v2 ↔ RELAP5 Suspect-Link Impact Auditing",
        "NIST SP 800-82 / OSCAL OT Security Control Verification",
      ],
      docsLinks: [
        { label: "CI/CD Verification", to: "/guide/ci-cd" },
        { label: "RELAP5 Language Guide", to: "/languages/relap5" },
        { label: "MCP & RTM Tools", to: "/reference/mcp-and-ide" },
      ],
    },
    relatedSlugs: [
      { slug: "aerospace", reason: "Shared ReqIF requirement matrices, legacy Fortran integration, and formal verification." },
      { slug: "power-systems", reason: "Baseload turbine-generator grid interconnection and OSCAL critical-infrastructure compliance." },
      { slug: "process", reason: "Shared steam-cycle thermal-hydraulics and Modelica plant optimization." },
    ],
  },
  {
    slug: "buildings",
    name: "Buildings & Civil Infrastructure",
    group: "energy",
    icon: "building",
    accent: "#60a5fa",
    tone: ["indigo", "teal"],
    tagline: "Building energy, water, river hydraulics & groundwater",
    headline: "Model the built environment, from HVAC to river hydraulics and aquifers",
    summary:
      "Bring EnergyPlus building models, EPANET water distribution networks, EPA SWMM stormwater systems, HEC-RAS river hydraulics, MODFLOW 6 groundwater aquifers, and LandGEM landfill emissions into one workspace for coupled simulation and analysis.",
    languages: [
      "energyplus",
      "epanet",
      "swmm",
      "hec-ras",
      "hec-hms",
      "modflow",
      "waterml",
      "asm",
      "landgem",
      "phreeqc",
      "modelica",
      "step",
      "csv",
    ],
    tracks: [
      {
        id: "buildings-hvac",
        label: "Building Energy & HVAC",
        summary: "EnergyPlus IDF/epJSON envelope loads, Modelica HVAC plant coupling, STEP geometry, and SCADA CSV calibration.",
        languages: ["energyplus", "modelica", "step", "csv"],
      },
      {
        id: "water-stormwater",
        label: "Water, Stormwater & Wastewater",
        summary: "EPANET hydraulics & leak localization, SWMM 5 dynamic-wave drainage, WaterML rating curves & IWA ASM1.",
        languages: ["epanet", "swmm", "waterml", "asm"],
      },
      {
        id: "hydrology-subsurface",
        label: "Rivers, Aquifers & Biogas",
        summary: "USACE HEC-RAS / HEC-HMS floodplains, USGS MODFLOW 6 3D aquifers, PHREEQC water chemistry, and EPA LandGEM.",
        languages: ["hec-ras", "hec-hms", "modflow", "phreeqc", "landgem"],
      },
    ],
    standards: [
      "EnergyPlus IDF / epJSON (ASHRAE 90.1)",
      "EPANET INP, AWWA M36 & M31",
      "EPA SWMM 5.x (Saint-Venant)",
      "USACE HEC-RAS, HEC-HMS & USGS MODFLOW 6",
      "OGC WaterML 2.0 & IWA ASM",
      "US EPA LandGEM & USGS PHREEQC",
      "FMI 2.0 / 3.0",
    ],
    pains: [
      {
        title: "Disconnected systems",
        body: "Energy, water, and drainage are modeled separately even though they interact.",
      },
      { title: "Scenario explosion", body: "Climate and demand scenarios multiply the number of runs needed." },
      { title: "Digital twin gaps", body: "Models rarely connect to live sensor data for calibration." },
    ],
    capabilities: [
      { title: "Building energy", body: "Parse EnergyPlus IDF/epJSON models for thermal and HVAC analysis." },
      { title: "Water distribution", body: "Pressurized network hydraulics, WQ chlorine decay, and AWWA M36 audits from EPANET models." },
      { title: "Stormwater, rivers & aquifers", body: "1D Saint-Venant SWMM routing, HEC-RAS river profiles, and MODFLOW 6 3D groundwater head." },
      { title: "Sensor calibration", body: "Align simulations with CSV and WaterML telemetry for SCADA calibration and digital twins." },
    ],
    workflow: [
      { label: "Import", detail: "IDF, EPANET, SWMM, HEC-RAS & MODFLOW inputs" },
      { label: "Couple", detail: "Projection to Modelica" },
      { label: "Simulate", detail: "Scenario sweeps" },
      { label: "Calibrate", detail: "Telemetry alignment" },
    ],
    cli: [
      "msx lint ./city --format json",
      "msx simulate ThermalGrid plant.mo --stop-time 3600",
      "msx surrogate HeatExchanger thermal.mo",
    ],
    featuredExamples: ["energyplus", "epanet", "swmm"],
    benchmarkSuites: [
      "energyplus-reference-buildings",
      "epanet-benchmark-networks",
      "swmm-qa-examples",
      "hec-ras-river-reach",
      "modflow-groundwater-flow",
      "landgem-chp-facility",
    ],
    mcpTools: [
      "epanet_solve_hydraulics",
      "epanet_calibrate_scada",
      "epanet_screen_contingencies_webgpu",
      "swmm_flood_routing",
      "swmm_inundation_2d",
      "hec_hms_simulate_runoff",
      "waterml_fit_rating_curve",
      "asm_evaluate_biokinetics",
    ],
    compliance: {
      ciFormats: ["JSON", "SARIF", "CTRF", "JUnit XML"],
      enterpriseFeatures: [
        "SCADA Telemetry Alignment & Demand Calibration",
        "WebGPU Batched Contingency Screening for Municipal Water",
        "NIST SP 800-82 / OSCAL OT Security Compliance Audits",
      ],
      docsLinks: [
        { label: "MCP Water & Hydro Tools", to: "/reference/mcp-and-ide" },
        { label: "EPANET & SWMM CLI", to: "/cli/commands" },
        { label: "Enterprise Administration", to: "/guide/administration" },
      ],
    },
    relatedSlugs: [
      { slug: "power-systems", reason: "Grid-interactive efficient buildings (OpenADR) and municipal pump/microgrid loads." },
      { slug: "oil-gas", reason: "Shared porous-media flow (MODFLOW/TOUGH) and USGS PHREEQC reactive geochemistry." },
      { slug: "process", reason: "Activated-sludge biokinetics (IWA ASM) and LandGEM landfill-gas CHP energy recovery." },
    ],
  },

  // ─────────────────────── Electronics, Industry & Science ───────────────────────
  {
    slug: "electronics",
    name: "Electronics, RF & Telecommunications",
    group: "industry",
    icon: "cpu",
    accent: "#22d3ee",
    tone: ["cyan", "violet"],
    tagline: "SPICE, compact models, IBIS, S-parameters, DWDM & 5G RAN",
    headline: "Analog, RF, signal integrity, and optical/wireless telecom in one open toolchain",
    summary:
      "Simulate SPICE netlists, compile Accellera Verilog-A compact models, integrate IBIS buffers and Touchstone S-parameters, and model OpenROADM/GNPy DWDM optical transport, 5G NR / LTE RAN coverage, and TIA-598-D outside-plant fiber networks.",
    languages: ["spice", "verilog-a", "ibis", "touchstone", "optical", "ran", "fiber", "modelica", "c"],
    tracks: [
      {
        id: "analog-si",
        label: "Analog, Compact Devices & SI/PI",
        summary: "SPICE OP/TRAN/AC solving, Accellera Verilog-A/AMS compact devices, IBIS 5.0 SerDes, Touchstone passivity & C.",
        languages: ["spice", "verilog-a", "ibis", "touchstone", "c"],
      },
      {
        id: "optical-rf-osp",
        label: "Optical DWDM, 5G RAN & Outside Plant",
        summary: "OpenROADM / GNPy DWDM OSNR, Telcordia OTDR (.sor), 3GPP TR 38.901 5G RAN, TIA-598-D Fiber & NESC C2.",
        languages: ["optical", "ran", "fiber", "modelica"],
      },
    ],
    standards: [
      "Accellera Verilog-A / Verilog-AMS LRM",
      "IBIS & Touchstone 1.0 / 2.0",
      "OpenROADM / GNPy DWDM & ITU-T G.8275.1 / G.8273.2",
      "Telcordia GR-196 / SR-4731 OTDR (.sor)",
      "3GPP TR 38.901 5G NR & NSMA WG16 (.adf / .msi)",
      "TIA-598-D Fiber & NESC C2 Pole Loading",
      "SPICE Netlists & FMI 2.0 / 3.0",
    ],
    pains: [
      { title: "Fragmented EDA flows", body: "Circuit, device, and channel models each need a different simulator." },
      {
        title: "Non-passive macromodels",
        body: "Measured S-parameters produce unstable time-domain simulations if they aren't passive.",
      },
      {
        title: "System context missing",
        body: "Electronics are rarely simulated together with the mechanical and thermal system around them.",
      },
    ],
    capabilities: [
      { title: "Circuit analysis", body: "SPICE operating point, transient, and AC analyses from the CLI." },
      { title: "Compact models", body: "Compile Verilog-A behavioral models to DAEs and export SPICE netlists." },
      {
        title: "Rational macromodels",
        body: "Vector fitting with Hamiltonian passivity enforcement for Touchstone data.",
      },
      {
        title: "Optical, 5G RAN & Fiber",
        body: "GNPy DWDM GSNR & OTDR trace analysis, 3GPP 38.901 RF coverage, NESC Rule 250/260 pole loading, and TIA-598-D splicing.",
      },
    ],
    workflow: [
      { label: "Netlist", detail: "SPICE + Verilog-A devices" },
      { label: "Channel", detail: "Touchstone, IBIS, DWDM & RAN" },
      { label: "Simulate", detail: "OP, transient, AC & link budgets" },
      { label: "Integrate", detail: "Modelica / FMU export" },
    ],
    cli: [
      "msx spice simulate LowPassFilter.cir --analysis op",
      "msx spice simulate PowerSupply.cir --analysis tran --tstep 1e-6 --tstop 0.02 --out transient.csv",
      "msx spice simulate AudioAmplifier.sp --analysis ac --format csv --out bode.csv",
    ],
    featuredExamples: ["verilog-a", "spice", "optical"],
    benchmarkSuites: [
      "verilog-a-compact-models",
      "touchstone-s-parameters",
      "ibis-serdes-10g",
      "optical-terabit-dwdm",
      "ran-5g-cband-backhaul",
      "fiber-metro-ring-catena",
    ],
    workspaces: [
      {
        name: "Telecom CO -48V DC Microgrid",
        path: "packages/examples/telecom-co-microgrid",
        summary: "Central-office -48V DC power plant with ATS, standby diesel generator, N+1 rectifiers, and dual VRLA battery strings.",
        languages: ["modelica"],
        highlights: ["72-hour outage holdover check", "Automated CTRF verification", "N+1 rectifier redundancy study"],
      },
    ],
    mcpTools: [
      "polyglot_migrate_and_verify_b2b",
      "ecad_dfm_audit",
      "ecad_generate_manufacturing_bundle",
      "optical_solve_transmission",
      "optical_inspect_otdr",
      "ran_solve_microwave_budget",
      "fiber_evaluate_pole_loading",
    ],
    compliance: {
      ciFormats: ["CSV / JSON", "SARIF", "CTRF", "JUnit XML"],
      enterpriseFeatures: [
        "IPC-2581C / ODB++ v8.1 Manufacturing & BOM Risk Gates",
        "SPICE-to-Modelica Back-to-Back (B2B) Parity Certification",
        "FCC BDC / NORS & NESC Rule 250/260 Carrier Compliance",
      ],
      docsLinks: [
        { label: "SPICE & Telecom CLI", to: "/cli/commands" },
        { label: "MCP ECAD & Telecom Tools", to: "/reference/mcp-and-ide" },
        { label: "Verilog-A Compact Modeling", to: "/languages/verilog-a" },
      ],
    },
    relatedSlugs: [
      { slug: "power-systems", reason: "Wide-bandgap SiC/GaN power electronics and Telecom CO -48V grid backup." },
      { slug: "robotics", reason: "Embedded C firmware, IPC-2581 ECAD/MCAD co-design, and servo power stages." },
      { slug: "aerospace", reason: "High-reliability RF/optical links, avionics buses, and radiation-hardened circuits." },
    ],
  },
  {
    slug: "robotics",
    name: "Robotics & Industrial Automation",
    group: "industry",
    icon: "bot",
    accent: "#f472b6",
    tone: ["rose", "indigo"],
    tagline: "URDF kinematics, AutomationML, PLCs & mechanisms",
    headline: "From robot description to verified plant & controller",
    summary:
      "Load URDF/Xacro robots, IEC 62714 AutomationML plant hierarchies, and Adams mechanisms, run IEC 61131-3 PLC programs on a virtual PLC, and formally verify control logic against the plant model.",
    languages: ["urdf", "plcopen", "automationml", "adams", "simpack", "opensim", "step", "qif", "scad", "usd", "modelica"],
    tracks: [
      {
        id: "kinematics-mbd",
        label: "Kinematics, Multibody & Biomechanics",
        summary: "URDF/Xacro robots (Featherstone RNEA), MSC Adams & SIMPACK mechanisms, OpenSim musculoskeletal, and Modelica.",
        languages: ["urdf", "adams", "simpack", "opensim", "modelica"],
      },
      {
        id: "automation-twin",
        label: "PLC Commissioning, CAD & Metrology",
        summary: "PLCopen IEC 61131-3 virtual PLC, IEC 62714 AutomationML CAEX, STEP AP242, QIF 3.0 GD&T, OpenSCAD & OpenUSD.",
        languages: ["plcopen", "automationml", "step", "qif", "scad", "usd"],
      },
    ],
    standards: [
      "IEC 61131-3 / PLCopen XML",
      "IEC 62714 AutomationML (CAEX)",
      "URDF / Xacro",
      "AOUSD OpenUSD / UsdPhysics",
      "STEP AP242",
      "ISO 23952 QIF 3.0 & ASME Y14.5",
      "FMI 2.0 / 3.0",
    ],
    pains: [
      {
        title: "Control vs. plant gap",
        body: "PLC logic is tested on hardware late, after mechanical design is frozen.",
      },
      { title: "Format conversions", body: "Robot descriptions, CAD, and mechanism models must be converted by hand." },
      { title: "Unsafe edge cases", body: "Interlocks and state machines fail in ways that tests rarely cover." },
    ],
    capabilities: [
      { title: "Robot dynamics", body: "URDF/Xacro kinematics with Featherstone dynamics and Modelica export." },
      { title: "Virtual commissioning", body: "AutomationML CAEX plant topologies coupled to cyclic IEC 61131-3 PLCs." },
      { title: "Mechanism & metrology", body: "Mobility analysis for Adams/SIMPACK and ISO 23952 QIF GD&T inspection." },
      { title: "Formal verification", body: "Check PLC logic and controllers with model checking." },
    ],
    workflow: [
      { label: "Describe", detail: "URDF / AutomationML / STEP" },
      { label: "Control", detail: "PLCopen & IEC 61131-3" },
      { label: "Simulate", detail: "Virtual commissioning" },
      { label: "Verify", detail: "Safety & QIF metrology" },
    ],
    cli: [
      "msx urdf lint Manipulator.xacro",
      "msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo",
      "msx adams mobility FourBarLinkage.adm",
    ],
    featuredExamples: ["urdf", "automationml", "plcopen"],
    benchmarkSuites: ["urdf-moveit-robots", "usd-robotic-articulated-arm", "scad-bosl2-suite", "qif-sample-files"],
    workspaces: [
      {
        name: "Drone Chassis Multiphysics Pack",
        path: "packages/examples/drone-chassis",
        summary: "Unifies STEP CAD, OpenSCAD parametric brackets, FEA stress checks, Modelica actuators, and SysML v2 specs.",
        languages: ["step", "fea", "cfd", "modelica", "sysml2"],
        highlights: ["CAD-to-FEA safety factor gate", "Automated manufacturing checks", "OpenUSD / STEP geometry sync"],
      },
      {
        name: "Drone Reachability & Clearance Twin",
        path: "packages/examples/drone-reachability",
        summary: "3D collision-clearance and dynamic reachability tube verification across CAD and Modelica models.",
        languages: ["step", "fea", "modelica", "sysml2"],
        highlights: ["BVH collision clearance checks", "SOS barrier safety certificates", "Parametric CAD trade studies"],
      },
    ],
    mcpTools: [
      "aml_run_virtual_commissioning",
      "cad_fea_closed_loop_size",
      "qif_inspect_and_spc",
      "formal_verify_safety_and_mcdc",
    ],
    compliance: {
      ciFormats: ["SARIF", "JUnit XML", "CTRF", "JSON"],
      enterpriseFeatures: [
        "Industry 4.0 .aasx & OMG .kpar Digital Twin Archive Export",
        "PLM Connectors (Adams, SIMPACK, STEP AP242, PLCopen)",
        "Virtual PLC Closed-Loop Safety & BVH Collision Gates",
      ],
      docsLinks: [
        { label: "URDF & Adams CLI", to: "/cli/commands" },
        { label: "MCP Robotics & CAD Tools", to: "/reference/mcp-and-ide" },
        { label: "CI/CD Pipelines", to: "/guide/ci-cd" },
      ],
    },
    relatedSlugs: [
      { slug: "automotive", reason: "Shared Adams/SIMPACK chassis dynamics, QIF metrology, and embedded controls." },
      { slug: "rail", reason: "Shared multibody mobility diagnostics and STEP AP242 mechanical assembly geometry." },
      { slug: "life-sciences", reason: "Surgical robotics (OpenIGTLink + URDF) and OpenSim human-robot biomechanics." },
    ],
  },
  {
    slug: "process",
    name: "Chemical & Process",
    group: "industry",
    icon: "flask",
    accent: "#c084fc",
    tone: ["violet", "teal"],
    tagline: "Flowsheets, kinetics, geochemistry & molecular graphs",
    headline: "Open, scriptable chemical & process simulation",
    summary:
      "Parse Aspen Plus flowsheets, gPROMS dynamic PDEs, AMPL algebraic optimization models, Cantera reaction mechanisms, PHREEQC aqueous geochemistry, and SMILES/SDF molecular graphs, and couple them with equation-based control and pipeline networks.",
    languages: ["aspen", "gproms", "ampl", "cantera", "phreeqc", "smiles", "olga", "lps", "plcopen", "modelica", "csv"],
    tracks: [
      {
        id: "flowsheets-control",
        label: "Flowsheets, PDE Reactors & Control",
        summary: "Aspen Plus/HYSYS flowsheets, gPROMS distributed PDE reactors (MOL), AMPL optimization, Modelica, and PLCopen.",
        languages: ["aspen", "gproms", "ampl", "modelica", "plcopen"],
      },
      {
        id: "kinetics-geochem",
        label: "Kinetics, Molecules & Networks",
        summary: "Cantera YAML mechanisms & NASA-7 thermo, SMILES Joback properties, PHREEQC geochemistry, OLGA & PipelineStudio.",
        languages: ["cantera", "phreeqc", "smiles", "olga", "lps", "csv"],
      },
    ],
    standards: [
      "Aspen Plus / HYSYS (.bkp / .inp)",
      "gPROMS PML (Method of Lines)",
      "AMPL (.mod / .nl / .mps)",
      "Cantera YAML & NASA-7 Thermo",
      "USGS PHREEQC Geochemistry",
      "SMILES / MDL Molfile & Joback-Reid",
      "IEC 61131-3 & FMI 2.0 / 3.0",
    ],
    pains: [
      { title: "Steady-state only", body: "Flowsheets are rarely carried into dynamic and control studies." },
      { title: "Closed formats", body: "Process models are hard to review, diff, and automate." },
      {
        title: "Disconnected scales",
        body: "Molecular properties, reaction kinetics, and plant controls live in separate tools.",
      },
    ],
    capabilities: [
      { title: "Flowsheets & PDEs", body: "Read Aspen flowsheets and discretize gPROMS distributed domains via Method of Lines." },
      { title: "Kinetics & thermochemistry", body: "Evaluate Cantera Arrhenius/Troe mechanisms and NASA-7 polynomials." },
      { title: "Molecular & aqueous properties", body: "Estimate Joback critical properties from SMILES and PHREEQC mineral saturation." },
      { title: "Optimization", body: "Direct-collocation optimal control, AMPL NLP solving, and parameter estimation." },
    ],
    workflow: [
      { label: "Molecules", detail: "SMILES, Cantera & PHREEQC" },
      { label: "Flowsheet", detail: "Aspen & gPROMS PDEs" },
      { label: "Control", detail: "Modelica & PLC co-sim" },
      { label: "Optimize", detail: "AMPL & collocation solver" },
    ],
    cli: [
      "msx lint ./plant --format json",
      "msx optimize Reactor reactor.mo",
      "msx simulate Reactor reactor.mo --stop-time 3600",
    ],
    featuredExamples: ["cantera", "aspen", "gproms"],
    benchmarkSuites: [
      "aspen-hydrocarbon-fractionation",
      "gproms-axial-dispersion-pfr",
      "cantera-reaction-mechanisms",
      "phreeqc-karst-aquifer",
    ],
    workspaces: [
      {
        name: "ASME BPVC Section VIII Div 1 Pack",
        path: "packages/examples/asme-bpvc-viii-1",
        summary: "Reference pressure-vessel compliance pack encoding ASME BPVC Section VIII Div 1 design rules alongside plant models.",
        languages: ["modelica"],
        highlights: ["ASME BPVC pressure-vessel rules", "Declarative constraint verification", "Composable ModelScript package"],
      },
    ],
    mcpTools: [
      "modelscript_closed_loop_synthesize",
      "modelica_diff_calibrate",
      "modelica_linearize",
      "modelica_tune_pid",
      "aml_run_virtual_commissioning",
    ],
    compliance: {
      ciFormats: ["JSON", "SARIF", "CTRF", "JUnit XML"],
      enterpriseFeatures: [
        "Slurm HPC Batch Parameter Estimation & Collocation",
        "NIST SP 800-82 / OSCAL OT Control System Audits",
        "SIMC PID Loop Shaping & Air-Gapped Plant Twin Hosting",
      ],
      docsLinks: [
        { label: "CLI Optimize & Simulate", to: "/cli/commands" },
        { label: "MCP Synthesis & PID Tools", to: "/reference/mcp-and-ide" },
        { label: "Enterprise Overview", to: "/guide/administration" },
      ],
    },
    relatedSlugs: [
      { slug: "oil-gas", reason: "Upstream OLGA / PipelineStudio separation feeding refinery and petrochemical flowsheets." },
      { slug: "buildings", reason: "Wastewater biokinetics (IWA ASM), biogas LandGEM CHP, and USGS PHREEQC chemistry." },
      { slug: "life-sciences", reason: "Shared biochemical reaction kinetics, SMILES property estimation, and ODE/PDE calibration." },
    ],
  },
  {
    slug: "life-sciences",
    name: "Life Sciences, Healthcare & Medical",
    group: "industry",
    icon: "dna",
    accent: "#34d399",
    tone: ["emerald", "indigo"],
    tagline: "Systems biology, pharmacometrics, radiotherapy & surgical CAS",
    headline: "From molecular pathways to radiotherapy and surgical navigation",
    summary:
      "Unify systems & synthetic biology (SBML, Antimony, BioNetGen, SBOL3, SED-ML, NMTRAN, MLXTRAN, PDB, GenBank) with clinical physiology, neurobiology, biomechanics, radiation oncology, and computer-assisted surgery (CellML, NMODL, OpenSim, FEBio, DICOM-RT, TOPAS, NIfTI/NRRD, 3MF Medical, OpenIGTLink).",
    languages: [
      "sbml",
      "antimony",
      "bngl",
      "sbol",
      "sedml",
      "nmtran",
      "mlxtran",
      "pdb",
      "genbank",
      "cellml",
      "nmodl",
      "opensim",
      "febio",
      "dicom-rt",
      "topas",
      "nifti",
      "three-mf",
      "igtl",
      "modelica",
      "owl2",
      "csv",
    ],
    tracks: [
      {
        id: "sysbio-pkpd",
        label: "Systems Biology & Pharmacometrics",
        summary: "SBML, Antimony, BioNetGen, SBOL3 genetic circuits, SED-ML experiments, NONMEM NMTRAN & Monolix PK/PD.",
        languages: ["sbml", "antimony", "bngl", "sbol", "sedml", "nmtran", "mlxtran", "pdb", "genbank"],
      },
      {
        id: "physiome-biomech",
        label: "Physiology & Biomechanics",
        summary: "CellML 2.0 cardiac electrophysiology, NEURON NMODL ion channels, OpenSim musculoskeletal, FEBio tissues & Modelica.",
        languages: ["cellml", "nmodl", "opensim", "febio", "modelica"],
      },
      {
        id: "clinical-cas",
        label: "Radiology, Oncology & Surgical CAS",
        summary: "DICOM-RT VMAT/DVH QA, TOPAS proton Bragg peaks, NIfTI iso-surfaces, 3MF surgical guides & OpenIGTLink TRE.",
        languages: ["dicom-rt", "topas", "nifti", "three-mf", "igtl", "owl2", "csv"],
      },
    ],
    standards: [
      "SBML L2/L3 & SED-ML",
      "SBOL3 & GenBank",
      "NONMEM NMTRAN & Monolix MLXTRAN",
      "CellML 2.0 & NEURON NMODL",
      "DICOM-RT (RTPLAN / RTSTRUCT / RTDOSE) & TOPAS",
      "NIfTI-1/2 & NRRD",
      "ISO/ASTM 52915 3MF Medical",
      "OpenIGTLink & PLUS",
      "FDA 21 CFR 820.30 / Part 11 DHF & IEC 62304",
    ],
    pains: [
      { title: "Reproducibility gaps", body: "Published biological and clinical models are hard to re-run and verify across scales." },
      { title: "Fragmented clinical geometry", body: "Medical imaging, radiotherapy plans, surgical guides, and tracker calibration live in disconnected silos." },
      { title: "Regulatory traceability", body: "Assembling FDA 21 CFR 820.30 / Part 11 / IEC 62304 Design History Files by hand is slow and error-prone." },
    ],
    capabilities: [
      { title: "Systems & synthetic biology", body: "Simulate SBML, Antimony, BioNetGen, SBOL3 genetic circuits, and NONMEM PK/PD dosing protocols." },
      { title: "Physiome & biomechanics", body: "Solve CellML cardiac electrophysiology, OpenSim musculoskeletal dynamics, and FEBio hyperelastic tissues." },
      { title: "Radiotherapy & proton therapy", body: "Evaluate DICOM-RT DVH metrics, BED/EQD2 biological doses, and TOPAS Bortfeld Bragg peaks." },
      { title: "Image-guided surgery", body: "Extract NIfTI/NRRD iso-surfaces, verify 3MF surgical guides, and compute OpenIGTLink Fitzpatrick TRE." },
    ],
    workflow: [
      { label: "Pathways", detail: "SBML, Antimony, SBOL3 & NMTRAN" },
      { label: "Biomechanics", detail: "CellML, OpenSim & FEBio" },
      { label: "Oncology & CAS", detail: "DICOM-RT, TOPAS, NIfTI, 3MF & IGTL" },
      { label: "Certify", detail: "FDA / ISO Design History File" },
    ],
    cli: [
      "msx dicom-rt dosimetry ProstateVMAT.rtplan",
      "msx topas bragg-peak ProtonNozzle.topas",
      "msx three-mf topology MandibleOsteotomyGuide.3mf",
      "msx igtl calibrate LaparoscopicTracker.plus.xml",
    ],
    featuredExamples: ["sbml", "dicom-rt", "opensim"],
    benchmarkSuites: [
      "sbml-semantic-cases",
      "antimony-tellurium-suite",
      "bngl-egfr-signaling",
      "sedml-metabolic-experiment",
      "nmtran-two-cmt-oral-pk",
      "opensim-models-gait",
      "febio-biomechanics-suite",
    ],
    mcpTools: [
      "opensim_analyze",
      "dicom_rt_verify_dvh",
      "cellml_simulate",
      "igtl_verify_calibration",
      "three_mf_verify_guide",
      "modelscript_stochastic_jump",
    ],
    compliance: {
      ciFormats: ["DHF", "SARIF", "JUnit XML", "CTRF"],
      enterpriseFeatures: [
        "FDA 21 CFR Part 11 E-Signatures & Signature Manifests",
        "HIPAA RBAC & Automated IEC 62304 Design History File (DHF)",
        "Gillespie SSA, Non-Linear Mixed Effects & DICOM-RT QA",
      ],
      docsLinks: [
        { label: "Radiology & Surgical CAS", to: "/reference/radiology-and-surgery" },
        { label: "Clinical & Bio CLI", to: "/cli/commands" },
        { label: "MCP Clinical Tools", to: "/reference/mcp-and-ide" },
      ],
    },
    relatedSlugs: [
      { slug: "process", reason: "Shared biochemical kinetics, SMILES molecular property estimation, and ODE calibration." },
      { slug: "robotics", reason: "OpenSim musculoskeletal kinematics, surgical robot calibration (OpenIGTLink), and 3D guides." },
      { slug: "nuclear", reason: "Monte Carlo radiation transport / dosimetry and rigorous safety-case traceability." },
    ],
  },
];

export const INDUSTRY_BY_SLUG: Record<string, Industry> = Object.fromEntries(INDUSTRIES.map((i) => [i.slug, i]));
