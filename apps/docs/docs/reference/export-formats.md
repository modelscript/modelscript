# Export & Exchange Formats Reference

ModelScript serves as an open interoperability hub across systems engineering, multi-physics simulation, CAD/ECAD, formal verification, and regulatory compliance. Through `@modelscript/exchange`, `@modelscript/cad`, `@modelscript/runtime`, and `@modelscript/simulate`, the platform natively imports and exports **over 30 industry-standard formats**.

---

## 1. Functional Mock-up Interface (FMI 2.0 & FMI 3.0)

ModelScript compiles flattened DAE systems into self-contained `.fmu` archives (and imports external third-party `.fmu` binaries) conforming to the Modelica Association **FMI 2.0** and **FMI 3.0** specifications for both **Model Exchange (ME)** and **Co-Simulation (CS)**.

```bash
# Export an FMI 3.0 Co-Simulation FMU with embedded C99 source and WebAssembly binary
npx msx fmu DC_Motor motor.mo --fmi-version 3 --type cs --wasm --output DC_Motor.fmu

# Export a universal FMI 2.0 + 3.0 archive supporting both ME and CS
npx msx fmu ThermalPlant plant.mo --fmi-version both --type both --target all -o ThermalPlant.fmu

# Import an external third-party FMU and synthesize a typed Modelica wrapper block
npx msx import-fmu ./vendor/BatteryController.fmu -o BatteryControllerWrapper.mo
```

### Archive Layout & Capabilities

