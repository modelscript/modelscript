// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Industry catalog powering the "Industries" mega menu, the `/industries/<slug>`
 * dynamic pages, and the homepage industries grid.
 *
 * Content guidelines:
 *  - Only list standards that are actually implemented/verified in the codebase.
 *  - CLI snippets must use commands documented in `/cli/commands`.
 */

import type { IconName } from "./icons";

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

export interface Industry {
  slug: string;
  name: string;
  group: IndustryGroupId;
  icon: IconName;
  /** Accent hue for the industry (CSS color). */
  accent: string;
  /** Short line shown in the mega menu. */
  tagline: string;
  /** Hero headline on the industry page. */
  headline: string;
  /** Hero paragraph / meta description. */
  summary: string;
  /** Language slugs (see `languages.ts`). First entries are the primary formats. */
  languages: string[];
  /** Implemented standards / interchange formats. */
  standards: string[];
  pains: IndustryPain[];
  capabilities: IndustryCapability[];
  workflow: IndustryStep[];
  /** Representative CLI session (documented commands only). */
  cli: string[];
}

export const INDUSTRY_GROUPS: { id: IndustryGroupId; label: string }[] = [
  { id: "transportation", label: "Transportation" },
  { id: "energy", label: "Energy & Infrastructure" },
  { id: "industry", label: "Electronics, Industry & Science" },
];

