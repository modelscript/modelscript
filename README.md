<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

[![CI/CD](https://github.com/modelscript/modelscript/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/modelscript/modelscript/actions/workflows/ci.yml)
[![npm @modelscript/cli](https://img.shields.io/npm/v/@modelscript/cli?label=cli)](https://www.npmjs.com/package/@modelscript/cli)
[![Docker API CE](https://img.shields.io/badge/ghcr.io-api--ce-blue?logo=docker)](https://ghcr.io/modelscript/api-ce)
[![Docker API EE](https://img.shields.io/badge/ghcr.io-api--ee-blue?logo=docker)](https://ghcr.io/modelscript/api-ee)
[![Docker Web](https://img.shields.io/badge/ghcr.io-web-blue?logo=docker)](https://ghcr.io/modelscript/web)
[![Docker Appliance](https://img.shields.io/badge/ghcr.io-appliance-blue?logo=docker)](https://ghcr.io/modelscript/appliance)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/modelscript.modelscript?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript)
[![Open VSX](https://img.shields.io/open-vsx/v/modelscript/modelscript?label=Open%20VSX&logo=eclipseide)](https://open-vsx.org/extension/modelscript/modelscript)

ModelScript is a Web-native, polyglot compiler & engineering intelligence platform that unifies **81 open standards and industrial simulation formats** — spanning systems engineering & optimization (ModelScript, Modelica, AMPL, SysML v2, SSP, ReqIF, NIST OSCAL, OWL 2, CSV), power, RF, telecommunications & electronics (PSCAD, PSS/E, CIM / CGMES, OpenDSS, DIgSILENT PowerFactory, GE PSLF, OCPP, OpenADR, SPICE, Verilog-A, IBIS, Touchstone, Optical Transport, RAN & Microwave, Fiber Outside Plant), fluid/process, subsurface, civil water & nuclear (OLGA, PipelineStudio, Aspen Plus, gPROMS, ECLIPSE, EPANET, SWMM, RELAP5, EnergyPlus, HEC-RAS, TOUGH, MODFLOW, LandGEM), multibody/automotive/robotics/rail & transit (ADAMS, SIMPACK, GENSYS, GT-SUITE, SIMA, URDF, OpenDRIVE, OpenSCENARIO, AUTOSAR, GTFS, PLCopen, AutomationML), aerospace & controls (Simulink, EASY5, JSBSim, ROCETS, CCSDS), 3D CAD/CAE & metrology (STEP, ISO 23952 QIF, OpenSCAD, OpenUSD, CalculiX FEA, SU2 CFD), chemistry & systems/synthetic biology (SBML, Antimony, Cantera, SMILES/SDF, NMTRAN, SBOL3, BioNetGen, SED-ML, PDB/mmCIF, GenBank/FASTA, PHREEQC, Fortran, C99), and radiology, radiation oncology & computer-assisted surgery (OpenSim, DICOM-RT, CellML, FEBio/SOFA, NIfTI/NRRD, TOPAS/GATE, 3MF Medical, OpenIGTLink/PLUS) — into a continuous digital thread for end-to-end design, simulation, formal verification, and compliance auditing.

---

## Architecture Highlights

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ModelScript Digital Thread                               │
├──────────────────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┤
│ SysML v2 / ReqIF │ Modelica / SSP  │ STEP / QIF / CAD│ Power / Fluids  │ Bio / Medical / │
│  OSCAL / OWL 2   │ Simulink / EASY5│  (OpenSCAD/FEA) │ (PSCAD/OLGA/+)  │ Aero / Robotics │
└────────┬─────────┴────────┬────────┴────────┬────────┴────────┬────────┴────────┬────────┘
         │                  │                 │                 │                 │
         ▼                  ▼                 ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                 Native WebAssembly GLR Incremental Parsers & CST Arenas                  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                  Polyglot Triple Graph Grammars (TGG) & AOT Rewriting                    │
│           (Bidirectional forward/backward propagation & Critical Pair Analysis)          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                      Salsa Query Engine & Workspace Symbol Index                         │
│                    (Incremental memoization, dependency invalidation)                    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                       Semantic Theory Coordinator (Nelson-Oppen)                         │
│   Ontology ─── Constraint/Arithmetic ─── Abstract Domains ─── Continuous Safety ─── CAD  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                        Data-Oriented DAE Arena & Solvers                                 │
│   DAEBuilder ── BLT ── SUNDIALS CVODE/IDA ── WebGPU Batched ── Direct Collocation Opt    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Polyglot Triple Graph Grammars (TGG)

ModelScript features a declarative, AOT-compiled **Triple Graph Grammar (TGG)** and Double-Pushout (DPO) graph rewriting engine (`@modelscript/dsl/tgg`). Rather than relying on fragile manual point-to-point synchronizers, TGG rules declaratively define correspondences between source, target, and correspondence graphs. The engine compiles these rules into high-performance AssemblyScript dispatch tables in WebAssembly (`tgg_forward_dispatch`, `tgg_backward_dispatch`, `tgg_propagate_all_stale`), verified for confluence and termination via integrated **Critical Pair Analysis (CPA)**.

### 2. Semantic Theory Coordinator (Nelson-Oppen Multi-Solver)

Cross-domain verification is orchestrated by a generalized **Nelson-Oppen Semantic Theory Coordinator** (`@modelscript/runtime/formal/theory_coordinator`), exchanging equality facts, tight numeric intervals, and conflict clauses across **13 domain theory oracles** with CDCL(T) case splitting:

- **Ontology Domain (`OntologyTheoryOracle`)**: Tableau Description Logic (DL) reasoner, OWL2 bundle closure, BFO ISO/IEC 21838-2 upper-level semantic alignment (`SemanticProjector`), concept subsumption, and scoped disjointness.
- **Constraint Domain (`ConstraintTheoryOracle`)**: Non-linear interval contraction via HC4 contractor, DPLL(T) arithmetic solver, and variable domain bounding.
- **Abstract Domain (`AbstractDomainOracle`)**: Octagon Difference Bound Matrices (DBM), 4D spatio-temporal intervals, and relational numerical bounds.
- **Continuous Safety & Reliability Domain (`ContinuousSafetyOracle` / `SafetyTheoryOracle`)**: Reachability analysis via zonotopes, constrained zonotopes, star sets, Sum-of-Squares (SOS) barrier certificates, Fault Tree Analysis (FTA), Minimal Cut Sets (MCS), and ISO 26262 / DO-178C safety metrics.
- **Dynamic Simulation Domain (`DynamicSimulationOracle`)**: DAE numerical trajectory integration, Signal Temporal Logic (STL) quantitative robustness monitoring, and tolerance propagation.
- **Spatial Physics Domain (`SpatialPhysicsOracle`)**: Watertight B-Rep CAD solid query, collision/clearance checks, geometric mass properties, 3D verification overlays (reachability tubes, SOS barrier shells, clearance vectors), and 3D FEA/CFD field coupling.
- **CAE Contract Domain (`CaeContractOracle`)**: FEA structural stress/deflection and CFD aerodynamic performance contract verification synchronized with the Digital Thread hypergraph.
- **Causalization Domain (`CausalizationOracle`)**: Pantelides Index-1 structural non-singularity, algebraic loop solvability, and Nyquist-Shannon sampling stability verification.
- **Dimensional Domain (`DimensionalOracle`)**: ISO 80000 7-element rational exponent vector (`[L, M, T, I, Θ, N, J]`) dimensional homogeneity, unit consistency, and cross-domain polyglot drift checking (`checkPolyglotPhysicalDrift`).
- **Entailment Domain (`EntailmentOracle`)**: V-Model requirements decomposition completeness proving ($\bigwedge R_{\text{child},i} \models R_{\text{parent}}$) with signed proof manifest generation.
- **Flow Algebra Domain (`FlowAlgebraOracle`)**: SysML v2 / KerML conjugated port involution (`~Port`), Kirchhoff conservative flow balancing, and 1D–3D CFD boundary flux coupling.
- **Tolerance Stack & UQ Domains (`ToleranceStackOracle`, `UqOracle`)**: STEP AP242 GD&T 1D/3D tolerance chain evaluation (Worst-Case, RSS, Six-Sigma $C_{pk}$) and stochastic Uncertainty Quantification via analytical CDFs and Monte Carlo sampling.
- **Radiology & Surgical CAS Domain (`RadiologyCasTheoryOracle`)**: QUANTEC organ-at-risk (OAR) radiotherapy DVH/BED/EQD2 dose constraints, Hadrontherapy Bragg peak range verification, $SE(3)$ surgical navigation transform orthogonality, Fitzpatrick Target Registration Error ($\text{TRE}$), and 2-manifold patient-specific cutting guide safety checks.

### 3. Data-Oriented Linear Memory Simulation (DAE Arena)

The simulation runtime employs a zero-allocation Struct-of-Arrays (SoA) layout (`DAEBuilder`) in linear WebAssembly memory. Equations, variables, and expressions are lowered directly from linear parser CST nodes into integer arena handles, enabling microsecond Pantelides index reduction, Tarjan BLT partition sorting, alias elimination, Implicitly Restarted Arnoldi sparse eigenvalue extraction, and SIMD/WebGPU batched numerical solving without garbage collection overhead.

### 4. Salsa-Based Incremental Computation

Inspired by Rust's Salsa, compilation, name resolution, and specialized class instances are fully memoized on a demand-driven dependency graph. When an engineer modifies a single equation or parameter, only transitively affected queries and DAE blocks are re-flattened.

---

## Supported Languages & Domain Capabilities (91 Languages)

ModelScript provides first-class support for **91 engineering languages and simulation formats** under `languages/`, organized across 8 domain clusters and powered by native WebAssembly parsers, linear-memory CST arenas, static pre-flight linters, and direct `DAEBuilder` lowering.

> **Maturity Tiers** (enforced in `package.json#modelscript.tier` via `npm run lint:manifests` and audited via `npm run audit:languages`):
>
> - **`Stable` (24 languages)** — Production-ready with complete WASM GLR parser, static linter, DAE/solver lowering, and $\ge 8$ test suites verified against standard industry benchmarks or standard library snapshots (e.g., OpenModelica & MSL 4.1.0, OMG KerML standard library, IEEE/WECC power grids, US EPA EPANET/SWMM, Manchester Benchmark / EN 14363, NASA ROCETS / CCSDS).
> - **`Beta` (67 languages)** — Domain-complete with native WASM parser, static domain linter, `DAEBuilder`/solver lowering, and $\ge 5$ unit/integration and benchmark test suites.
> - **`Preview` (0 languages)** — All 91 language packages meet or exceed `Beta` and `Stable` 6-pillar verification thresholds.

### 1. Native & Core Systems Engineering (9)

| Language & Directory                                                    | Extensions             | Maturity | Domain & Core Capabilities                                                                                                                                                                                                                                           |
| :---------------------------------------------------------------------- | :--------------------- | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ModelScript**<br>[`languages/modelscript/`](./languages/modelscript/) | `.msx`                 | `Stable` | Unified declarative multi-domain language combining acausal physical equations, hierarchical state machines, spatial CAD constraints, and direct compilation to the WebAssembly DAE arena.                                                                           |
| **Modelica**<br>[`languages/modelica/`](./languages/modelica/)          | `.mo`                  | `Stable` | Complete Modelica 3.x equation-based modeling; native AssemblyScript flattening kernel (`ModelicaFlattener`) supporting `hybrid`, `wasm`, `ts`, and `diff` modes; connector balancing; BLT partitioning; and OMC conformance.                                        |
| **AMPL**<br>[`languages/ampl/`](./languages/ampl/)                      | `.mod`, `.dat`, `.nl`  | `Stable` | Algebraic modeling language for mathematical optimization (LP, MILP, NLP, MINLP), relational set and multidimensional array unrolling, automatic differentiation tape lowering, ASL `.nl` / MPS interchange, and native COIN-OR (CLP/CBC/IPOPT) WebAssembly solving. |
| **SysML v2 / KerML**<br>[`languages/sysml2/`](./languages/sysml2/)      | `.sysml`, `.kerml`     | `Stable` | OMG Systems Modeling Language v2 & KerML parsing, standard library snapshot, structural part/port definitions, state machine & fUML activity execution, decision table verification, and requirements allocation.                                                    |
| **SSP 1.0**<br>[`languages/ssp/`](./languages/ssp/)                     | `.ssp`, `.ssd`, `.ssv` | `Stable` | System Structure and Parameterization standard packaging, multi-FMU co-simulation topologies (`SystemStructure.ssd`), parameter value catalogs (`.ssv`), and signal dictionary mappings (`.ssm`).                                                                    |
| **ReqIF**<br>[`languages/reqif/`](./languages/reqif/)                   | `.reqif`, `.reqifz`    | `Stable` | OMG Requirements Interchange Format v1.2 parsing, `SPEC-OBJECTS` / `SPEC-RELATIONS` traceability graph extraction, suspect-link detection, and bidirectional SysML v2 requirement synchronization.                                                                   |
| **NIST OSCAL**<br>[`languages/oscal/`](./languages/oscal/)              | `.json`, `.xml`        |  `Beta`  | NIST Open Security Controls Assessment Language (OSCAL 1.1.x) parsing, SP 800-53 rev 5 catalog baseline resolution, Cyber-Physical Systems (CPS) security control mapping, and regulatory compliance verification.                                                   |
| **OWL 2**<br>[`languages/owl2/`](./languages/owl2/)                     | `.owl`, `.ofn`         | `Stable` | W3C OWL 2 Functional-Style Syntax parsing, Tableau Description Logic (DL) reasoning, BFO ISO/IEC 21838-2 alignment, concept subsumption, Manchester syntax rendering, OWL 2 DL/EL profile linting, and SPARQL-DL querying.                                           |
| **CSV**<br>[`languages/csv/`](./languages/csv/)                         | `.csv`                 | `Stable` | High-throughput tabular data parsing, RFC 4180 structural linting, experimental sensor telemetry ingestion, trajectory regression comparison, and parameter calibration datasets.                                                                                    |

### 2. Electrical Power Grids, RF, Telecommunications & Electronics (22)

| Language & Directory                                                       | Extensions                         | Maturity | Domain & Core Capabilities                                                                                                                                                                                                                                                                                 |
| :------------------------------------------------------------------------- | :--------------------------------- | :------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSCAD**<br>[`languages/pscad/`](./languages/pscad/)                      | `.pscx`, `.pslx`, `.psout`         | `Stable` | Electromagnetic transient (EMT) parsing, Dommel companion-circuit & Bergeron traveling-wave line simulation, Gustavsen-Semlyen rational Vector Fitting, RMS-vs-EMT Phase-Mode Ratio (PMR) benchmarking, IEEE 2800-2022 ride-through verification, COMTRADE `.cfg`/`.dat` I/O, and Modelica/SLD projection. |
| **ATP-EMTP**<br>[`languages/atp/`](./languages/atp/)                       | `.atp`, `.dat`                     |  `Beta`  | Alternative Transients Program (ATP-EMTP) card-deck parsing, Dommel companion-matrix trapezoidal transient integration, time-controlled breaker switches, and DAE arena lowering.                                                                                                                          |
| **PSS/E**<br>[`languages/psse/`](./languages/psse/)                        | `.raw`, `.dyr`                     | `Stable` | PSS/E v33/v34 transmission grid parsing, Newton-Raphson AC power flow, WebGPU 70k-bus N-1 ACCC contingency screening, IEEE C37.118 PMU hybrid playback & `.dyr` calibration, WECC collector equivalencing, NERC PRC-019/024/025 protection auditing, and Single-Line Diagram (SLD) synthesis.              |
| **CIM / CGMES**<br>[`languages/cgmes/`](./languages/cgmes/)                | `.xml`, `.rdf`                     |  `Beta`  | ENTSO-E Common Grid Model Exchange Standard (CGMES v2.4.15/v3.0 / IEC 61970) RDF/XML parsing (EQ/TP/SSH/SV), node-breaker topology processing, PSS/E base case projection, and OpenIPSL Modelica synthesis.                                                                                                |
| **OpenDSS**<br>[`languages/opendss/`](./languages/opendss/)                | `.dss`                             |  `Beta`  | EPRI OpenDSS unbalanced multi-phase distribution network parsing, multi-phase Y-bus & forward-backward sweep power flow, short-circuit, IEEE 519 harmonics, TCC protection, FLISR, VVO, DER hosting capacity analysis, and Modelica projection.                                                            |
| **PowerFactory**<br>[`languages/powerfactory/`](./languages/powerfactory/) | `.dz`, `.pfd`, `.xml`, `.dsl`      |  `Beta`  | DIgSILENT PowerFactory project archive, XML object models, union-find breaker reduction, IEC 60909 short-circuit corrections, DSL transfer function compiler, SLD heatmap rendering, and PSS/E / Modelica projection.                                                                                      |
| **GE PSLF**<br>[`languages/pslf/`](./languages/pslf/)                      | `.epc`, `.dyd`                     |  `Beta`  | GE PSLF power flow (`.epc`) and dynamic simulation (`.dyd`) parsing, WECC renewable/synchronous dynamic model mapping, bidirectional PSS/E projection, and topology linter.                                                                                                                                |
| **MATPOWER**<br>[`languages/matpower/`](./languages/matpower/)             | `.m`, `.matpower`                  |  `Beta`  | MATPOWER AC/DC power flow and optimal power flow (OPF) case parsing, lossless bidirectional PSS/E projection, linear-memory DAE arena lowering, and grid benchmark solving.                                                                                                                                |
| **ASPEN OneLiner**<br>[`languages/oneliner/`](./languages/oneliner/)       | `.olx`, `.dxt`                     |  `Beta`  | ASPEN OneLiner / CAPE short-circuit & relay coordination deck parsing, symmetrical component fault analysis (3-phase/SLG), IEEE C37.112 TOC curves, breaker rating checks, and DAE lowering.                                                                                                               |
| **SEL Relay Settings**<br>[`languages/sel/`](./languages/sel/)             | `.rcf`, `.rdb`, `.sel`, `.txt`     |  `Beta`  | Schweitzer Engineering Laboratories (SEL) relay settings parsing (SEL-311/411/751/700), IEEE C37.112 TOC curves, multi-zone distance reach, SELogic equation solver, and DAE lowering.                                                                                                                     |
| **COMTRADE**<br>[`languages/comtrade/`](./languages/comtrade/)             | `.cfg`, `.dat`, `.cff`             |  `Beta`  | IEEE C37.111 / IEC 60255-24 transient & disturbance recording parsing, sliding 1-cycle DFT dynamic phasor extraction, fault playback lowering to linear-memory `DAEBuilder` arena, and CFF container serialization.                                                                                        |
| **IEC 61850 SCL**<br>[`languages/scl/`](./languages/scl/)                  | `.scd`, `.cid`, `.icd`, `.ssd`     |  `Beta`  | IEC 61850 Substation Configuration Language (SCL Ed. 2.1) parsing, GOOSE & Sampled Values communication stream validation, Type 1A trip latency verification, node-breaker SLD projection, and DAE arena automation lowering.                                                                              |
| **DNP3 / IEEE 1815**<br>[`languages/dnp3/`](./languages/dnp3/)             | `.dnp3`, `.xml`, `.json`           |  `Beta`  | IEEE Std 1815-2012 / DNP3 SCADA device profile parsing (XML/JSON), RTU/PLC point list compilation (BI/BO/AI/AO/CTR), analog deadband event filtering, engineering unit scaling, and DAE arena lowering.                                                                                                    |
| **OCPP**<br>[`languages/ocpp/`](./languages/ocpp/)                         | `.ocpp`, `.ocpp.json`, `.cpo`      |  `Beta`  | Open Charge Point Protocol (OCPP 2.0.1 / 1.6J) EV public charging & smart charging profile parsing, transformer power capacity allocation, and DAE lowering.                                                                                                                                               |
| **OpenADR**<br>[`languages/openadr/`](./languages/openadr/)                | `.oadr`, `.oadr.xml`, `.oadr.json` |  `Beta`  | Open Automated Demand Response (OpenADR 2.0b / 3.0) grid flexibility, dynamic pricing, and curtailment dispatch package for ModelScript.                                                                                                                                                                   |
| **SPICE**<br>[`languages/spice/`](./languages/spice/)                      | `.cir`, `.sp`, `.spice`            | `Stable` | Berkeley SPICE / LTspice / Ngspice netlist parsing, Modified Nodal Analysis (MNA) conservation lowering (`DAEBuilder`), MOSFET/BJT/diode device models, floating node & voltage-loop linting, and Modelica projection.                                                                                     |
| **Verilog-A**<br>[`languages/verilog-a/`](./languages/verilog-a/)          | `.va`, `.vams`                     |  `Beta`  | Accellera Verilog-A / Verilog-AMS analog behavioral hardware description parsing, `discipline`/`nature` extraction, branch contribution (`V(p,n) <+ ...`, `I(p,n) <+ ddt(...)`) lowering to DAE arena, and Modelica export.                                                                                |
| **IBIS**<br>[`languages/ibis/`](./languages/ibis/)                         | `.ibs`                             |  `Beta`  | ANSI/EIA-656-B I/O Buffer Information Specification parsing, piecewise-linear pullup/pulldown & clamping diode I/V curve interpolation, dynamic output impedance & signal integrity eye analysis, monotonicity linting, and DAE lowering.                                                                  |
| **Touchstone**<br>[`languages/touchstone/`](./languages/touchstone/)       | `.s1p`–`.s32p`, `.ts2`             |  `Beta`  | Touchstone v1.0/v2.0 N-port S/Y/Z network parameter parsing, spectral norm passivity verification ($\|\mathbf{S}(f)\|_2 \le 1$), Gustavsen-Semlyen rational Vector Fitting to state-space $(\mathbf{A},\mathbf{B},\mathbf{C},\mathbf{D})$, and DAE macromodel lowering.                                    |
| **Optical Transport**<br>[`languages/optical/`](./languages/optical/)      | `.sor`, `.json`                    |  `Beta`  | Telcordia/Bellcore Standard Optical Report (GR-196/SR-4731 `.sor`) binary OTDR trace codec, OpenROADM MSA & GNPy DWDM topology parsing, RWA & EDFA tilt modeling, multi-span power budget and GSNR evaluation, and fiber event localization.                                                               |
| **RAN & Microwave**<br>[`languages/ran/`](./languages/ran/)                | `.adf`, `.pat`, `.msi`             |  `Beta`  | NSMA WG16 (`.adf`/`.nsma`) & Planet (`.pat`/`.msi`) antenna pattern parsing, 3GPP 5G NR / LTE coverage & PCI planning, FCC OET-65 / ICNIRP RF MPE exclusion zones, FAA Part 77 / ICAO / ITU siting clearance, and BBU/RRH thermal DAE lowering.                                                            |
| **Fiber Outside Plant**<br>[`languages/fiber/`](./languages/fiber/)        | `.geojson`, `.kml`                 |  `Beta`  | Optical fiber outside plant (OSP) cadastre parsing, ANSI/TIA-598-D 12-color strand/tube resolution, NESC C2 Rule 250B/C/D aerial catenary sag-tension solver, bidirectional OTDR-to-GIS fault localization, and thermal-mechanical strain DAE lowering.                                                    |

### 3. Fluid, Process, Subsurface, Civil Water & Nuclear Thermal-Hydraulics (15)

| Language & Directory                                                 | Extensions                                     | Maturity | Domain & Core Capabilities                                                                                                                                                                                                                                      |
| :------------------------------------------------------------------- | :--------------------------------------------- | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OLGA**<br>[`languages/olga/`](./languages/olga/)                   | `.opi`, `.olga`, `.key`                        | `Stable` | Multiphase dynamic flow assurance parsing, 1D two-fluid / drift-flux hydrodynamic simulation, severe slugging (Bøe/Pots), hydrate/wax/asphaltene & NACE MR0175 sour corrosion verification, and SysML/Modelica projection.                                      |
| **PipelineStudio (LPS)**<br>[`languages/lps/`](./languages/lps/)     | `.lps`, `.tgx`, `.tlx`                         | `Stable` | Gas and liquid transmission pipeline network parsing, Colebrook-White steady-state hydraulics, linepack inventory, isothermal Euler transient surge simulation, ASME B31.4/B31.8 MAOP checks, and Modelica projection.                                          |
| **Aspen Plus**<br>[`languages/aspen/`](./languages/aspen/)           | `.in`, `.inp`, `.bkp`                          |  `Beta`  | Chemical process flowsheet parsing, Rachford-Rice isothermal vapor-liquid equilibrium (VLE) flash solving, RadFrac distillation stage balances, tear-stream convergence linting, and Modelica fluid process projection.                                         |
| **IWA ASM**<br>[`languages/asm/`](./languages/asm/)                  | `.asm`, `.bsm`, `.wrrf`                        |  `Beta`  | IWA Activated Sludge Models (ASM1, ASM2d, ASM3, ADM1) biokinetics, Petersen matrix stoichiometric rates, BSM1 wastewater benchmark, Takács 10-layer clarifier sedimentation, and DAE arena lowering.                                                            |
| **OGC WaterML**<br>[`languages/waterml/`](./languages/waterml/)      | `.waterml`, `.wml2`, `.xml`, `.json`           |  `Beta`  | OGC WaterML 2.0 / TimeseriesML hydrologic telemetry parsing (XML/JSON), stage-discharge rating curve fitting ($Q=a(h-h_0)^b$), HEC-RAS flow hydrograph / EPANET pattern projections, and DAE lowering.                                                          |
| **ECLIPSE**<br>[`languages/eclipse/`](./languages/eclipse/)          | `.data`, `.dat`, `.inc`                        |  `Beta`  | ECLIPSE-compatible 100/300 black-oil reservoir deck parsing (`RUNSPEC`, `GRID`, `PROPS`, `SOLUTION`, `SCHEDULE`), multiphase Darcy depletion & Peaceman wellbore inflow solver, PVT table linting, and DAE lowering.                                            |
| **EPANET**<br>[`languages/epanet/`](./languages/epanet/)             | `.inp`                                         | `Stable` | US EPA pressurized municipal water distribution network parsing, Todini & Pilati Global Gradient Method (GGM), MOC water-hammer transients, chlorine/DBP water quality, GeoJSON GIS ingestion, US EPA LCRR/LCRI compliance export, and DAE/Modelica projection. |
| **SWMM**<br>[`languages/swmm/`](./languages/swmm/)                   | `.inp`                                         | `Stable` | US EPA Storm Water Management Model v5 urban drainage parsing, Manning open-channel & Saint-Venant dynamic wave routing, LID sizing, GeoJSON GIS ingestion, US EPA NPDES NetDMR CSO/SSO compliance export, and DAE/Modelica projection.                         |
| **RELAP5-3D**<br>[`languages/relap5/`](./languages/relap5/)          | `.i`, `.inp`, `.r5`                            | `Stable` | US NRC nuclear reactor thermal-hydraulics deck parsing (hydrodynamic volumes, junctions, heat structures, trips), in-WASM 6-group delayed neutron point-kinetics solver with Doppler/moderator feedback, and DAE lowering.                                      |
| **EnergyPlus**<br>[`languages/energyplus/`](./languages/energyplus/) | `.idf`, `.epjson`                              |  `Beta`  | US DOE building energy simulation parsing (`Zone`, `Material`, `Construction`, 3D `BuildingSurface:Detailed`), polygon convexity & interzone surface linting, multi-zone RC thermal network DAE lowering, and Modelica sync.                                    |
| **HEC-HMS**<br>[`languages/hec-hms/`](./languages/hec-hms/)          | `.basin`, `.hms`, `.met`                       |  `Beta`  | USACE HEC-HMS watershed rainfall-runoff hydrology, SCS Curve Number loss, unit hydrograph convolution, Muskingum channel routing, HEC-RAS `.u01` unsteady boundary flow export, and DAE lowering.                                                               |
| **HEC-RAS**<br>[`languages/hec-ras/`](./languages/hec-ras/)          | `.g01`–`.g99`, `.u01`, `.f01`, `.prj`          |  `Beta`  | USACE HEC-RAS 1D/2D river hydraulics, open-channel cross sections, standard-step backwater curves, and Saint-Venant DAE lowering.                                                                                                                               |
| **TOUGH**<br>[`languages/tough/`](./languages/tough/)                | `.tough`, `.dat`, `.inp`                       |  `Beta`  | LBNL TOUGH2/TOUGH3 non-isothermal multiphase flow in fractured porous media, geothermal reservoirs, grid block connectivity (`ELEME`/`CONNE`), and mass-energy balance DAE lowering.                                                                            |
| **MODFLOW**<br>[`languages/modflow/`](./languages/modflow/)          | `.dis`, `.npf`, `.wel`, `.riv`, `.chd`, `.nam` |  `Beta`  | USGS MODFLOW 6 multi-layer aquifer groundwater flow, structured grid discretization, Darcy conductances, well abstraction, and river exchange DAE lowering.                                                                                                     |
| **LandGEM**<br>[`languages/landgem/`](./languages/landgem/)          | `.landgem`, `.lfg`, `.biogas`                  |  `Beta`  | US EPA LandGEM landfill gas first-order decay methane kinetics, anaerobic digestion (ADM1) CSTR biochemical balances, and RNG / CHP power recovery DAE lowering.                                                                                                |

### 4. Multibody, Automotive, Robotics, Marine & Rail (10)

| Language & Directory                                                       | Extensions                | Maturity | Domain & Core Capabilities                                                                                                                                                                                                       |
| :------------------------------------------------------------------------- | :------------------------ | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adams**<br>[`languages/adams/`](./languages/adams/)                      | `.adm`, `.cmd`, `.acf`    | `Stable` | Multibody dynamics deck & command script parsing, Grübler-Kutzbach mobility & redundant constraint analysis, IMPACT contact and bushing force lowering to `DAEBuilder`, and `Modelica.Mechanics.MultiBody` projection.           |
| **SIMPACK**<br>[`languages/simpack/`](./languages/simpack/)                | `.spck`, `.sim`, `.fbi`   |  `Beta`  | Multibody systems & Craig-Bampton flexible body (`.fbi`) parsing, in-WASM spatial kinematics, Baumgarte stabilization & Newton-Raphson kinematic loop closure, Berg hydro-mount bushing model, and DAE/Modelica projection.      |
| **GENSYS**<br>[`languages/gensys/`](./languages/gensys/)                   | `.calc`, `.run`, `.trax`  | `Stable` | Railway vehicle dynamics & track geometry parsing, in-WASM SIMD Kalker FASTSIM & Polach creep force solvers, UIC60/S1002 wheel-rail contact, ERRI/FRA track PSD synthesis, EN 14067-6 cross-wind, and EN 14363 homologation.     |
| **GT-SUITE**<br>[`languages/gtsuite/`](./languages/gtsuite/)               | `.gtm`, `.gtx`, `.gtd`    |  `Beta`  | 1D powertrain and engine deck parsing, Wiebe combustion burn rate, Woschni heat transfer, slider-crank kinematics, turbocharger maps, 1D gas dynamics solver, and Modelica/SSP export.                                           |
| **SIMA**<br>[`languages/sima/`](./languages/sima/)                         | `.sima`, `.stask`, `.sys` |  `Beta`  | SIMO/RIFLEX-compatible offshore marine card deck & archive parsing, Cummins 6-DOF floater dynamics, analytical inelastic catenary mooring solver, DNV-OS-E301 tension safety factor verification, and polar spread diagrams.     |
| **URDF / SDF**<br>[`languages/urdf/`](./languages/urdf/)                   | `.urdf`, `.sdf`, `.world` | `Stable` | ROS 2 Robot Description Format & Gazebo SDF parsing, kinematic tree & triangle-inequality inertia tensor validation, Newton-Euler rigid-body DAE lowering, and `Modelica.Mechanics.MultiBody` projection.                        |
| **OpenDRIVE**<br>[`languages/opendrive/`](./languages/opendrive/)          | `.xodr`                   | `Stable` | ASAM OpenDRIVE v1.4–v1.8 road network parsing, analytical clothoid (Euler spiral), arc, and cubic polynomial reference line evaluation, $C^1$ heading continuity verification, and 6-DOF vehicle road-tire DAE lowering.         |
| **OpenSCENARIO**<br>[`languages/openscenario/`](./languages/openscenario/) | `.xosc`, `.osc`           |  `Beta`  | ASAM OpenSCENARIO v1.x XML & v2.0 DSL autonomous driving scenario parsing, closed-loop actor maneuver/trigger simulation, Time-to-Collision (TTC) & IEEE 2846 RSS longitudinal safety margin verification, and DAE lowering.     |
| **AUTOSAR**<br>[`languages/autosar/`](./languages/autosar/)                | `.arxml`                  |  `Beta`  | AUTOSAR Classic & Adaptive R22-11 `.arxml` parsing, Software Component (`SWC`), Sender/Receiver & Client/Server port interface validation, runnable WCET utilization & CAN/FlexRay PDU bit-packing linting, and Modelica export. |
| **GTFS**<br>[`languages/gtfs/`](./languages/gtfs/)                         | `.gtfs`, `.gtfs-rt`       |  `Beta`  | General Transit Feed Specification transit routes, stop times, e-Bus kinematic traction power, and depot charging DAE lowering.                                                                                                  |

### 5. Aerospace, Flight Dynamics, Astrodynamics & Controls (7)

| Language & Directory                                                       | Extensions                      | Maturity | Domain & Core Capabilities                                                                                                                                                                                                          |
| :------------------------------------------------------------------------- | :------------------------------ | :------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulink**<br>[`languages/simulink/`](./languages/simulink/)             | `.slx`, `.mdl`                  |  `Beta`  | Simulink-compatible `.slx` (OPC ZIP XML) and legacy `.mdl` block diagram parsing, Stateflow chart extraction, algebraic loop & sample-time hit linting, direct lowering to `DAEBuilder`, and `Modelica.Blocks` projection.          |
| **EASY5**<br>[`languages/easy5/`](./languages/easy5/)                      | `.ez5`, `.ezm`, `.dat`          | `Stable` | EASY5-compatible schematic & macro library parsing, continuous/discrete control block topology extraction, state-space linearization ($A, B, C, D$), Bode/Nyquist frequency response, and Modelica/SSP export.                      |
| **JSBSim**<br>[`languages/jsbsim/`](./languages/jsbsim/)                   | `.xml`                          |  `Beta`  | JSBSim 2.0 6-DOF flight dynamics model (`<fdm_config>`) parsing, ISA atmosphere & aerodynamic coefficient evaluation, flight control system (FCS) channel validation, RK4 trajectory integration, and Modelica projection.          |
| **ROCETS**<br>[`languages/rocets/`](./languages/rocets/)                   | `.roc`, `.inp`, `.deck`         | `Stable` | NASA liquid rocket engine propulsion deck parsing, cryogenic turbopump/turbine shaft power balance cycle solver, injector/regenerative cooling jacket pressure drop, transient startup/shutdown simulation, and DAE lowering.       |
| **CCSDS / XTCE**<br>[`languages/ccsds/`](./languages/ccsds/)               | `.oem`, `.opm`, `.omm`, `.xtce` | `Stable` | CCSDS Orbit Ephemeris/Parameter/Mean-Elements KVN & OMG XTCE satellite telemetry parsing, 6-DOF Cowell orbit propagator ($J_2$ oblateness, drag, solar radiation pressure), bit-packing overlap linting, and SysML/Modelica export. |
| **PLCopen IEC 61131-3**<br>[`languages/plcopen/`](./languages/plcopen/)    | `.st`, `.iec`, `.plcxml`        |  `Beta`  | IEC 61131-3 Structured Text (`.st`) and PLCopen TC6 XML (`.plcxml`) industrial control parsing, deterministic scan-cycle state machine lowering to synchronous clocked DAE equations, and `Modelica_Synchronous` export.            |
| **AutomationML**<br>[`languages/automationml/`](./languages/automationml/) | `.aml`                          |  `Beta`  | IEC 62714 AutomationML (CAEX 2.15/3.0) mechatronic plant topology parsing, virtual commissioning connector validation, co-simulation orchestration bridge, and PLCopen/Modelica projection.                                         |

### 6. 3D CAD, Digital Metrology & Continuum Physics — FEA / CFD / QIF (6)

| Language & Directory                                           | Extensions                      | Maturity | Domain & Core Capabilities                                                                                                                                                                                                             |
| :------------------------------------------------------------- | :------------------------------ | :------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STEP (ISO 10303)**<br>[`languages/step/`](./languages/step/) | `.step`, `.stp`, `.p21`         |  `Beta`  | ISO 10303-21 (AP203/AP214/AP242) Clear Text Encoding parsing, B-Rep topological entity graph traversal, assembly hierarchy extraction, GD&T datum/tolerance validation, and solid volume/centroid integration.                         |
| **QIF (ISO 23952)**<br>[`languages/qif/`](./languages/qif/)    | `.qif`, `.xml`                  |  `Beta`  | Quality Information Framework (QIF 3.0) digital metrology parsing, ASME Y14.5 / ISO 1101 GD&T datum evaluation, STEP AP242 CAD feature association, and Statistical Process Control ($C_p, C_{pk}$) calculation.                       |
| **OpenSCAD**<br>[`languages/scad/`](./languages/scad/)         | `.scad`                         | `Stable` | Constructive Solid Geometry (CSG) AST evaluation, 3D boolean transformations (`union`, `difference`, `intersection`, `hull`), parametric dimension extraction, surgical AST writeback, and STEP/Modelica CAD synchronisation.          |
| **OpenUSD**<br>[`languages/usd/`](./languages/usd/)            | `.usd`, `.usda`, `.usdz`        |  `Beta`  | Alliance for OpenUSD digital twin scene description, UsdPhysics rigid-body & joint kinematics, 64-byte aligned USDZ archiver, semantic linter (`USD_*`), and linear WebAssembly `DAEBuilder` lowering.                                 |
| **FEA**<br>[`languages/fea/`](./languages/fea/)                | `.fea`, `.inp`, `.bdf`          |  `Beta`  | CalculiX/Abaqus (`.inp`), Nastran (`.bdf`), and declarative `.fea` structural mesh setup, Tet4/Tet10 thermo-elastic stiffness assembly, von Mises stress recovery, and CAE boundary contract verification.                             |
| **CFD**<br>[`languages/cfd/`](./languages/cfd/)                | `.cfd`, `.cfg`, `.su2`, `.foam` |  `Beta`  | SU2 (`.cfg`/`.su2`), OpenFOAM (`.foam`), and declarative `.cfd` flow specification parsing, $y^+$ & Courant-Friedrichs-Lewy (CFL) mesh quality linting, WebGPU D3Q19 Lattice Boltzmann coupling, and aerodynamic drag/lift extraction. |

### 7. Chemistry, Systems/Synthetic Biology & Scientific Code (14)

| Language & Directory                                                | Extensions                        | Maturity | Domain & Core Capabilities                                                                                                                                                                                                              |
| :------------------------------------------------------------------ | :-------------------------------- | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SBML**<br>[`languages/sbml/`](./languages/sbml/)                  | `.sbml`, `.xml`                   |  `Beta`  | Systems Biology Markup Language (Level 2 / Level 3) parsing, compartment/species/reaction stoichiometry matrix construction, MathML & infix kinetic law evaluation, RK4 concentration ODE solver, and DAE/Modelica lowering.            |
| **Antimony**<br>[`languages/antimony/`](./languages/antimony/)      | `.ant`                            |  `Beta`  | Human-readable modular systems biology DSL (`model ... end`), submodel composition, rate/assignment rules, state-triggered events, RK4 integration, `DAEBuilder` lowering, and bidirectional SBML/Modelica projection.                  |
| **Cantera**<br>[`languages/cantera/`](./languages/cantera/)         | `.yaml`, `.cti`                   |  `Beta`  | Gas-phase chemical kinetics & combustion mechanisms, NASA-7 thermochemical polynomials ($C_p^\circ, H^\circ, S^\circ$), modified Arrhenius & Troe falloff rates, batch reactor ODE solver, and `DAEBuilder`/Modelica lowering.          |
| **SMILES / SDF**<br>[`languages/smiles/`](./languages/smiles/)      | `.smi`, `.smarts`, `.mol`, `.sdf` |  `Beta`  | Zero-regex SMILES/SMARTS & MDL Molfile V2000/SDF molecular graph parser, Hückel $4n+2$ aromaticity & valence linter, Joback & Reid group-contribution critical property estimator ($T_b, T_c, P_c, V_c, \omega$), and Aspen/DAE export. |
| **NMTRAN (NONMEM)**<br>[`languages/nmtran/`](./languages/nmtran/)   | `.ctl`, `.mod`                    |  `Beta`  | Pharmacometrics & clinical PK/PD control stream parser (`$PROBLEM`, `$SUBROUTINES ADVAN1..13`, `$PK`, `$DES`, `$THETA`, `$OMEGA`), multi-dose (`II`/`ADDL`) AUC/$C_{\max}$/$t_{1/2}$ solver, and `DAEBuilder`/Modelica lowering.        |
| **SBOL3**<br>[`languages/sbol/`](./languages/sbol/)                 | `.sbol`, `.ttl`                   |  `Beta`  | Synthetic Biology Open Language (SBOL3 RDF/XML & Turtle) genetic circuit parser, Sequence Ontology (`SO`) & SBO interaction verification, Hill transcriptional activation/repression ODE solver, and SBML/Modelica projection.          |
| **BioNetGen (BNGL)**<br>[`languages/bngl/`](./languages/bngl/)      | `.bngl`                           |  `Beta`  | Rule-based biochemical modeling of multiprotein complexes and site-specific phosphorylation (`L(r!1).R(l!1,Y~P)`), automated rule-expansion reaction network generation, RK4/observable solver, and SBML/Modelica/DAE lowering.         |
| **SED-ML**<br>[`languages/sedml/`](./languages/sedml/)              | `.sedml`                          |  `Beta`  | COMBINE Simulation Experiment Description Markup Language (L1V3/L1V4), KiSAO solver selection, uniform time-course & parameter-change execution, MathML `dataGenerator` post-processing, and Modelica experiment projection.            |
| **PDB / mmCIF**<br>[`languages/pdb/`](./languages/pdb/)             | `.pdb`, `.cif`                    |  `Beta`  | 3D macromolecular structural biology (`ATOM`, `HETATM`, `HELIX`, `SHEET`, `SSBOND`, `CONECT`, mmCIF `_atom_site`), Ramachandran $(\phi, \psi)$ torsion & steric clash linter, Gaussian Network Model (GNM) solver, and DAE lowering.    |
| **GenBank / FASTA**<br>[`languages/genbank/`](./languages/genbank/) | `.gb`, `.gbk`, `.fasta`           |  `Beta`  | Annotated nucleotide/plasmid sequence parser (`LOCUS`, `FEATURES`, `ORIGIN`), NCBI genetic code CDS translation linter, 6-frame ORF finder, restriction enzyme digestion mapper, CAI calculator, and SBOL3/Modelica/DAE export.         |
| **gPROMS / PML**<br>[`languages/gproms/`](./languages/gproms/)      | `.gproms`, `.pml`                 |  `Beta`  | Equation-oriented dynamic chemical process & distributed parameter (`DISTRIBUTION_DOMAIN`, `PARTIAL`) modeling, Method-of-Lines (MOL) spatial finite-difference discretization, RK4 PDE-DAE solver, and `DAEBuilder`/Modelica export.   |
| **PHREEQC**<br>[`languages/phreeqc/`](./languages/phreeqc/)         | `.pqi`, `.dat`                    |  `Beta`  | USGS PHREEQC aqueous geochemistry, Davies / Extended Debye-Hückel ionic activity coefficients, carbonate/redox ($pe$/pH) speciation, mineral Saturation Index ($\text{SI} = \log_{10}(\text{IAP}/K_{sp})$) solver, and DAE lowering.    |
| **Fortran**<br>[`languages/fortran/`](./languages/fortran/)         | `.f`, `.for`, `.f90`, `.f95`      |  `Beta`  | Fixed-form Fortran 77 and free-form Fortran 90/95 legacy scientific code parsing, `COMMON` block & `EQUIVALENCE` symbol extraction, `DO`/`GOTO` control-flow lifting, and direct lowering into the WebAssembly DAE arena.               |
| **C (ISO C99)**<br>[`languages/c/`](./languages/c/)                 | `.c`, `.h`                        |  `Beta`  | Embedded flight/automotive control C99 source parsing, Static Single Assignment (SSA) control-flow graph construction, pointer/buffer safety linting, in-browser C-to-WASM compilation, and synchronous DAE lowering.                   |

### 8. Radiology, Radiation Oncology & Computer-Assisted Surgery (8)

| Language & Directory                                              | Extensions                        | Maturity | Domain & Core Capabilities                                                                                                                                                                                                              |
| :---------------------------------------------------------------- | :-------------------------------- | :------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenSim**<br>[`languages/opensim/`](./languages/opensim/)       | `.osim`                           |  `Beta`  | Musculoskeletal multibody kinematics, Hill-type muscle-tendon activation & contraction dynamics (`Thelen2003Muscle`, `Millard2012EquilibriumMuscle`), wrapping surfaces, `DAEBuilder` lowering, and Modelica/URDF projection.           |
| **DICOM-RT**<br>[`languages/dicom-rt/`](./languages/dicom-rt/)    | `.rtplan`, `.rtstruct`, `.rtdose` |  `Beta`  | Radiotherapy treatment plan (`RTPLAN`), structure set (`RTSTRUCT`), and 3D dose (`RTDOSE`) parsing, cumulative/differential DVH evaluation, BED/EQD2 calculation, MLC leaf & gantry collision linting, and OpenSCAD/SysML v2 export.    |
| **CellML**<br>[`languages/cellml/`](./languages/cellml/)          | `.cellml`                         |  `Beta`  | IUPS Physiome Project CellML 1.0/1.1/2.0 electrophysiology, cardiac action potential (Hodgkin-Huxley / Rush-Larsen gating), microvascular perfusion, SI dimensional unit verification, `DAEBuilder` lowering, and SBML/Modelica export. |
| **FEBio / SOFA**<br>[`languages/febio/`](./languages/febio/)      | `.feb`, `.scn`                    |  `Beta`  | FEBio 3.x/4.x non-linear soft-tissue biomechanics (neo-Hookean, Mooney-Rivlin, Ogden, Holmes-Mow biphasic cartilage) and SOFA Framework surgical scene graphs (`.scn`), Jacobian/hyperelastic stability linting, and FEA lowering.      |
| **NIfTI / NRRD**<br>[`languages/nifti/`](./languages/nifti/)      | `.nii`, `.nrrd`, `.nhdr`          |  `Beta`  | Volumetric medical imaging (`NIfTI-1/2` & `NRRD`), $4 \times 4$ `qform`/`sform` RAS affine coordinate transformations, anatomical segmentation labelmap extraction, Marching Tetrahedra iso-surfacing, and CAD/STEP projection.         |
| **TOPAS / GATE**<br>[`languages/topas/`](./languages/topas/)      | `.topas`, `.mac`                  |  `Beta`  | Geant4-based TOPAS parameter hierarchies and GATE macros for proton/carbon-ion hadrontherapy beamlines, analytical Bortfeld Bragg peak depth-dose calculation, bounding-box hierarchy linting, and 3D CSG geometry synthesis.           |
| **3MF Medical**<br>[`languages/three-mf/`](./languages/three-mf/) | `.3mf`                            |  `Beta`  | ISO/ASTM 52915 3MF Medical/Healthcare extension for 3D-printed patient-specific surgical cutting guides and cranial/orthopedic implants, half-edge manifold & wall-thickness verification, osteotomy plane validation, and STEP export. |
| **OpenIGTLink / PLUS**<br>[`languages/igtl/`](./languages/igtl/)  | `.igtl`, `.plus.xml`              |  `Beta`  | OpenIGTLink surgical navigation messages and PLUS Toolkit optical/EM tracker & ultrasound calibration configurations, $SE(3)$ homogeneous transform graphs, stylus pivot calibration, and Fitzpatrick FRE/TRE error verification.       |

---

## Key Use Cases Enabled by this Architecture

1. **Continuous Multi-Domain Requirements Verification**:
   Automatically evaluate system requirements across disparate engineering domains. For example, verify that an electric vehicle battery pack's thermal dissipation (computed in 1D Modelica), structural stress limits (derived from 3D FEA), and spatial enclosure envelope (enforced by STEP CAD) simultaneously satisfy high-level SysML v2 safety requirements under uncertainty.
2. **Bidirectional Architecture ↔ Simulation Co-Evolution (TGG)**:
   Keep architecture and physics in permanent sync. Modifications to component hierarchies, ports, or ratings in SysML v2 are translated via forward TGG rewriting directly into Modelica physics models; reciprocally, parameter sizing optimizations discovered during simulation propagate backwards into architectural specifications.
3. **Surrogate Reduced Order Modeling (ROM)**:
   Extract high-fidelity 3D CFD or FEA simulation snapshots and construct ultra-fast, real-time surrogate models (polynomial chaos, Gaussian processes, neural ODEs). Embed these ROMs directly into real-time Modelica plant loops or web dashboards for sub-millisecond execution.
4. **Coordinated Multi-Theory Safety Certification**:
   Use the Nelson-Oppen Semantic Theory Coordinator to prove complex invariants that single solvers cannot resolve—combining symbolic ontology axioms (e.g. subsystem redundancy rules) with non-linear arithmetic constraints and dynamical reachability flowpipes (e.g. collision-free trajectories).
5. **Cross-Enterprise Interoperability & Audit Trails**:
   Ingest industry-standard requirements (ReqIF), architectural definitions (SysML v2), and CAD geometry (STEP), trace them via an immutable digital thread hypergraph, and export production-ready verification manifests and compliance artifacts.

---

## Monorepo Structure

ModelScript is managed with **Nx** and **npm workspaces**:

### Packages (`packages/`)

| Package                                                   | Responsibility                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/dsl`](./packages/dsl/)                     | Grammar DSL syntax combinators, WASM GLR parser compiler (`buildParser`), TGG rewriting compiler, CPA engine, term-rewriting                                                                      |
| [`@modelscript/runtime`](./packages/runtime/)             | Linear-memory DAE arena, `DAEBuilder`, `ArenaDAEPrinter`, Salsa `QueryEngine`, `WorkspaceIndex`, sparse Arnoldi eigensolver, BFO ontology projector, Nelson-Oppen theory coordinator              |
| [`@modelscript/simulate`](./packages/simulate/)           | Numerical simulation runner, SUNDIALS CVODE/IDA, TSIT5/TRBDF2/RODAS4P, WebGPU batched solver, harmonics/QDS/DLR powerflow, IEEE 1584 arc-flash & relay protection, 3D FEA/LBM CFD, surrogate ROMs |
| [`@modelscript/lsp`](./packages/lsp/)                     | Polyglot Language Server Protocol engine across all 81 languages, incremental Salsa workspace index, live 3D CAD metrics CodeLens, reasoner quick-fixes, background worker pool                   |
| [`@modelscript/diagram`](./packages/diagram/)             | Polyglot diagram builder across 81 languages, Sugiyama/TSM auto-layout, PowerFactory SLD, P-Q capability, R-X impedance, log-log TCC relay charts, water network diffs, dark-mode SVG rendering   |
| [`@modelscript/exchange`](./packages/exchange/)           | FMI 2.0/3.0 FMU export/import, SSP 1.0 toolkit, `CoSimMaster`, C99 HIL & CIGRE B4 DLL firmware generator, benchmark catalog, AASX/DDP/OKH lenses, MDF4/MCAP binary telemetry                      |
| [`@modelscript/cad`](./packages/cad/)                     | MCAD & ECAD engine — CSG primitives, OpenCascade/Manifold B-Rep, STEP AP242 I/O, 3D verification overlays (reachability tubes, SOS barrier shells, clearance vectors), GD&T stack-up, Gerber/PCB  |
| [`@modelscript/mcp`](./packages/mcp/)                     | Model Context Protocol (MCP) server exposing 92 compilation, simulation, ontology, TGG, RTM, grid/water/telecom, medical, and domain tools to AI agents                                           |
| [`@modelscript/ide-client`](./packages/ide/)              | VS Code Desktop & Web Extension client, DAP equation debugger, 3-Tier AI Copilot, `.monb` notebooks, 24 custom editors, 3D verification viewport overlays, 20+ panels                             |
| [`@modelscript/embed`](./packages/embed/)                 | Embeddable `<modelscript-viewer>` Web Component, iframe postMessage RPC client, and compressed permalink URL codec                                                                                |
| [`@modelscript/design-tokens`](./packages/design-tokens/) | Shared CSS design tokens (`--ms-*`) and primitive `.ms-btn` / `.ms-chip` styles for the docs site, web app, and IDE webviews                                                                      |
| [`@modelscript/react`](./packages/react/)                 | React SDK & engineering UI widgets (`ModelScriptProvider`, `BlackboxInspector`, `StepResponseTestbench`, WebWorker/WASM hooks)                                                                    |
| [`@modelscript/examples`](./packages/examples/)           | End-to-end polyglot reference workspaces (`drone-reachability`, `drone-chassis`, and `pscad-microgrid` under `./packages/examples/`)                                                              |

### Applications (`apps/`)

| Package                                   | Responsibility                                                                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/cli`](./apps/cli/)         | `modelscript` (`msx`) unified command-line toolchain — 157 commands across compilation, simulation, verification, grid/water/telecom, and domains   |
| [`@modelscript/api`](./apps/api/)         | Ansatz & ModelScript backend — REST, GraphQL, SPARQL, Git Smart HTTP, ActivityPub, SysML v2 REST, Slurm HPC, and MCP SSE                            |
| [`@modelscript/ide`](./apps/ide/)         | Browser-based VS Code Web engineering workbench with GitHub virtual filesystem (`github://`) and static CDN bundling                                |
| [`@modelscript/web`](./apps/web/)         | Ansatz (`ansatz.social`) web platform — package registry, federated engineering network, scholarly citations, Git vault, Cloud HPC, & `/playground` |
| [`@modelscript/desktop`](./apps/desktop/) | Native cross-platform Desktop Studio (Tauri v2) with direct FFI `NativeFmuRunner` and NERC CIP / FERC CEII air-gap controls                         |
| [`@modelscript/docs`](./apps/docs/)       | Unified `modelscript.org` documentation portal (VitePress) and automated PDF Reference Manual generator                                             |

### Enterprise Edition (`ee/`)

| Package                    | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/ee`](./ee/) | Commercial Enterprise Edition (`LicenseRef-ModelScript-Enterprise`) — offline Ed25519 license verifier (`MSX_LICENSE_KEY`), 5-stage ISO Interconnection Gatekeeper, NERC RSAW & NIST OSCAL regulatory dossiers, FCC OET-65 / NORS / FAA Part 77 telecom compliance, air-gapped NERC CIP / FERC CEII & EAR/OFAC controls, FDA 21 CFR Part 11 DHF attestations, SAML/OIDC SSO & Org RBAC, Slurm HPC, Operational Digital Twins, HIL codegen, and PLM connectors |

---

## Interoperability, Reporting & Export Formats

ModelScript bridges modern engineering workflows with extensive export and auditing formats:

- **FMI 2.0 & 3.0 FMU Export/Import**: Export standalone Modelica models as Functional Mock-up Units (Model Exchange and Co-Simulation in C99, WASM, or JS) or import external FMUs into composite systems.
- **C99 HIL & CIGRE B4.82 DLL Real-Time Firmware**: Compile controllers and plant models to zero-malloc MISRA-C / C99 source and IEEE/CIGRE B4 DLLs for dSPACE, OPAL-RT, RTDS, Speedgoat, PSCAD, and PSS®E.
- **SSP 1.0, IDTA AASX & PSI 21 DDP Packaging**: Package multi-model simulation architectures into `.ssp` containers, Industry 4.0 Asset Administration Shells (`.aasx`), ISO/PAS 81346 Digital Data Packages (`.ddp`), and DIN SPEC 3105 Open Know-How (`okh.json`) manifests.
- **Standard Interop Gateways**: OSLC 3.0 (Open Services for Lifecycle Collaboration) REST endpoints, OMG SysML v2 REST API, and ReqIF 1.2 synchronization.
- **Auditing & Compliance Reports**:
  - **CTRF**: Common Test Report Format output for CI/CD test tracking.
  - **SARIF**: Static Analysis Results Interchange Format for deep linter and static verification diagnostics in GitHub Code Scanning.
  - **NERC RSAW, NIST OSCAL & ISO Interconnection Gatekeeper Dossiers**: Automated Reliability Standard Audit Worksheets (TPL-001-5, MOD-026/027, PRC-019/024/025), 5-stage ISO interconnection queue readiness certificates, US EPA LCRR/NetDMR reports, and FCC OET-65 / FAA Part 77 siting dossiers.
  - **FDA / ISO Design History Files (DHF) & EN 14363 / IEEE 2800 Dossiers**: Regulatory compliance dossiers with SHA-256 cryptographic proof manifests.
  - **LaTeX & Interactive HTML**: High-precision formal verification certificates and self-contained graphical HTML reports with embedded simulation trajectories and SVG diagrams.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 24 (see `.nvmrc`)
- **Git**

> [!NOTE]
> All language parsers are generated and executed in WebAssembly using Node.js devDependencies (`asc`). The Emscripten SDK (`emsdk`) is **not** required for standard development or parser compilation; it is only needed if rebuilding native C/C++ third-party solver libraries (`sundials`, `coin-or`) from source in `packages/simulate/scripts/`.

### Installation

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
```

### Building

Build all packages in dependency order via Nx:

```bash
npm run build
```

#### Building the VS Code Extension (`.vsix`) & Native Desktop App

```bash
# Build the complete standalone IDE extension into apps/ide/dist/extension/
npm run build:ide:extension

# Package the complete IDE extension into a deployable .vsix bundle (~121 MB)
npm run package:ide:extension

# Or generate a lightweight multi-language syntax extension into dist/extension/
npm run build:extension

# Package the native Tauri v2 Desktop Studio
npm run package:desktop
```

### Running (Development)

Start development services concurrently:

```bash
npm run dev
```

This launches the primary development stack:

| Service     | Port / URL              | Description                                                                        |
| ----------- | ----------------------- | ---------------------------------------------------------------------------------- |
| **API**     | `http://localhost:3000` | REST / GraphQL / SPARQL / MCP SSE API server & embedded VS Code Web IDE host       |
| **Web**     | `http://localhost:3001` | Unified package registry, social hub, `/playground`, `/ide`, and VitePress `/docs` |
| **Desktop** | `npm run dev:desktop`   | Native Tauri v2 air-gapped desktop studio (`@modelscript/desktop`)                 |

#### Browser-Local AI Assistant (Optional)

The IDE includes a browser-local AI assistant powered by WebLLM (`Qwen3-0.6B`). To enable it, download the model weights (~350 MB, one-time):

```bash
npm run download-model --workspace=@modelscript/ide
```

---

## 60-Second Quick Tour & CLI Usage (`modelscript` / `msx`)

After building (`npm run build`), the unified CLI is available as `modelscript` (alias `msx`). You can run these commands immediately against the bundled reference workspaces in [`packages/examples/`](./packages/examples/):

```bash
# 1. Verify cross-domain requirements & zonotope reachability on the polyglot drone workspace
npx msx verify packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --sysml packages/examples/drone-reachability/sysml/drone_specs.sysml

# 2. Flatten & simulate the Modelica flight dynamics (CSV or JSON output)
npx msx compile DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo
npx msx simulate DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --stop-time 10 --solver dopri5 --format json

# 3. Simulate the multi-disciplinary drone chassis trade study
npx msx simulate TradeStudy packages/examples/drone-chassis/TradeStudy.mo --stop-time 5.0

# 4. Lint, simulate, and verify IEEE 2800-2022 grid compliance on the PSCAD 230 kV microgrid
npx msx pscad lint packages/examples/pscad-microgrid/Microgrid_IBR.pscx
npx msx pscad sim packages/examples/pscad-microgrid/Microgrid_IBR.pscx --step=20us --tstop=0.25
npx msx pscad verify-ieee2800 packages/examples/pscad-microgrid/Microgrid_IBR.pscx

# 5. Render a schematic diagram to SVG or project OpenSCAD to ISO 10303-21 STEP
npx msx render DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo > diagram.svg
npx msx polyglot project packages/examples/drone-reachability/cad/drone.scad --target step --out drone.step

# 6. Export an FMI 3.0 FMU or FDA/ISO Design History File (DHF) compliance dossier
npx msx fmu DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --fmi-version 3 --output DroneSimulation.fmu
npx msx dhf export packages/examples/drone-reachability --format markdown -o Drone_DHF.md
```

---

## Testing, Linting & Formatting

```bash
# Run tests for git-affected packages
npm test

# Run the complete test suite across all monorepo packages
npm run test:all

# Run OpenModelica testsuite runner
npm run test:modelica -- OpenModelica/flattening/modelica/types
npm run test:single -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Run Modelica Standard Library (MSL) verification & benchmark suite
npm run test:msl

# Code quality & manifest integrity checks
npm run lint
npm run lint:manifests
npm run format
```

---

## Docker Deployment

Pre-built multi-arch images are published to the GitHub Container Registry on pushes to `main`.

Run the complete multi-service stack with a single command:

```bash
docker compose pull    # Pull latest images from ghcr.io/modelscript/*
docker compose up -d   # Start all services
docker compose down    # Stop containers
docker compose logs -f # Tail logs
```

To build and run locally from source:

```bash
npm run docker:build
npm run docker:up
```

### Deployed Services & Ports

| Service         | Port           | Protocol | Description                                                                        |
| --------------- | -------------- | -------- | ---------------------------------------------------------------------------------- |
| **API**         | `3000`         | HTTP     | Backend simulation, GraphQL, SPARQL, verification API, and VS Code Web IDE host    |
| **Web**         | `3001`         | HTTP     | Unified library registry, hub, `/playground`, `/ide`, and VitePress docs (`/docs`) |
| **MQTT**        | `1883`, `9001` | TCP, WS  | Eclipse Mosquitto broker for event bus & telemetry streaming                       |
| **TimescaleDB** | `5432`         | TCP      | Time-series database for telemetry historian & simulation trajectories             |

---

## License

ModelScript follows an **Open-Core and Dual-License** model:

- **Community Edition (Open Core)**: All packages under `packages/`, `languages/`, and `apps/` are licensed under the **GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`)**. See [`COPYING`](./COPYING) for the full license text.
- **Enterprise Edition ([`ee/`](./ee/))**: All files inside `ee/` (`@modelscript/ee`) and the pre-hardened Enterprise Intranet Appliance (`ee/deploy/`) are proprietary and licensed under the **ModelScript Enterprise License (`LicenseRef-ModelScript-Enterprise`)**. See [`ee/LICENSE`](./ee/LICENSE) for terms.
- **Commercial OEM Dual-License**: Organizations embedding ModelScript compilers, solvers, or UI components into proprietary closed-source products or SaaS platforms without AGPL-3.0 Section 13 copyleft obligations may purchase a Commercial SDK License. Contact `licensing@modelscript.org` for details. _(Note: Embedding the optional 3D CAD engine `@modelscript/cad` utilizes Open CASCADE WebAssembly components under LGPL-2.1 Section 6 dynamic linking terms)._
