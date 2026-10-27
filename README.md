<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

[![CI/CD](https://github.com/modelscript/modelscript/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/modelscript/modelscript/actions/workflows/ci.yml)
[![npm @modelscript/cli](https://img.shields.io/npm/v/@modelscript/cli?label=cli)](https://www.npmjs.com/package/@modelscript/cli)
[![Docker API](https://img.shields.io/badge/ghcr.io-api-blue?logo=docker)](https://ghcr.io/modelscript/api)
[![Docker Web](https://img.shields.io/badge/ghcr.io-web-blue?logo=docker)](https://ghcr.io/modelscript/web)
[![Docker IDE](https://img.shields.io/badge/ghcr.io-ide-blue?logo=docker)](https://ghcr.io/modelscript/ide)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/modelscript.modelscript?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript)
[![Open VSX](https://img.shields.io/open-vsx/v/modelscript/modelscript?label=Open%20VSX&logo=eclipseide)](https://open-vsx.org/extension/modelscript/modelscript)

ModelScript is a Web-native, polyglot compiler & engineering intelligence platform that unifies **44 modern open standards** (SysML v2, Modelica, STEP, SSP, ReqIF, OWL 2, OpenDRIVE, OpenSCENARIO, AUTOSAR, PLCopen, URDF, SBML) and **industrial simulation formats** (PSCAD, PSS/E, OpenDSS, SPICE, Verilog-A, IBIS, Touchstone, OLGA, PipelineStudio, Aspen Plus, ECLIPSE, EPANET, SWMM, RELAP5, EnergyPlus, ADAMS, SIMPACK, GENSYS, GT-SUITE, SIMA, Simulink, EASY5, JSBSim, ROCETS, CCSDS, CalculiX FEA, SU2 CFD, Fortran, C) into a continuous digital thread for end-to-end design, simulation, formal verification, and compliance auditing.

---

## Architecture Highlights

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ModelScript Digital Thread                               │
├──────────────────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┤
│ SysML v2 / ReqIF │ Modelica / SSP  │ STEP / CAD / CAE│ Power / Fluids  │ Multibody / Aero│
│  OWL 2 / OSLC    │ Simulink / EASY5│  (OpenSCAD/FEA) │ (PSCAD/OLGA/+)  │ (GENSYS/ADAMS/+)│
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

Cross-domain verification is orchestrated by a generalized **Nelson-Oppen Semantic Theory Coordinator** (`@modelscript/runtime/formal/theory_coordinator`), exchanging equality facts, tight numeric intervals, and conflict clauses across **12 domain theory oracles** with CDCL(T) case splitting:

- **Ontology Domain (`OntologyTheoryOracle`)**: Tableau Description Logic (DL) reasoner, OWL2 bundle closure, concept subsumption, and scoped disjointness.
- **Constraint Domain (`ConstraintTheoryOracle`)**: Non-linear interval contraction via HC4 contractor, DPLL(T) arithmetic solver, and variable domain bounding.
- **Abstract Domain (`AbstractDomainOracle`)**: Octagon Difference Bound Matrices (DBM), 4D spatio-temporal intervals, and relational numerical bounds.
- **Continuous Safety & Reliability Domain (`ContinuousSafetyOracle` / `SafetyTheoryOracle`)**: Reachability analysis via zonotopes, constrained zonotopes, star sets, Sum-of-Squares (SOS) barrier certificates, Fault Tree Analysis (FTA), Minimal Cut Sets (MCS), and ISO 26262 / DO-178C safety metrics.
- **Dynamic Simulation Domain (`DynamicSimulationOracle`)**: DAE numerical trajectory integration, Signal Temporal Logic (STL) quantitative robustness monitoring, and tolerance propagation.
- **Spatial Physics Domain (`SpatialPhysicsOracle`)**: Watertight B-Rep CAD solid query, collision/clearance checks, geometric mass properties, and 3D FEA/CFD field coupling.
- **CAE Contract Domain (`CaeContractOracle`)**: FEA structural stress/deflection and CFD aerodynamic performance contract verification synchronized with the Digital Thread hypergraph.
- **Causalization Domain (`CausalizationOracle`)**: Pantelides Index-1 structural non-singularity, algebraic loop solvability, and Nyquist-Shannon sampling stability verification.
- **Dimensional Domain (`DimensionalOracle`)**: ISO 80000 7-element rational exponent vector (`[L, M, T, I, Θ, N, J]`) dimensional homogeneity and unit consistency checking.
- **Entailment Domain (`EntailmentOracle`)**: V-Model requirements decomposition completeness proving ($\bigwedge R_{\text{child},i} \models R_{\text{parent}}$) with signed proof manifest generation.
- **Flow Algebra Domain (`FlowAlgebraOracle`)**: SysML v2 / KerML conjugated port involution (`~Port`), Kirchhoff conservative flow balancing, and 1D–3D CFD boundary flux coupling.
- **Tolerance Stack & UQ Domains (`ToleranceStackOracle`, `UqOracle`)**: STEP AP242 GD&T 1D/3D tolerance chain evaluation (Worst-Case, RSS, Six-Sigma $C_{pk}$) and stochastic Uncertainty Quantification via analytical CDFs and Monte Carlo sampling.

### 3. Data-Oriented Linear Memory Simulation (DAE Arena)

The simulation runtime employs a zero-allocation Struct-of-Arrays (SoA) layout (`DAEBuilder`) in linear WebAssembly memory. Equations, variables, and expressions are lowered directly from linear parser CST nodes into integer arena handles, enabling microsecond Pantelides index reduction, Tarjan BLT partition sorting, alias elimination, and SIMD/WebGPU batched numerical solving without garbage collection overhead.

### 4. Salsa-Based Incremental Computation

Inspired by Rust's Salsa, compilation, name resolution, and specialized class instances are fully memoized on a demand-driven dependency graph. When an engineer modifies a single equation or parameter, only transitively affected queries and DAE blocks are re-flattened.

---

## Supported Languages & Domain Capabilities (44 Languages)

ModelScript provides first-class support for **44 engineering languages and simulation formats** under `languages/`, organized across 7 domain clusters and powered by native WebAssembly parsers, linear-memory CST arenas, static pre-flight linters, and direct `DAEBuilder` lowering:

### 1. Native & Core Systems Engineering (7)

| Language & Directory                                                    | Extensions             | Domain & Core Capabilities                                                                                                                                                                                                    |
| :---------------------------------------------------------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ModelScript**<br>[`languages/modelscript/`](./languages/modelscript/) | `.msx`                 | Unified declarative multi-domain language combining acausal physical equations, hierarchical state machines, spatial CAD constraints, and direct compilation to the WebAssembly DAE arena.                                    |
| **Modelica**<br>[`languages/modelica/`](./languages/modelica/)          | `.mo`                  | Complete Modelica 3.x equation-based modeling; native AssemblyScript flattening kernel (`ModelicaFlattener`) supporting `hybrid`, `wasm`, `ts`, and `diff` modes; connector balancing; BLT partitioning; and OMC conformance. |
| **SysML v2 / KerML**<br>[`languages/sysml2/`](./languages/sysml2/)      | `.sysml`, `.kerml`     | OMG Systems Modeling Language v2 & KerML parsing, standard library snapshot, structural part/port definitions, state machine & fUML activity execution, decision table verification, and requirements allocation.             |
| **SSP 1.0**<br>[`languages/ssp/`](./languages/ssp/)                     | `.ssp`, `.ssd`, `.ssv` | System Structure and Parameterization standard packaging, multi-FMU co-simulation topologies (`SystemStructure.ssd`), parameter value catalogs (`.ssv`), and signal dictionary mappings (`.ssm`).                             |
| **ReqIF**<br>[`languages/reqif/`](./languages/reqif/)                   | `.reqif`, `.reqifz`    | OMG Requirements Interchange Format v1.2 parsing, `SPEC-OBJECTS` / `SPEC-RELATIONS` traceability graph extraction, suspect-link detection, and bidirectional SysML v2 requirement synchronization.                            |
| **OWL 2**<br>[`languages/owl2/`](./languages/owl2/)                     | `.owl`, `.ofn`         | W3C OWL 2 Functional-Style Syntax parsing, Tableau Description Logic (DL) reasoning, concept subsumption, Manchester syntax rendering, OWL 2 DL/EL profile linting, and SPARQL-DL querying.                                   |
| **CSV**<br>[`languages/csv/`](./languages/csv/)                         | `.csv`                 | High-throughput tabular data parsing, RFC 4180 structural linting, experimental sensor telemetry ingestion, trajectory regression comparison, and parameter calibration datasets.                                             |

### 2. Electrical Power Grids, RF & Electronics (7)

| Language & Directory                                                 | Extensions                 | Domain & Core Capabilities                                                                                                                                                                                                                                              |
| :------------------------------------------------------------------- | :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSCAD**<br>[`languages/pscad/`](./languages/pscad/)                | `.pscx`, `.pslx`, `.psout` | Electromagnetic transient (EMT) parsing, Dommel companion-circuit & Bergeron traveling-wave line simulation, IEEE 2800-2022 ride-through verification, COMTRADE `.cfg`/`.dat` I/O, and Modelica/SSP/SLD projection.                                                     |
| **PSS/E**<br>[`languages/psse/`](./languages/psse/)                  | `.raw`, `.dyr`             | Siemens PTI PSS/E v33/v34 transmission grid parsing, Newton-Raphson & Fast Decoupled AC power flow solving, branch thermal loading, generator reactive capability checks, and Single-Line Diagram (SLD) synthesis.                                                      |
| **OpenDSS**<br>[`languages/opendss/`](./languages/opendss/)          | `.dss`                     | EPRI OpenDSS unbalanced multi-phase distribution network parsing, radial/meshed forward-backward sweep power flow, DER solar PV/storage hosting capacity analysis, and Modelica projection.                                                                             |
| **SPICE**<br>[`languages/spice/`](./languages/spice/)                | `.cir`, `.sp`, `.spice`    | Berkeley SPICE / LTspice / Ngspice netlist parsing, Modified Nodal Analysis (MNA) conservation lowering (`DAEBuilder`), MOSFET/BJT/diode device models, floating node & voltage-loop linting, and Modelica projection.                                                  |
| **Verilog-A**<br>[`languages/verilog-a/`](./languages/verilog-a/)    | `.va`, `.vams`             | Accellera Verilog-A / Verilog-AMS analog behavioral hardware description parsing, `discipline`/`nature` extraction, branch contribution (`V(p,n) <+ ...`, `I(p,n) <+ ddt(...)`) lowering to DAE arena, and Modelica export.                                             |
| **IBIS**<br>[`languages/ibis/`](./languages/ibis/)                   | `.ibs`                     | ANSI/EIA-656-B I/O Buffer Information Specification parsing, piecewise-linear pullup/pulldown & clamping diode I/V curve interpolation, dynamic output impedance calculation, monotonicity linting, and DAE lowering.                                                   |
| **Touchstone**<br>[`languages/touchstone/`](./languages/touchstone/) | `.s1p`–`.s32p`, `.ts2`     | Touchstone v1.0/v2.0 N-port S/Y/Z network parameter parsing, spectral norm passivity verification ($\|\mathbf{S}(f)\|_2 \le 1$), Gustavsen-Semlyen rational Vector Fitting to state-space $(\mathbf{A},\mathbf{B},\mathbf{C},\mathbf{D})$, and DAE macromodel lowering. |

### 3. Fluid, Process, Subsurface, Civil Water & Nuclear Thermal-Hydraulics (8)

| Language & Directory                                                 | Extensions              | Domain & Core Capabilities                                                                                                                                                                                                   |
| :------------------------------------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OLGA**<br>[`languages/olga/`](./languages/olga/)                   | `.opi`, `.olga`, `.key` | Multiphase dynamic flow assurance parsing, 1D two-fluid / drift-flux hydrodynamic simulation, severe slugging (Bøe/Pots), hydrate/wax/asphaltene & NACE MR0175 sour corrosion verification, and SysML/Modelica projection.   |
| **PipelineStudio (LPS)**<br>[`languages/lps/`](./languages/lps/)     | `.lps`, `.tgx`, `.tlx`  | Gas and liquid transmission pipeline network parsing, Colebrook-White steady-state hydraulics, linepack inventory, isothermal Euler transient surge simulation, ASME B31.4/B31.8 MAOP checks, and Modelica projection.       |
| **Aspen Plus**<br>[`languages/aspen/`](./languages/aspen/)           | `.in`, `.inp`, `.bkp`   | Chemical process flowsheet parsing, Rachford-Rice isothermal vapor-liquid equilibrium (VLE) flash solving, RadFrac distillation stage balances, tear-stream convergence linting, and Modelica fluid process projection.      |
| **ECLIPSE**<br>[`languages/eclipse/`](./languages/eclipse/)          | `.data`, `.dat`, `.inc` | Schlumberger ECLIPSE 100/300 black-oil reservoir deck parsing (`RUNSPEC`, `GRID`, `PROPS`, `SOLUTION`, `SCHEDULE`), multiphase Darcy depletion & Peaceman wellbore inflow solver, PVT table linting, and DAE lowering.       |
| **EPANET**<br>[`languages/epanet/`](./languages/epanet/)             | `.inp`                  | US EPA pressurized municipal water distribution network parsing, Todini & Pilati Global Gradient Method (GGM) hydraulic solver (Hazen-Williams / Darcy-Weisbach), tank level DAE lowering, and Modelica projection.          |
| **SWMM**<br>[`languages/swmm/`](./languages/swmm/)                   | `.inp`                  | US EPA Storm Water Management Model v5 urban drainage parsing, Manning open-channel & partially-full circular conduit routing, subcatchment runoff, surcharge overflow linting, and DAE/Modelica projection.                 |
| **RELAP5-3D**<br>[`languages/relap5/`](./languages/relap5/)          | `.i`, `.inp`, `.r5`     | US NRC nuclear reactor thermal-hydraulics deck parsing (hydrodynamic volumes, junctions, heat structures, trips), in-WASM 6-group delayed neutron point-kinetics solver with Doppler/moderator feedback, and DAE lowering.   |
| **EnergyPlus**<br>[`languages/energyplus/`](./languages/energyplus/) | `.idf`, `.epjson`       | US DOE building energy simulation parsing (`Zone`, `Material`, `Construction`, 3D `BuildingSurface:Detailed`), polygon convexity & interzone surface linting, multi-zone RC thermal network DAE lowering, and Modelica sync. |

### 4. Multibody, Automotive, Robotics, Marine & Rail (9)

| Language & Directory                                                       | Extensions                | Domain & Core Capabilities                                                                                                                                                                                                       |
| :------------------------------------------------------------------------- | :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MSC ADAMS**<br>[`languages/adams/`](./languages/adams/)                  | `.adm`, `.cmd`, `.acf`    | Multibody dynamics deck & command script parsing, Grübler-Kutzbach mobility & redundant constraint analysis, IMPACT contact and bushing force lowering to `DAEBuilder`, and `Modelica.Mechanics.MultiBody` projection.           |
| **SIMPACK**<br>[`languages/simpack/`](./languages/simpack/)                | `.spck`, `.sim`, `.fbi`   | Multibody systems & Craig-Bampton flexible body (`.fbi`) parsing, in-WASM spatial kinematics, Baumgarte stabilization & Newton-Raphson kinematic loop closure, Berg hydro-mount bushing model, and DAE/Modelica projection.      |
| **GENSYS**<br>[`languages/gensys/`](./languages/gensys/)                   | `.calc`, `.run`, `.trax`  | Railway vehicle dynamics & track geometry parsing, in-WASM SIMD Kalker FASTSIM & Polach creep force solvers, UIC60/S1002 wheel-rail contact, ERRI/FRA track PSD synthesis, EN 14067-6 cross-wind, and EN 14363 homologation.     |
| **GT-SUITE**<br>[`languages/gtsuite/`](./languages/gtsuite/)               | `.gtm`, `.gtx`, `.gtd`    | 1D powertrain and engine deck parsing, Wiebe combustion burn rate, Woschni heat transfer, slider-crank kinematics, turbocharger maps, 1D gas dynamics solver, and Modelica/SSP export.                                           |
| **SIMA**<br>[`languages/sima/`](./languages/sima/)                         | `.sima`, `.stask`, `.sys` | SINTEF SIMO/RIFLEX offshore marine card deck & archive parsing, Cummins 6-DOF floater dynamics, analytical inelastic catenary mooring solver, DNV-OS-E301 tension safety factor verification, and polar spread diagrams.         |
| **URDF / SDF**<br>[`languages/urdf/`](./languages/urdf/)                   | `.urdf`, `.sdf`, `.world` | ROS 2 Robot Description Format & Gazebo SDF parsing, kinematic tree & triangle-inequality inertia tensor validation, Newton-Euler rigid-body DAE lowering, and `Modelica.Mechanics.MultiBody` projection.                        |
| **OpenDRIVE**<br>[`languages/opendrive/`](./languages/opendrive/)          | `.xodr`                   | ASAM OpenDRIVE v1.4–v1.8 road network parsing, analytical clothoid (Euler spiral), arc, and cubic polynomial reference line evaluation, $C^1$ heading continuity verification, and 6-DOF vehicle road-tire DAE lowering.         |
| **OpenSCENARIO**<br>[`languages/openscenario/`](./languages/openscenario/) | `.xosc`, `.osc`           | ASAM OpenSCENARIO v1.x XML & v2.0 DSL autonomous driving scenario parsing, closed-loop actor maneuver/trigger simulation, Time-to-Collision (TTC) & IEEE 2846 RSS longitudinal safety margin verification, and DAE lowering.     |
| **AUTOSAR**<br>[`languages/autosar/`](./languages/autosar/)                | `.arxml`                  | AUTOSAR Classic & Adaptive R22-11 `.arxml` parsing, Software Component (`SWC`), Sender/Receiver & Client/Server port interface validation, runnable WCET utilization & CAN/FlexRay PDU bit-packing linting, and Modelica export. |

### 5. Aerospace, Flight Dynamics, Astrodynamics & Controls (6)

| Language & Directory                                                    | Extensions                      | Domain & Core Capabilities                                                                                                                                                                                                          |
| :---------------------------------------------------------------------- | :------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Simulink**<br>[`languages/simulink/`](./languages/simulink/)          | `.slx`, `.mdl`                  | MATLAB Simulink `.slx` (OPC ZIP XML) and legacy `.mdl` block diagram parsing, Stateflow chart extraction, algebraic loop & sample-time hit linting, direct lowering to `DAEBuilder`, and `Modelica.Blocks` projection.              |
| **EASY5**<br>[`languages/easy5/`](./languages/easy5/)                   | `.ez5`, `.ezm`, `.dat`          | Boeing / MSC EASY5 schematic & macro library parsing, continuous/discrete control block topology extraction, state-space linearization ($A, B, C, D$), Bode/Nyquist frequency response, and Modelica/SSP export.                    |
| **JSBSim**<br>[`languages/jsbsim/`](./languages/jsbsim/)                | `.xml`                          | JSBSim 2.0 6-DOF flight dynamics model (`<fdm_config>`) parsing, ISA atmosphere & aerodynamic coefficient evaluation, flight control system (FCS) channel validation, RK4 trajectory integration, and Modelica projection.          |
| **ROCETS**<br>[`languages/rocets/`](./languages/rocets/)                | `.roc`, `.inp`, `.deck`         | NASA liquid rocket engine propulsion deck parsing, cryogenic turbopump/turbine shaft power balance cycle solver, injector/regenerative cooling jacket pressure drop, transient startup/shutdown simulation, and DAE lowering.       |
| **CCSDS / XTCE**<br>[`languages/ccsds/`](./languages/ccsds/)            | `.oem`, `.opm`, `.omm`, `.xtce` | CCSDS Orbit Ephemeris/Parameter/Mean-Elements KVN & OMG XTCE satellite telemetry parsing, 6-DOF Cowell orbit propagator ($J_2$ oblateness, drag, solar radiation pressure), bit-packing overlap linting, and SysML/Modelica export. |
| **PLCopen IEC 61131-3**<br>[`languages/plcopen/`](./languages/plcopen/) | `.st`, `.iec`, `.plcxml`        | IEC 61131-3 Structured Text (`.st`) and PLCopen TC6 XML (`.plcxml`) industrial control parsing, deterministic scan-cycle state machine lowering to synchronous clocked DAE equations, and `Modelica_Synchronous` export.            |

### 6. 3D CAD & Continuum Physics — FEA / CFD (4)

| Language & Directory                                           | Extensions                      | Domain & Core Capabilities                                                                                                                                                                                                             |
| :------------------------------------------------------------- | :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STEP (ISO 10303)**<br>[`languages/step/`](./languages/step/) | `.step`, `.stp`, `.p21`         | ISO 10303-21 (AP203/AP214/AP242) Clear Text Encoding parsing, B-Rep topological entity graph traversal, assembly hierarchy extraction, GD&T datum/tolerance validation, and solid volume/centroid integration.                         |
| **OpenSCAD**<br>[`languages/scad/`](./languages/scad/)         | `.scad`                         | Constructive Solid Geometry (CSG) AST evaluation, 3D boolean transformations (`union`, `difference`, `intersection`, `hull`), parametric dimension extraction, surgical AST writeback, and STEP/Modelica CAD synchronisation.          |
| **FEA**<br>[`languages/fea/`](./languages/fea/)                | `.fea`, `.inp`, `.bdf`          | CalculiX/Abaqus (`.inp`), Nastran (`.bdf`), and declarative `.fea` structural mesh setup, Tet4/Tet10 thermo-elastic stiffness assembly, von Mises stress recovery, and CAE boundary contract verification.                             |
| **CFD**<br>[`languages/cfd/`](./languages/cfd/)                | `.cfd`, `.cfg`, `.su2`, `.foam` | SU2 (`.cfg`/`.su2`), OpenFOAM (`.foam`), and declarative `.cfd` flow specification parsing, $y^+$ & Courant-Friedrichs-Lewy (CFL) mesh quality linting, WebGPU D3Q19 Lattice Boltzmann coupling, and aerodynamic drag/lift extraction. |

### 7. Systems Biology & Scientific / Embedded Code (3)

| Language & Directory                                        | Extensions                   | Domain & Core Capabilities                                                                                                                                                                                                   |
| :---------------------------------------------------------- | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SBML**<br>[`languages/sbml/`](./languages/sbml/)          | `.sbml`, `.xml`              | Systems Biology Markup Language (Level 2 / Level 3) parsing, compartment/species/reaction stoichiometry matrix construction, MathML & infix kinetic law evaluation, RK4 concentration ODE solver, and DAE/Modelica lowering. |
| **Fortran**<br>[`languages/fortran/`](./languages/fortran/) | `.f`, `.for`, `.f90`, `.f95` | Fixed-form Fortran 77 and free-form Fortran 90/95 legacy scientific code parsing, `COMMON` block & `EQUIVALENCE` symbol extraction, `DO`/`GOTO` control-flow lifting, and direct lowering into the WebAssembly DAE arena.    |
| **C (ISO C99)**<br>[`languages/c/`](./languages/c/)         | `.c`, `.h`                   | Embedded flight/automotive control C99 source parsing, Static Single Assignment (SSA) control-flow graph construction, pointer/buffer safety linting, in-browser C-to-WASM compilation, and synchronous DAE lowering.        |

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

| Package                                         | Responsibility                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`@modelscript/dsl`](./packages/dsl/)           | Grammar DSL syntax combinators, WASM GLR parser compiler (`buildParser`), TGG rewriting compiler, CPA engine, term-rewriting         |
| [`@modelscript/runtime`](./packages/runtime/)   | Linear-memory DAE arena, `DAEBuilder`, `ArenaDAEPrinter`, Salsa `QueryEngine`, `WorkspaceIndex`, Nelson-Oppen theory coordinator     |
| [`@modelscript/simulate`](./packages/simulate/) | Numerical simulation runner, SUNDIALS CVODE/IDA integration, WebGPU batched solver, 3D FEA/LBM CFD, surrogate ROMs, Monte Carlo      |
| [`@modelscript/lsp`](./packages/lsp/)           | Polyglot Language Server Protocol engine across all 44 languages, incremental Salsa workspace index, background worker pool          |
| [`@modelscript/diagram`](./packages/diagram/)   | Polyglot diagram builder, Sugiyama/TSM auto-layout, Manhattan A\* port router, perceptual dark-mode SVG rendering, visual diffs      |
| [`@modelscript/exchange`](./packages/exchange/) | FMI 2.0/3.0 FMU export/import, SSP 1.0 toolkit, `CoSimMaster` orchestrator, AASX/DDP/OKH lenses, MDF4/MCAP binary telemetry          |
| [`@modelscript/cad`](./packages/cad/)           | MCAD & ECAD engine — CSG primitives, OpenCascade/Manifold B-Rep, STEP AP242 I/O, dynamic clearance, GD&T stack-up, Gerber/PCB DRC    |
| [`@modelscript/mcp`](./packages/mcp/)           | Model Context Protocol (MCP) server exposing 47 compilation, simulation, ontology, TGG, RTM, and domain tools to AI agents           |
| [`@modelscript/ide-client`](./packages/ide/)    | VS Code Desktop & Web Extension client, DAP equation debugger, 3-Tier AI Copilot, `.monb` notebooks, 18 custom editors, 20+ panels   |
| [`@modelscript/embed`](./packages/embed/)       | Embeddable `<modelscript-viewer>` Web Component, iframe postMessage RPC client, and compressed permalink URL codec                   |
| [`@modelscript/react`](./packages/react/)       | React SDK & engineering UI widgets (`ModelScriptProvider`, `BlackboxInspector`, `StepResponseTestbench`, WebWorker/WASM hooks)       |
| [`@modelscript/examples`](./packages/examples/) | End-to-end polyglot reference workspaces (`drone-reachability`, `drone-chassis`, and `pscad-microgrid` under `./packages/examples/`) |

### Applications (`apps/`)

| Package                                   | Responsibility                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/cli`](./apps/cli/)         | `modelscript` (`msx`) unified command-line toolchain — 89 commands across compilation, simulation, verification, and domains |
| [`@modelscript/api`](./apps/api/)         | Backend REST, GraphQL, SPARQL, Git Smart HTTP, SysML v2 REST, Co-Simulation, Slurm HPC, and MCP SSE gateway server           |
| [`@modelscript/ide`](./apps/ide/)         | Browser-based VS Code Web engineering workbench with GitHub virtual filesystem (`github://`) and static CDN bundling         |
| [`@modelscript/web`](./apps/web/)         | Web frontend — package registry, social engineering hub, ActivityPub federation, Cloud HPC studio, and `/playground`         |
| [`@modelscript/desktop`](./apps/desktop/) | Native cross-platform Desktop Studio (Tauri v2) with direct FFI `NativeFmuRunner` and NERC CIP / FERC CEII air-gap controls  |
| [`@modelscript/docs`](./apps/docs/)       | Unified `modelscript.org` documentation portal (VitePress) and automated PDF Reference Manual generator                      |

---

## Interoperability, Reporting & Export Formats

ModelScript bridges modern engineering workflows with extensive export and auditing formats:

- **FMI 2.0 & 3.0 FMU Export/Import**: Export standalone Modelica models as Functional Mock-up Units (Model Exchange and Co-Simulation in C99, WASM, or JS) or import external FMUs into composite systems.
- **SSP 1.0, IDTA AASX & PSI 21 DDP Packaging**: Package multi-model simulation architectures into `.ssp` containers, Industry 4.0 Asset Administration Shells (`.aasx`), ISO/PAS 81346 Digital Data Packages (`.ddp`), and DIN SPEC 3105 Open Know-How (`okh.json`) manifests.
- **Standard Interop Gateways**: OSLC 3.0 (Open Services for Lifecycle Collaboration) REST endpoints, OMG SysML v2 REST API, and ReqIF 1.2 synchronization.
- **Auditing & Compliance Reports**:
  - **CTRF**: Common Test Report Format output for CI/CD test tracking.
  - **SARIF**: Static Analysis Results Interchange Format for deep linter and static verification diagnostics in GitHub Code Scanning.
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

| Service     | Port / URL              | Description                                                        |
| ----------- | ----------------------- | ------------------------------------------------------------------ |
| **API**     | `http://localhost:3000` | REST / GraphQL / SPARQL / MCP SSE API server                       |
| **Web**     | `http://localhost:3001` | Package registry, social engineering hub, and `/playground`        |
| **IDE**     | `http://localhost:3003` | Browser-based VS Code Web IDE                                      |
| **Docs**    | `http://localhost:5173` | VitePress documentation portal                                     |
| **Desktop** | `npm run dev:desktop`   | Native Tauri v2 air-gapped desktop studio (`@modelscript/desktop`) |

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

| Service         | Port           | Protocol | Description                                                            |
| --------------- | -------------- | -------- | ---------------------------------------------------------------------- |
| **API**         | `3000`         | HTTP     | Backend simulation, GraphQL, SPARQL, and verification API              |
| **Web**         | `3001`         | HTTP     | Library registry, hub, and visual playground (`/playground`)           |
| **IDE**         | `3003`         | HTTP     | Browser-based VS Code IDE with language server integration             |
| **MQTT**        | `1883`, `9001` | TCP, WS  | Eclipse Mosquitto broker for event bus & telemetry streaming           |
| **TimescaleDB** | `5432`         | TCP      | Time-series database for telemetry historian & simulation trajectories |

---

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