| Artifact Path                            | Standard      | Description                                                                                                                                                                                                                                                          |
| :--------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelDescription.xml`                   | FMI 2.0 / 3.0 | Declares `ModelVariables`, causalities (`input`, `output`, `parameter`, `local`), physical units, `ModelStructure` (`Outputs`, `Derivatives`, `InitialUnknowns`), directional derivative sparsity patterns, and FMI 3.0 `Clock` / multidimensional array dimensions. |
| `sources/*.c`, `sources/*.h`             | ANSI C99      | Zero-dependency generated C99 implementation of `fmi2*` / `fmi3*` entry points, analytic Jacobians (`fmi2GetDirectionalDerivative` / `fmi3GetDirectionalDerivative`), and embedded RK4/BDF Co-Simulation steppers.                                                   |
| `binaries/<platform>/*.so\|.dll\|.dylib` | Native ABI    | Pre-compiled host shared libraries generated when `--compile` is passed.                                                                                                                                                                                             |
| `binaries/wasm32-wasi/<model>.wasm`      | WebAssembly   | Portable, sandboxed WASM FMU binary generated when `--wasm` or `--target wasm` is passed, executable directly in browser workers and edge runtimes.                                                                                                                  |

### Universal Binary FMUs & In-WASM CPU Emulation

A major limitation of traditional FMI co-simulation is platform lock-in: an FMU containing a Windows x86 `.dll` cannot run on Linux or Apple Silicon without native source access.

Through `@modelscript/exchange/pe-emulator`, ModelScript includes **user-space CPU emulators and binary loaders executing inside WebAssembly**:

- **Cross-Architecture Execution**: Runs legacy Windows x86/x64 (`.dll`), Linux ELF (`.so`), and macOS Mach-O (`.dylib`) binary FMUs directly inside Node.js, browsers, or cloud runners without installing Wine or virtual machines.
- **CPU Translation Engines**:
  - **x86 / x86-64 Engine (`x86-cpu.ts`)**: Decodes instruction prefixes, registers, and floating-point/AVX2 vector instructions into typed array memory operations.
  - **AArch64 Engine (`aarch64-cpu.ts`)**: Decodes 64-bit ARM instruction streams and executes floating-point NEON vectors.
  - **C Runtime Shims (`c-runtime-shims.ts`)**: Traps standard C library calls (`malloc`, `free`, `sin`, `cos`, `printf`, `memcpy`) and routes them directly to host memory for native execution speed.
- **In-Browser C Compilation Worker (`wasm-compiler-worker.ts`)**:
  - Compiles FMI C99 source code into sandboxed WebAssembly modules on the fly directly inside browser WebWorkers.
  - Eliminates the need for server-side GCC/Clang compilation infrastructure when simulating customer models in the browser.

---

## 2. System Structure and Parameterization (SSP 1.0 & SSV 1.0)

ModelScript natively parses, lints (`SSP_*` and `SSV_*` rules), simulates, and packages **Modelica Association SSP 1.0** system containers:

| Extension | XML Namespace                                                  | Purpose                                                                                                                                                   |
| :-------- | :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ssp`    | ZIP Container                                                  | Bundles `SystemStructure.ssd`, `resources/*.fmu` components, parameter sets (`*.ssv`), and signal dictionaries (`*.ssm`).                                 |
| `.ssd`    | `http://ssp-standard.org/SSP1/SystemStructureDescription`      | Defines hierarchical system architectures, FMU component references, typed connectors, causal signal connections, and `<ssd:DefaultExperiment>` metadata. |
| `.ssv`    | `http://ssp-standard.org/SSP1/SystemStructureParameterValues`  | Externalizes parameter sets (`Real`, `Integer`, `Boolean`, `String`, `Enumeration`, and units) for variant management without recompiling FMUs.           |
| `.ssm`    | `http://ssp-standard.org/SSP1/SystemStructureParameterMapping` | Maps abstract parameter names in `.ssv` catalogs to concrete hierarchical component paths.                                                                |

```bash
# Lint an SSP architecture and its SSV parameter bindings
npx msx lint SystemStructure.ssd NominalParams.ssv

# Export a multi-project PSCAD workspace to an SSP 1.0 container
npx msx pscad export-ssp GridInterconnection.pswx -o GridInterconnection.ssp
```

---

## 3. Formal Verification & Theorem Proving Formats

The `msx export-formal` command lowers flattened DAE systems, synchronous clock partitions, and hybrid state machines into five formal verification languages for external model checkers and interactive theorem provers:

```bash
# Export a discrete-time transition encoding to SMT-LIB v2 for Z3 / cvc5
npx msx export-formal FlightControl fcs.mo --format smt2 --dt 0.005 -o fcs.smt2

# Export synchronous dataflow equations to Lustre v6 (Kind 2 / Lesar)
npx msx export-formal FlightControl fcs.mo --format lustre -o fcs.lus

# Export finite-state and quantized hybrid dynamics to NuSMV / nuXmv
npx msx export-formal FlightControl fcs.mo --format nusmv -o fcs.smv

# Export distributed state transitions and temporal invariants to TLA+ (TLC / Apalache)
npx msx export-formal RedundantBus bus.mo --format tla -o RedundantBus.tla

# Export continuous ODEs + discrete guards to KeYmaera X Differential Dynamic Logic (dL)
npx msx export-formal AdaptiveCruise acc.mo --format keymaera -o acc.kyx
```

| Format Flag | Extension | Target Toolchains          | Encoding Semantics                                                                                                                                                        |
| :---------- | :-------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `smt2`      | `.smt2`   | Z3, cvc5, MathSAT, Yices 2 | QF*NRA / QF_LRA unrolled transition relation $\mathcal{I}(\mathbf{x}\_0) \land \bigwedge*{k} \mathcal{T}(\mathbf{x}_k, \mathbf{x}_{k+1})$ with negated safety assertions. |
| `lustre`    | `.lus`    | Kind 2, JKind, Lustre v6   | Synchronous dataflow `node` with `pre` / `->` temporal operators and `--%PROPERTY` observer annotations.                                                                  |
| `nusmv`     | `.smv`    | NuSMV, nuXmv               | Symbolic transition system (`MODULE main`, `VAR`, `INIT`, `TRANS`) with `INVARSPEC` and `LTLSPEC` properties.                                                             |
| `tla`       | `.tla`    | TLC, Apalache              | TLA+ `MODULE` with `Init`, `Next`, state variables `VARIABLES`, and temporal `Spec == Init /\ [][Next]_vars`.                                                             |
| `keymaera`  | `.kyx`    | KeYmaera X                 | Differential Dynamic Logic ($\text{d}\mathcal{L}$) `ArchiveEntry` combining hybrid programs (`{x' = f(x) & H(x)}*`) and postcondition invariants.                         |

---

## 4. CI/CD Quality Gates & Regulatory Compliance Dossiers

The `msx verify` and `msx dhf` commands serialize static diagnostics, formal proof certificates, and requirement traceability matrices into industry-standard CI/CD and regulatory formats:

```bash
# SARIF v2.1.0 for GitHub Code Scanning / Azure DevOps Security Tab
npx msx verify system.mo --format sarif --report linter-report.sarif

# CTRF (Common Test Report Format) JSON for unified CI dashboards
npx msx verify system.mo --format ctrf --report ctrf-report.json

# JUnit XML for Jenkins, GitLab CI, and CircleCI test summaries
npx msx verify system.mo --format junit --report junit-report.xml

# FDA 21 CFR Part 820 / ISO 13485 / ISO 26262 Design History File (DHF) Dossier
npx msx verify system.mo --format dhf --report dossier.md
npx msx dhf export ./workspace --format markdown -o DHF_Dossier.md
```

| Format              | Schema / Standard             | Key Payload Contents                                                                                                                                        |
| :------------------ | :---------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SARIF** (`sarif`) | OASIS SARIF v2.1.0            | Rule descriptors (`M1000`–`M6040`, `S1001`–`S5008`), physical file locations (1-indexed line/column spans), severity levels, and counterexample code flows. |
| **CTRF** (`ctrf`)   | CTRF v0.0.0 JSON              | Standardized `results.summary` (`tests`, `passed`, `failed`, `skipped`) and per-property verification duration and witness traces.                          |
| **JUnit** (`junit`) | JUnit XML                     | `<testsuites>` and `<testcase>` elements with `<failure>` stack traces for falsified invariants or lint errors.                                             |
| **DHF** (`dhf`)     | FDA 21 CFR 820.30 / ISO 13485 | End-to-end Requirements Traceability Matrix (RTM), formal proof summaries, simulation verification evidence, and SHA-256 artifact integrity digests.        |

---

## 5. Systems Engineering & Requirements Interop (SysML v2, ReqIF, OSLC, OWL2)

ModelScript bridges descriptive MBSE specifications and semantic knowledge graphs with executable physics:

| Standard                         | Extensions / Media Types                                                  | CLI Command / API                                                                | Description                                                                                                                                                                         |
| :------------------------------- | :------------------------------------------------------------------------ | :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OMG SysML v2 / KerML**         | `.sysml`, `.kerml`, `application/json`                                    | `msx sysml <export\|import\|sync>` & REST `/api/v1/sysml2`                       | Textual SysML v2 notation and full **OMG Systems Modeling API and Services v2.0** REST compliance (`projects`, `commits`, `branches`, `tags`, `elements`, `relationships`).         |
| **OMG ReqIF 1.2**                | `.reqif`, `.reqifz`                                                       | `msx reqif <import\|export>`                                                     | Bidirectional mapping between DOORS/Polarion ReqIF `SPEC-OBJECT` / `SPEC-RELATION` hierarchies and SysML v2 `requirement def` / `satisfy` blocks.                                   |
| **OASIS OSLC 3.0 & TRS 3.0**     | `.ttl`, `.jsonld`, `.rdf`                                                 | `msx oslc <export\|serve>`                                                       | Exposes requirements (`oslc_rm:Requirement`) and architecture resources (`oslc_am:Resource`) with Tracked Resource Set (TRS 3.0) incremental change logs and delegated UI previews. |
| **W3C OWL 2 / RDF / SPARQL 1.1** | `.owl` (Functional Syntax), `.ttl` (Turtle), `.nt` (N-Triples), `.jsonld` | `/api/v1/libraries/rdf`, `/api/v1/libraries/sparql`, MCP `query_ontology_sparql` | Extracts ontological axioms, executes OWL 2 RL forward-chaining reasoning, and answers SPARQL 1.1 queries over workspace models.                                                    |

---

## 6. Industrial Digital Twin & Open Hardware Packaging (DDP, AASX, OKH)

For manufacturing handover, Industry 4.0 asset integration, and open-source hardware certification, ModelScript supports three complementary packaging standards:

```bash
# Pack a workspace into an ISO/PAS 81346 Digital Data Package (.ddp)
npx msx ddp pack ./workspace -o PumpStation.ddp

# Convert a DDP archive into an IDTA Asset Administration Shell v3.0 (.aasx) package
npx msx ddp to-aasx PumpStation.ddp -o PumpStation.aasx
```

| Standard                      | Format / Endpoint                                  | Description                                                                                                                                                 |
| :---------------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ISO/PAS 81346 DDP**         | `.ddp` (ZIP + XML/JSON)                            | Structures multi-domain engineering deliverables by function (`=`), product (`-`), and location (`+`) reference designation aspect trees.                   |
| **IDTA AAS v3.0**             | `.aasx` (Open Packaging Conventions) & `?lens=aas` | Packages Asset Administration Shells containing standardized `Nameplate`, `TechnicalData`, `HandoverDocumentation`, and `SimulationModels` (FMU) submodels. |
| **DIN SPEC 3105 / OSHWA OKH** | `okh.json` / `okh.toml` & `?lens=okh`              | Generates Open Know-How (OKH v1.0) manifests detailing bill of materials (BOM), CAD/ECAD design files, manufacturing tolerances, and SPDX licenses.         |

---

## 7. CAD, ECAD & Multi-Physics CAE Formats (STEP, CSG, Gerber, SU2, CalculiX)

`@modelscript/cad` and the polyglot language plugins provide direct geometric and mesh interoperability:

| Domain                         | Format / Standard                                              | Extensions                               | Capabilities                                                                                                                                                              |
| :----------------------------- | :------------------------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **3D B-Rep CAD**               | **ISO 10303-21 STEP** (AP203 / AP214 / AP242)                  | `.stp`, `.step`                          | Native GLR parser for `DATA` entity graphs (`ADVANCED_FACE`, `B_SPLINE_SURFACE_WITH_KNOTS`, `MANIFOLD_SOLID_BREP`, `PRODUCT_DEFINITION`) and OpenCASCADE B-Rep export.    |
| **Parametric CSG & Meshes**    | **OpenSCAD**, **STL**, **OBJ**, **glTF 2.0 / GLB**             | `.scad`, `.stl`, `.obj`, `.gltf`, `.glb` | Evaluates `.scad` scripts and Modelica `Visualizers` (`msx csg`) into watertight boundary-representation solids and triangulated 3D web assets.                           |
| **ECAD / PCB Manufacturing**   | **Gerber RS-274X / X2**, **Excellon**, **IPC-2581**, **ODB++** | `.gbr`, `.gtl`, `.gbl`, `.drl`           | Parses aperture definitions (`%ADD...*%`), copper traces, solder mask layers, and NC drill coordinates for 3D PCB stackup rendering and thermal-electrical co-simulation. |
| **CFD (Fluid Dynamics)**       | **SU2**, **OpenFOAM**, **CGNS / VTK**                          | `.cfg`, `.su2`, `.vtk`                   | Parses and validates SU2 solver configurations (`SOLVER=RANS`, boundary markers, CFL schedules) and unstructured finite-volume meshes (`NDIME=`, `NELEM=`, `NPOIN=`).     |
| **FEA (Structural / Thermal)** | **Abaqus / CalculiX**, **Nastran BDF**                         | `.inp`, `.bdf`, `.frd`                   | Parses `*NODE`, `*ELEMENT`, `*MATERIAL`, `*ELASTIC`, `*STEP`, and `*BOUNDARY` decks for thermo-mechanical ROM extraction and stress verification.                         |

---

## 8. Power Systems & Electronics (PSCAD & SPICE)

| Format             | Extensions                    | CLI / Tooling                                                                  | Capabilities                                                                                                                                                                         |
| :----------------- | :---------------------------- | :----------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSCAD EMT**      | `.pscx`, `.pswx`, `.psmx`     | `msx pscad <lint\|diagram\|sim\|verify-ieee2800\|export-modelica\|export-ssp>` | Parses hierarchical XML schematics, Blackbox/CSMF control blocks, transmission line segments, and executes nodal admittance EMT simulation and IEEE Std 2800-2022 compliance checks. |
| **SPICE Netlists** | `.sp`, `.cir`, `.net`, `.sub` | TGG Synchronization (`msx align`) & `@modelscript/modelica`                    | Bi-directionally maps SPICE netlists (`.subckt`, `R`, `L`, `C`, `M` MOSFET, `Q` BJT, `V`, `I`) to `Modelica.Electrical.Analog` / `Spice3` components.                                |

---

## 9. Surrogate Modeling & Machine Learning (ONNX, C99, Modelica ROM)

The `msx surrogate` pipeline exports trained Reduced-Order Models (MLP neural networks, multivariate polynomials, and Radial Basis Functions) with embedded domain-validity guardrails:

```bash
# Train an MLP surrogate and export ONNX, standalone C99, and pure Modelica (.mo) simultaneously
npx msx surrogate Compressor compressor.mo \
  --inputs "rpm,pressureRatio" \
  --input-bounds "rpm:1000:12000,pressureRatio:1.1:4.5" \
  --outputs "massFlow,efficiency" \
  --format all \
  --out-file build/compressor_rom
```

- **ONNX (`.onnx`)**: Serializes weights, biases, input normalization scalers, and activation layers (`Tanh`, `ReLU`, `GELU`) as a standard ONNX protobuf graph for deployment in ONNX Runtime, TensorRT, or PyTorch. Can also be imported via `--from-onnx`.
- **Standalone ANSI C99 (`.c` / `.h`)**: Zero-dependency static C inference function with compile-time weight arrays and bounding-box extrapolation flags for embedded MCU deployment.
- **Modelica Block (`.mo`)**: Self-contained Modelica `block` containing pure matrix/vector equations, `isExtrapolating` boolean output port, and `assert()` guardrails.

---

## 10. Simulation Trajectories & Scientific Data (CSV, JSON, MAT v4, HDF5, Parquet)

Simulation and Monte Carlo runners (`msx simulate`, `msx mc`, and Cloud HPC workers) produce structured time-series outputs:

```bash
# Export standard RFC 4180 CSV trajectory
npx msx simulate DC_Motor motor.mo --stop-time 5.0 --format csv > trajectory.csv

# Export structured JSON trajectory with variable metadata and solver statistics
npx msx simulate DC_Motor motor.mo --stop-time 5.0 --format json > trajectory.json
```

| Format                      | Source / Consumer                                                      | Description                                                                                                                                                                                             |
| :-------------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CSV (`.csv`)**            | `msx simulate --format csv`, `msx mc --format csv`, `@modelscript/csv` | Leading monotonic `time` column followed by state, derivative (`der(...)`), and algebraic variable columns; directly consumable by `Modelica.Blocks.Tables.CombiTimeTable` and `msl-comparison-runner`. |
| **JSON (`.json`)**          | `msx simulate --format json`, `msx mc --format json`                   | Contains `time: number[]`, `signals: Record<string, number[]>`, `units: Record<string, string>`, `events`, and solver convergence telemetry.                                                            |
| **MATLAB Level 4 (`.mat`)** | OpenModelica / Dymola compatibility                                    | Dual-matrix (`Aclass`, `name`, `description`, `dataInfo`, `data_1` parameters, `data_2` trajectories) binary format for legacy post-processing scripts.                                                 |
| **Apache Parquet & HDF5**   | Cloud HPC (`msx cloud download`) & Digital Twin Archive                | Columnar Zstandard-compressed trajectory storage for multi-gigabyte Monte Carlo ensembles and long-horizon operational twin logs.                                                                       |

---

## 11. Interactive Notebooks & Visual Diagrams (`.monb`, SVG, HTML)

| Artifact                                              | Producer                                                                | Description                                                                                                                                                                                            |
| :---------------------------------------------------- | :---------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ModelScript Notebook (`.monb`)**                    | VS Code / Web IDE (`modelscript.monbNotebook`)                          | JSON document format interleaving GitHub-Flavored Markdown + KaTeX cells with executable `.mo`, `.sysml`, and `.msx` cells and inline interactive Plotly/SVG simulation outputs.                       |
| **Vector Diagrams (`.svg`)**                          | `msx render`, `msx pscad diagram`, `msx pr-diff --format visual-svg`    | Standalone, CSS-styled SVG schematics with ELK orthogonal port routing, Modelica `Icon`/`Diagram` coordinate graphics, SysML v2 BDD/IBD/State/Activity compartments, and dark/blueprint theme support. |
| **Interactive Diff & Benchmark Dashboards (`.html`)** | `msx pr-diff --format visual-html`, `npm run test:msl -- --report-html` | Self-contained, dark-mode HTML reports with pan/zoom SVG diff overlays and interactive trajectory error charts.                                                                                        |
