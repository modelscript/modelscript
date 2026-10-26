# Polyglot Language Ecosystem

ModelScript is not a single-language compiler—it is a **polyglot systems engineering framework**. All engineering languages share the same WebAssembly GLR parser compiler (`@modelscript/dsl`), the same `SymbolIndex` and `WorkspaceIndex` architecture, and the same Triple Graph Grammar (TGG) synchronization engine.

---

## Supported Engineering Languages

| Language                                     | Package                     | Extensions                               | Engineering Domain                                                                 |
| :------------------------------------------- | :-------------------------- | :--------------------------------------- | :--------------------------------------------------------------------------------- |
| **[Modelica 3.x](./modelica)**               | `@modelscript/modelica`     | `.mo`                                    | Multi-domain acausal physical modeling & DAE simulation                            |
| **[SysML v2 & KerML](./sysml2)**             | `@modelscript/sysml2`       | `.sysml, .sysml2, .kerml`                | Systems architecture, requirements, state machines & verification                  |
| **[MATLAB Simulink](./simulink)**            | `@modelscript/simulink`     | `.slx, .mdl`                             | Continuous/discrete control block diagrams & state-space transfer functions        |
| **[AUTOSAR](./autosar)**                     | `@modelscript/autosar`      | `.arxml`                                 | Automotive Classic & Adaptive ECU architectures & Virtual RTE scheduling           |
| **[ReqIF Requirements](./reqif)**            | `@modelscript/reqif`        | `.reqif, .reqifz`                        | Computable digital contracts & Nelson-Oppen formal entailment verification         |
| **[SPICE Electronics](./spice)**             | `@modelscript/spice`        | `.cir, .sp, .net, .lib`                  | Analog circuit netlists, OP, TRAN, AC frequency sweeps & ECAD graph generation     |
| **[SIMPACK MBD](./simpack)**                 | `@modelscript/simpack`      | `.spck, .sim, .mbs`                      | High-frequency multibody dynamics, spatial joints & flexible body synthesis        |
| **[GENSYS Railway](./gensys)**               | `@modelscript/gensys`       | `.calc, .geom, .track`                   | Railway vehicle dynamics, FASTSIM wheel-rail contact & EN 14363 homologation       |
| **[MSC Adams](./adams)**                     | `@modelscript/adams`        | `.adm, .cmd`                             | Mechanical system dynamics, 3D kinematic joints & Grübler mobility analysis        |
| **[URDF Robotics](./urdf)**                  | `@modelscript/urdf`         | `.urdf, .xacro`                          | Robot kinematic trees, joint limits & Featherstone recursive dynamics (ABA/RNEA)   |
| **[PSCAD / EMT](./pscad)**                   | `@modelscript/pscad`        | `.pscx, .pslx, .pswx, .psmx, .cfg, .dat` | Electromagnetic transients, power networks & IEEE 2800 ride-through compliance     |
| **[PSS/E Power Flow](./psse)**               | `@modelscript/psse`         | `.raw, .dyr, .con`                       | Large-scale power transmission grid power flow & dynamic stability                 |
| **[OLGA Multiphase](./olga)**                | `@modelscript/olga`         | `.opi, .key, .genkey, .tab`              | High-fidelity transient multiphase dynamic flow assurance & slug tracking          |
| **[PipelineStudio](./lps)**                  | `@modelscript/lps`          | `.lps, .tgx, .tlx, .tgn, .tln`           | Gas & liquid pipeline transmission, line pack, batch tracking & surge              |
| **[EASY5](./easy5)**                         | `@modelscript/easy5`        | `.ez5, .ezm, .ezd, .eas, .tab`           | Classical & modern dynamic simulation, linear state space analysis & trim          |
| **[GT-SUITE](./gtsuite)**                    | `@modelscript/gtsuite`      | `.gtm, .gtd, .gtx, .gt`                  | 1D powertrain, engine combustion, turbocharging & thermo-fluids                    |
| **[SIMA (SIMO / RIFLEX)](./sima)**           | `@modelscript/sima`         | `.inp, .sima, .sys, .hyd`                | Marine hydrodynamics, station keeping, catenary mooring & slender dynamics         |
| **[ROCETS](./rocets)**                       | `@modelscript/rocets`       | `.roc, .deck, .map`                      | Liquid rocket engine transient simulation, turbomachinery & combustion balance     |
| **[STEP (ISO 10303)](./step)**               | `@modelscript/step`         | `.step, .stp, .p21`                      | Mechanical CAD B-Rep geometry, assemblies & kinematic joints                       |
| **[OWL2 Ontology](./owl2)**                  | `@modelscript/owl2`         | `.owl, .owl2, .ofn, .ttl`                | Formal knowledge graphs, DL reasoning & SPARQL querying                            |
| **[OpenSCAD](./scad)**                       | `@modelscript/scad`         | `.scad`                                  | Parametric Constructive Solid Geometry (CSG)                                       |
| **[SSP 1.0 / 2.0](./ssp)**                   | `@modelscript/ssp`          | `.ssp, .ssd, .ssv`                       | Co-Simulation System Structure & Parameterization                                  |
| **[CFD (SU2 & OpenFOAM)](./cfd)**            | `@modelscript/cfd`          | `.cfd, .cfg, .cfgt, .su2`                | Computational Fluid Dynamics solver configuration & boundary markers               |
| **[FEA Structural](./fea)**                  | `@modelscript/fea`          | `.fea, .inp, .inpt, .bdf`                | CalculiX / Abaqus (`.inp`, `.inpt`) & NASTRAN (`.bdf`) structural mechanics        |
| **[CSV Telemetry](./csv)**                   | `@modelscript/csv`          | `.csv`                                   | Tabular empirical measurement series & lookup tables                               |
| **[CCSDS Astrodynamics](./ccsds)**           | `@modelscript/ccsds`        | `.oem, .opm, .omm, .xtce`                | Space mission astrodynamics, Cowell orbit propagation & satellite telemetry        |
| **[EnergyPlus Thermal](./energyplus)**       | `@modelscript/energyplus`   | `.idf, .epjson`                          | Building energy simulation, multi-zone thermal capacitance & HVAC systems          |
| **[EPANET Hydraulics](./epanet)**            | `@modelscript/epanet`       | `.inp`                                   | Municipal water distribution networks, Todini GGM & pressure loop equilibrium      |
| **[OpenDRIVE Roads](./opendrive)**           | `@modelscript/opendrive`    | `.xodr, .xml`                            | Road networks, analytical Fresnel clothoids & vehicle path-following kinematics    |
| **[PLCopen Automation](./plcopen)**          | `@modelscript/plcopen`      | `.xml, .plcopen, .st`                    | IEC 61131-3 industrial control logic, Virtual PLC execution & discrete DAEs        |
| **[Verilog-A Devices](./verilog-a)**         | `@modelscript/verilog-a`    | `.va, .vams`                             | IEEE 1857 analog behavioral modeling, compact semiconductor devices & SPICE        |
| **[Fortran Subroutines](./fortran)**         | `@modelscript/fortran`      | `.f, .for, .f77, .f90`                   | Legacy scientific computing subroutines, intrinsic math & TGG function wrapping    |
| **[C Integration](./c)**                     | `@modelscript/c`            | `.c, .h`                                 | Embedded control algorithms, Modelica external "C", S-functions & DAE lowering     |
| **[Aspen Chemical Process](./aspen)**        | `@modelscript/aspen`        | `.in, .inp, .bkp`                        | Chemical process flowsheets, flash VLE (Rachford-Rice), RadFrac column MESH DAEs   |
| **[SWMM Urban Hydrology](./swmm)**           | `@modelscript/swmm`         | `.inp`                                   | Stormwater drainage networks, 1D Saint-Venant dynamic wave & Manning open channels |
| **[Touchstone RF / SI](./touchstone)**       | `@modelscript/touchstone`   | `.s1p, .s2p, .s3p, .s4p, .sNp, .ts`      | Multi-port S-parameters, Vector Fitting rational macromodeling & passivity bounds  |
| **[IBIS Buffers](./ibis)**                   | `@modelscript/ibis`         | `.ibs`                                   | ANSI/EIA-656 buffer driver/receiver I/V curves, switching ramps & package RLC      |
| **[OpenDSS Distribution](./opendss)**        | `@modelscript/opendss`      | `.dss`                                   | Multi-phase unbalanced AC distribution grids, DER hosting capacity & power flow    |
| **[OpenSCENARIO AV Safety](./openscenario)** | `@modelscript/openscenario` | `.xosc, .osc`                            | ASAM autonomous vehicle scenarios, Time-To-Collision & Mobileye RSS safety bounds  |
| **[RELAP5 Nuclear Loops](./relap5)**         | `@modelscript/relap5`       | `.i, .inp, .r5`                          | Nuclear reactor 2-phase 6-equation hydrodynamics & 6-group delayed point kinetics  |
| **[ECLIPSE Reservoir](./eclipse)**           | `@modelscript/eclipse`      | `.data, .dat, .inc`                      | Multiphase 3D black-oil Darcy depletion, Peaceman well productivity & Havlena-Odeh |
| **[SBML Systems Biology](./sbml)**           | `@modelscript/sbml`         | `.sbml, .xml`                            | Biochemical reaction networks, mass-action enzyme kinetics ODEs & RK4 integration  |
| **[JSBSim Flight Dynamics](./jsbsim)**       | `@modelscript/jsbsim`       | `.xml`                                   | 6-DOF non-linear rigid-body aircraft flight dynamics & automatic cruise trim       |
| **[ModelScript](./modelscript)**             | `@modelscript/modelscript`  | `.msx, .modelscript`                     | Native systems scripting, `@unmanaged struct` WASM/C++ kernels & FLWOR queries     |

---

## Unified Polyglot Pipeline

Every language plugin implements the `LanguageDefinition` interface (`packages/dsl/src/language.ts`):

1. **Grammar DSL (`defineGrammar`)**: Compiled Ahead-of-Time into a compact `.wasm` binary parser table.
2. **Symbol Indexer (`SymbolIndexer`)**: Walks the linear-memory CST and populates `SymbolEntry` declarations into the global `WorkspaceIndex`.
3. **Salsa Queries (`queries`)**: Memoized semantic analyses (type resolution, unit inference, structural validation).
4. **Compiler Lints (`lints`)**: Real-time diagnostics surfaced identically in the CLI (`msx lint`), LSP server, and Web IDE.
5. **TGG Rules (`tggRules`)**: Declarative bidirectional synchronization rules linking AST nodes across languages (e.g., `SysMLv2 PartUsage` $\leftrightarrow$ `Modelica Component` $\leftrightarrow$ `STEP Product` $\leftrightarrow$ `ModelScript Struct`).
