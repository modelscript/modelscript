# Polyglot Language Ecosystem

ModelScript is not a single-language compiler—it is a **polyglot systems engineering framework**. All engineering languages share the same WebAssembly GLR parser compiler (`@modelscript/dsl`), the same `SymbolIndex` and `WorkspaceIndex` architecture, and the same Triple Graph Grammar (TGG) synchronization engine.

---

## Supported Engineering Languages

| Language                           | Package                    | Extensions                               | Engineering Domain                                                             |
| :--------------------------------- | :------------------------- | :--------------------------------------- | :----------------------------------------------------------------------------- |
| **[Modelica 3.x](./modelica)**     | `@modelscript/modelica`    | `.mo`                                    | Multi-domain acausal physical modeling & DAE simulation                        |
| **[SysML v2 & KerML](./sysml2)**   | `@modelscript/sysml2`      | `.sysml, .sysml2, .kerml`                | Systems architecture, requirements, state machines & verification              |
| **[STEP (ISO 10303)](./step)**     | `@modelscript/step`        | `.step, .stp, .p21`                      | Mechanical CAD B-Rep geometry, assemblies & kinematic joints                   |
| **[OWL2 Ontology](./owl2)**        | `@modelscript/owl2`        | `.owl, .owl2, .ofn, .ttl`                | Formal knowledge graphs, DL reasoning & SPARQL querying                        |
| **[OpenSCAD](./scad)**             | `@modelscript/scad`        | `.scad`                                  | Parametric Constructive Solid Geometry (CSG)                                   |
| **[SSP 1.0 / 2.0](./ssp)**         | `@modelscript/ssp`         | `.ssp, .ssd, .ssv`                       | Co-Simulation System Structure & Parameterization                              |
| **[PSCAD / EMT](./pscad)**         | `@modelscript/pscad`       | `.pscx, .pslx, .pswx, .psmx, .cfg, .dat` | Electromagnetic transients, power networks & COMTRADE waveforms                |
| **[CFD (SU2 & OpenFOAM)](./cfd)**  | `@modelscript/cfd`         | `.cfd, .cfg, .cfgt, .su2`                | Computational Fluid Dynamics solver configuration & boundary markers           |
| **[FEA](./fea)**                   | `@modelscript/fea`         | `.fea, .inp, .inpt, .bdf`                | CalculiX / Abaqus (`.inp`, `.inpt`) & NASTRAN (`.bdf`) structural mechanics    |
| **[CSV](./csv)**                   | `@modelscript/csv`         | `.csv`                                   | Tabular empirical measurement series & lookup tables                           |
| **[OLGA](./olga)**                 | `@modelscript/olga`        | `.opi, .key, .genkey, .tab`              | High-fidelity transient multiphase dynamic flow assurance                      |
| **[PipelineStudio](./lps)**        | `@modelscript/lps`         | `.lps, .tgx, .tlx, .tgn, .tln`           | Gas & liquid pipeline transmission, line pack, batch tracking & surge          |
| **[PSS/E](./psse)**                | `@modelscript/psse`        | `.raw, .dyr, .con`                       | Power transmission grid power flow & dynamic stability                         |
| **[EASY5](./easy5)**               | `@modelscript/easy5`       | `.ez5, .ezm, .ezd, .eas, .tab`           | Classical & modern dynamic simulation, linear state space analysis & trim      |
| **[ROCETS](./rocets)**             | `@modelscript/rocets`      | `.roc, .deck, .map`                      | Liquid rocket engine transient simulation, turbomachinery & combustion balance |
| **[SIMA (SIMO / RIFLEX)](./sima)** | `@modelscript/sima`        | `.inp, .sima, .sys, .hyd`                | Marine hydrodynamics, station keeping, catenary mooring & slender dynamics     |
| **[GT-SUITE](./gtsuite)**          | `@modelscript/gtsuite`     | `.gtm, .gtd, .gtx, .gt`                  | 1D powertrain, engine combustion, turbocharging & thermo-fluids                |
| **[ModelScript](./modelscript)**   | `@modelscript/modelscript` | `.msx, .modelscript`                     | Native systems scripting, `@unmanaged struct` WASM/C++ kernels & FLWOR queries |

---

## Unified Polyglot Pipeline

Every language plugin implements the `LanguageDefinition` interface (`packages/dsl/src/language.ts`):

1. **Grammar DSL (`defineGrammar`)**: Compiled Ahead-of-Time into a compact `.wasm` binary parser table.
2. **Symbol Indexer (`SymbolIndexer`)**: Walks the linear-memory CST and populates `SymbolEntry` declarations into the global `WorkspaceIndex`.
3. **Salsa Queries (`queries`)**: Memoized semantic analyses (type resolution, unit inference, structural validation).
4. **Compiler Lints (`lints`)**: Real-time diagnostics surfaced identically in the CLI (`msx lint`), LSP server, and Web IDE.
5. **TGG Rules (`tggRules`)**: Declarative bidirectional synchronization rules linking AST nodes across languages (e.g., `SysMLv2 PartUsage` $\leftrightarrow$ `Modelica Component` $\leftrightarrow$ `STEP Product` $\leftrightarrow$ `ModelScript Struct`).