export const INDUSTRIES: Industry[] = [
  // ───────────────────────────── Transportation ─────────────────────────────
  {
    slug: "aerospace",
    name: "Aerospace & Defense",
    group: "transportation",
    icon: "plane",
    accent: "#38bdf8",
    tagline: "Flight dynamics, propulsion & mission telemetry",
    headline: "From requirements to flight dynamics in a single, verifiable thread",
    summary:
      "Connect SysML v2 architectures and ReqIF requirements to JSBSim flight models, NASA ROCETS propulsion decks, and CCSDS telemetry, then simulate, verify, and export FMUs without leaving one toolchain.",
    languages: ["jsbsim", "rocets", "ccsds", "easy5", "sysml2", "reqif", "step", "cfd", "fea", "fortran"],
    standards: ["SysML v2 / KerML", "ReqIF", "CCSDS OEM / OPM / XTCE", "STEP AP242", "FMI 2.0 / 3.0", "SSP"],
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
        body: "Check SysML v2 constraints and requirement contracts with k-induction and SMT-backed proofs.",
      },
    ],
    workflow: [
      { label: "Capture", detail: "SysML v2 architecture + ReqIF requirements" },
      { label: "Model", detail: "JSBSim airframe, ROCETS engine, Modelica subsystems" },
      { label: "Simulate", detail: "Stiff DAE solvers, Monte Carlo, surrogates" },
      { label: "Verify", detail: "Requirement entailment & SARIF evidence" },
    ],
    cli: [
      "msx rocets simulate engine.roc",
      "msx render SpacecraftPower spacecraft.sysml --view IBD -o ibd.svg",
      "msx verify BrakingController brake.mo --engine kind --format sarif",
    ],
  },
  {
    slug: "automotive",
    name: "Automotive & Mobility",
    group: "transportation",
    icon: "car",
    accent: "#a78bfa",
    tagline: "AUTOSAR, powertrain & autonomous-driving scenarios",
    headline: "Software-defined vehicles need a software-defined toolchain",
    summary:
      "Bring AUTOSAR architectures, Simulink controllers, GT-SUITE powertrains, and ASAM OpenDRIVE / OpenSCENARIO scenarios into one workspace, then co-simulate, check safety margins, and export FMUs.",
    languages: [
      "autosar",
      "simulink",
      "gtsuite",
      "opendrive",
      "openscenario",
      "adams",
      "simpack",
      "ssp",
      "modelica",
      "c",
    ],
    standards: [
      "AUTOSAR Classic & Adaptive",
      "ASAM OpenDRIVE",
      "ASAM OpenSCENARIO",
      "FMI 2.0 / 3.0",
      "SSP 1.0 / 2.0",
      "ISO 26262 (via ReqIF)",
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
        body: "Parse .slx / .mdl block diagrams and translate them to equation-based Modelica.",
      },
      {
        title: "Scenario safety",
        body: "Orchestrate OpenSCENARIO runs on OpenDRIVE roads with time-to-collision and RSS margin checks.",
      },
      { title: "Co-simulation", body: "Package FMUs with SSP and orchestrate multi-rate co-simulation." },
    ],
    workflow: [
      { label: "Architect", detail: "AUTOSAR ARXML → SysML v2" },
      { label: "Integrate", detail: "Simulink controllers + GT-SUITE plant" },
      { label: "Scenario", detail: "OpenDRIVE roads, OpenSCENARIO maneuvers" },
      { label: "Deliver", detail: "FMI 3.0 FMUs & SSP packages" },
    ],
    cli: [
      "msx autosar lint BrakeController.arxml",
      "msx simulink to-modelica Suspension.slx --out=Suspension.mo",
      "msx fmu DC_Motor motor.mo --fmi-version 3 --type cs",
    ],
  },
  {
    slug: "rail",
    name: "Rail",
    group: "transportation",
    icon: "train",
    accent: "#f59e0b",
    tagline: "Vehicle dynamics, track geometry & EN 14363",
    headline: "Railway vehicle dynamics and homologation, open and reproducible",
    summary:
      "Read GENSYS and SIMPACK models, run track-vehicle simulations with measured irregularities, and generate EN 14363 acceptance and UIC 518 ride-comfort evidence automatically.",
    languages: ["gensys", "simpack", "adams", "modelica", "step", "csv"],
    standards: ["EN 14363", "UIC 518", "STEP AP242", "FMI 2.0 / 3.0"],
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
      { title: "EN 14363 acceptance", body: "Automated homologation checks with HTML reports." },
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
      "msx gensys inspect ManchesterBenchmark.calc",
      "msx gensys verify-en14363 ManchesterBenchmark.calc --out=homologation.html",
      "msx gensys comfort HighSpeedTrain.calc --speed=250",
    ],
  },
  {
    slug: "marine",
    name: "Marine & Offshore",
    group: "transportation",
    icon: "anchor",
    accent: "#2dd4bf",
    tagline: "Marine operations, risers & mooring",
    headline: "Offshore dynamics with design-code checks built in",
    summary:
      "Ingest SINTEF Ocean SIMO and RIFLEX models, simulate marine operations and slender-structure dynamics, and check results against DNV offshore standards.",
    languages: ["sima", "olga", "fea", "cfd", "modelica", "csv"],
    standards: ["DNV-OS-E301", "DNV-ST-0119", "FMI 2.0 / 3.0"],
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
    cli: ["msx sima lint mooring.sima", "msx sima simulate mooring.sima", "msx sima verify-dnv mooring.sima"],
  },

  // ─────────────────────────── Energy & Infrastructure ───────────────────────────
  {
    slug: "power-systems",
    name: "Power Systems & Grid",
    group: "energy",
    icon: "zap",
    accent: "#facc15",
    tagline: "EMT, power flow & grid-code compliance",
    headline: "Grid-code compliance, from PSCAD to IEEE 2800 in one pipeline",
    summary:
      "Run PSCAD/EMTDC electromagnetic transients, PSS/E transmission power flow, and OpenDSS distribution studies in one open toolchain, with IEEE 2800 and NERC PRC-029 ride-through verification built in.",
    languages: ["pscad", "psse", "opendss", "modelica", "c", "fortran", "csv"],
    standards: [
      "IEEE 2800-2022",
      "NERC PRC-029-1",
      "IEEE C37.111 COMTRADE",
      "PSS/E RAW v30–35",
      "CIGRE black-box DLLs",
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
        body: "PSS/E transmission cases and OpenDSS unbalanced distribution and hosting-capacity analysis.",
      },
      {
        title: "COMTRADE waveforms",
        body: "Read and write IEEE C37.111 transient recordings for comparison against field data.",
      },
    ],
    workflow: [
      { label: "Import", detail: "PSCAD .pscx, PSS/E .raw, OpenDSS .dss" },
      { label: "Simulate", detail: "EMT & power flow solvers" },
      { label: "Record", detail: "COMTRADE waveforms" },
      { label: "Comply", detail: "IEEE 2800 / NERC PRC-029 report" },
    ],
    cli: [
      "msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 3.0 --step 20us -o report.json",
      "msx psse powerflow case.raw",
      "msx psse to-pscad case.raw",
    ],
  },
  {
    slug: "oil-gas",
    name: "Oil, Gas & Subsurface",
    group: "energy",
    icon: "flame",
    accent: "#fb923c",
    tagline: "Flow assurance, pipelines & reservoirs",
    headline: "Flow assurance from reservoir to export pipeline",
    summary:
      "Connect ECLIPSE reservoir decks, OLGA multiphase flow models, and PipelineStudio networks, and simulate transients, phase envelopes, and gas properties in one workspace.",
    languages: ["olga", "lps", "eclipse", "aspen", "sima", "modelica", "csv"],
    standards: ["ISO 20765-1", "ISO 20765-2", "FMI 2.0 / 3.0"],
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
        body: "Simulate OLGA subsea tie-backs and risers, and plot pipeline profiles.",
      },
      { title: "Thermodynamics", body: "Flash calculations and phase envelopes from compositional fluid definitions." },
      { title: "Pipeline networks", body: "PipelineStudio TGNET/TLNET hydraulics with ISO 20765 gas properties." },
      { title: "Reservoir decks", body: "Parse and lint ECLIPSE reservoir input for traceable studies." },
    ],
    workflow: [
      { label: "Reservoir", detail: "ECLIPSE decks" },
      { label: "Flowline", detail: "OLGA multiphase" },
      { label: "Network", detail: "PipelineStudio hydraulics" },
      { label: "Facility", detail: "Aspen process flowsheets" },
    ],
    cli: [
      "msx olga simulate subsea_tieback.opi --duration=3600 --out=traj.csv",
      'msx olga flash --comp="C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03" --p=50 --t=295.15 --envelope',
      "msx olga diagram tieback.opi --view=profile --out=profile.svg",
    ],
  },
  {
    slug: "nuclear",
    name: "Nuclear",
    group: "energy",
    icon: "atom",
    accent: "#4ade80",
    tagline: "Reactor thermal-hydraulics & point kinetics",
    headline: "Reactor thermal-hydraulics you can read, diff, and verify",
    summary:
      "Parse RELAP5-3D card decks, simulate non-equilibrium two-phase hydrodynamics with delayed-neutron point kinetics, and project loops to Modelica for system-level studies.",
    languages: ["relap5", "modelica", "fortran", "sysml2", "reqif", "csv"],
    standards: ["RELAP5-3D input decks", "SysML v2", "ReqIF", "FMI 2.0 / 3.0"],
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
      { title: "Requirement traceability", body: "Link models to SysML v2 / ReqIF safety requirements." },
    ],
    workflow: [
      { label: "Import", detail: "RELAP5 card decks" },
      { label: "Lint", detail: "Structural & unit checks" },
      { label: "Simulate", detail: "Two-phase + kinetics" },
      { label: "Trace", detail: "Requirements evidence" },
    ],
    cli: ["msx lint ./decks --format json", "msx mc Loop loop.mo", "msx verify Loop loop.mo --format sarif"],
  },
  {
    slug: "buildings",
    name: "Buildings & Civil Infrastructure",
    group: "energy",
    icon: "building",
    accent: "#60a5fa",
    tagline: "Building energy, water & stormwater networks",
    headline: "Model the built environment, from HVAC to stormwater",
    summary:
      "Bring EnergyPlus building models, EPANET water distribution networks, and EPA SWMM stormwater systems into one workspace for coupled simulation and analysis.",
    languages: ["energyplus", "epanet", "swmm", "modelica", "step", "csv"],
    standards: ["EnergyPlus IDF / epJSON", "EPANET INP", "SWMM 5.x", "FMI 2.0 / 3.0"],
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
      { title: "Water distribution", body: "Pressurized network hydraulics from EPANET models." },
      { title: "Stormwater routing", body: "1D Saint-Venant dynamic-wave routing for SWMM networks." },
      { title: "Sensor calibration", body: "Align simulations with CSV telemetry for digital twins." },
    ],
    workflow: [
      { label: "Import", detail: "IDF, EPANET & SWMM inputs" },
      { label: "Couple", detail: "Projection to Modelica" },
      { label: "Simulate", detail: "Scenario sweeps" },
      { label: "Calibrate", detail: "Telemetry alignment" },
    ],
    cli: [
      "msx lint ./city --format json",
      "msx simulate ThermalGrid plant.mo --stop-time 3600",
      "msx surrogate HeatExchanger thermal.mo",
    ],
  },

  // ─────────────────────── Electronics, Industry & Science ───────────────────────
  {
    slug: "electronics",
    name: "Electronics & Semiconductors",
    group: "industry",
    icon: "cpu",
    accent: "#22d3ee",
    tagline: "SPICE, compact models, IBIS & S-parameters",
    headline: "Analog, RF, and signal integrity in one open toolchain",
    summary:
      "Simulate SPICE netlists, compile Verilog-A compact models, and integrate IBIS buffers and Touchstone S-parameters with vector fitting and passivity enforcement.",
    languages: ["spice", "verilog-a", "ibis", "touchstone", "modelica", "c"],
    standards: ["IEEE 1857 Verilog-A / AMS", "IBIS", "Touchstone 1.0 / 2.0", "SPICE netlists", "FMI 2.0 / 3.0"],
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
      { title: "System-level projection", body: "Project circuits into Modelica for multi-domain studies." },
    ],
    workflow: [
      { label: "Netlist", detail: "SPICE + Verilog-A devices" },
      { label: "Channel", detail: "Touchstone & IBIS models" },
      { label: "Simulate", detail: "OP, transient & AC" },
      { label: "Integrate", detail: "Modelica / FMU export" },
    ],
    cli: [
      "msx spice op LowPassFilter.cir",
      "msx spice tran PowerSupply.cir --stop=0.02 --step=1e-6 --out=transient.csv",
      "msx spice ac AudioAmplifier.sp --fstart=10 --fstop=1e5 --points=100",
    ],
  },
  {
    slug: "robotics",
    name: "Robotics & Industrial Automation",
    group: "industry",
    icon: "bot",
    accent: "#f472b6",
    tagline: "URDF kinematics, PLCs & mechanisms",
    headline: "From robot description to verified controller",
    summary:
      "Load URDF/Xacro robots and Adams mechanisms, run IEC 61131-3 PLC programs on a virtual PLC, and formally verify control logic against the plant model.",
    languages: ["urdf", "plcopen", "adams", "simpack", "step", "scad", "modelica"],
    standards: ["IEC 61131-3", "PLCopen XML", "URDF / Xacro", "STEP AP242", "FMI 2.0 / 3.0"],
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
      { title: "Virtual PLC", body: "Cyclic IEC 61131-3 execution coupled to a sampled-data plant." },
      { title: "Mechanism analysis", body: "Mobility analysis and translation of Adams and SIMPACK mechanisms." },
      { title: "Formal verification", body: "Check PLC logic and controllers with model checking." },
    ],
    workflow: [
      { label: "Describe", detail: "URDF / STEP / Adams" },
      { label: "Control", detail: "PLCopen & IEC 61131-3" },
      { label: "Simulate", detail: "Virtual commissioning" },
      { label: "Verify", detail: "Safety properties" },
    ],
    cli: [
      "msx urdf lint Manipulator.xacro",
      "msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo",
      "msx adams mobility FourBarLinkage.adm",
    ],
  },
  {
    slug: "process",
    name: "Chemical & Process",
    group: "industry",
    icon: "flask",
    accent: "#c084fc",
    tagline: "Process flowsheets & dynamic simulation",
    headline: "Open, scriptable process simulation",
    summary:
      "Parse Aspen Plus and HYSYS flowsheets, project them to equation-based models, and couple them with control logic and pipeline networks.",
    languages: ["aspen", "olga", "lps", "plcopen", "modelica", "csv"],
    standards: ["Aspen Plus / HYSYS inputs", "IEC 61131-3", "FMI 2.0 / 3.0"],
    pains: [
      { title: "Steady-state only", body: "Flowsheets are rarely carried into dynamic and control studies." },
      { title: "Closed formats", body: "Process models are hard to review, diff, and automate." },
      {
        title: "Disconnected controls",
        body: "Control logic is designed without a dynamic process model to test against.",
      },
    ],
    capabilities: [
      { title: "Flowsheet parsing", body: "Read Aspen input and backup files into a typed workspace." },
      { title: "Equation-based projection", body: "Lower unit operations to DAEs for dynamic simulation." },
      { title: "Control co-design", body: "Couple PLC programs to process models." },
      { title: "Optimization", body: "Direct-collocation optimal control and parameter estimation." },
    ],
    workflow: [
      { label: "Import", detail: "Aspen flowsheets" },
      { label: "Project", detail: "Equation-based DAE" },
      { label: "Control", detail: "PLC co-simulation" },
      { label: "Optimize", detail: "Collocation solver" },
    ],
    cli: [
      "msx lint ./plant --format json",
      "msx optimize Reactor reactor.mo",
      "msx simulate Reactor reactor.mo --stop-time 3600",
    ],
  },
  {
    slug: "life-sciences",
    name: "Life Sciences",
    group: "industry",
    icon: "dna",
    accent: "#34d399",
    tagline: "Systems biology & biochemical kinetics",
    headline: "Systems biology models with an engineer's toolchain",
    summary:
      "Simulate SBML Level 2 and 3 reaction networks, run parameter sweeps and Monte Carlo studies, and project models to Modelica for multi-scale analysis.",
    languages: ["sbml", "modelica", "csv", "owl2"],
    standards: ["SBML Level 2 & 3 Core", "OWL2", "FMI 2.0 / 3.0"],
    pains: [
      { title: "Reproducibility", body: "Published models are hard to re-run exactly as described." },
      { title: "Uncertain parameters", body: "Kinetic parameters are uncertain, so single runs aren't enough." },
      { title: "Siloed knowledge", body: "Ontologies and models are rarely connected in a queryable way." },
    ],
    capabilities: [
      { title: "Reaction kinetics", body: "Streaming SBML parsing and ODE simulation of reaction networks." },
      { title: "Uncertainty", body: "Monte Carlo and surrogate models for parameter studies." },
      { title: "Ontology links", body: "Connect models to OWL2 ontologies with SPARQL queries." },
      { title: "Multi-scale", body: "Project biochemical networks into Modelica." },
    ],
    workflow: [
      { label: "Import", detail: "SBML L2 / L3" },
      { label: "Annotate", detail: "OWL2 ontologies" },
      { label: "Simulate", detail: "ODE kinetics" },
      { label: "Analyze", detail: "Monte Carlo & surrogates" },
    ],
    cli: ["msx lint ./models --format json", "msx mc Pathway pathway.mo", "msx surrogate Pathway pathway.mo"],
  },
];

export const INDUSTRY_BY_SLUG: Record<string, Industry> = Object.fromEntries(INDUSTRIES.map((i) => [i.slug, i]));
