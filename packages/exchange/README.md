<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/exchange

ModelScript Standards & Interoperability Engine — Functional Mock-up Interface (**FMI 2.0 & 3.0**) FMU export and import, System Structure and Parameterization (**SSP 1.0**) packaging, Master Co-Simulation Orchestrator (`CoSimMaster`) with adaptive step-size & Hardware-in-the-Loop (HIL) participants, ISO/PAS 81346 Digital Data Package (**PSI 21 `.ddp`**), Industry 4.0 Asset Administration Shell (**IDTA `.aasx`**), **DIN SPEC 3105 `okh`** Open Know-How lens engine, and high-speed binary telemetry readers (**ASAM MDF4 `.mf4`**, **ROS 2 MCAP `.mcap`**).

---

## Architecture & Capabilities

### 1. FMI 2.0 & 3.0 FMU Export and Import (`@modelscript/exchange/fmu`)

- **Dual-Standard Export (`src/fmu/fmu.ts`, `src/fmu/fmi3.ts`, `src/fmu/archive.ts`)**: Packages flattened DAE systems into standard `.fmu` ZIP archives conforming to **FMI 2.0** and **FMI 3.0** for both **Model Exchange (ME)** and **Co-Simulation (CS)**.
- **Multi-Target Code Generation**:
  - **ANSI C99 (`src/fmu/fmu-codegen.ts`, `src/fmu/fmu3-codegen.ts`, `src/fmu/sundials-codegen.ts`)**: Emits zero-dependency C99 sources implementing `fmi2*` and `fmi3*` entry points, analytical directional derivatives (`fmi2GetDirectionalDerivative` / `fmi3GetDirectionalDerivative`, `src/fmu/ad-codegen.ts`), and embedded RK4 / BDF / SUNDIALS CVODE steppers.
  - **WebAssembly (`src/fmu/fmu-wasm-codegen.ts`, `src/fmu/fmu-as-codegen.ts`, `src/fmu/compile-wasm.ts`)**: Compiles models and Reduced-Order Models (`src/fmu/rom-wasm-codegen.ts`) into portable `binaries/wasm32-wasi/<model>.wasm` binaries for sandboxed browser and edge execution.
  - **JavaScript (`src/fmu/fmu-js-codegen.ts`)**: High-speed JIT JS FMU target for in-memory web worker co-simulation.
- **FMI-LS-BUS Networked Bus Topology (`src/fmu/fmi-ls-bus.ts`)**: Generates and validates `extra/org.fmi-standard.fmi-ls-bus/fmi-ls-bus.xml` descriptors and FMI 3.0 clocked binary bus variables for **CAN**, **CAN-FD**, **LIN**, **FlexRay**, and **Automotive Ethernet**.
- **Graphical Terminals & Icons (`src/fmu/model-description.ts`)**: Parses and emits `modelDescription.xml` and `terminalsAndIcons/terminalsAndIcons.xml` (`parseModelDescription`, `parseTerminalsAndIcons`).
- **External FMU Import (`src/fmu/wrapper-gen.ts`)**: Introspects third-party `.fmu` archives and synthesizes strongly typed Modelica wrapper blocks.

### 2. System Structure and Parameterization — SSP 1.0 (`@modelscript/exchange/ssp`)

- **Complete SSP 1.0 Lifecycle (`src/ssp/`)**: Parses, validates, imports, and packages `.ssp` archives containing:
  - `SystemStructure.ssd` (`src/ssp/ssd-parser.ts`): Hierarchical system topologies, component FMU references, typed connectors, connections, and `<ssd:DefaultExperiment>`.
  - `*.ssv` (`SystemStructureParameterValues`): Externalized parameter value catalogs with physical unit bindings.
  - `*.ssm` (`SystemStructureParameterMapping`): Parameter name-to-component path mappings.

### 3. Master Co-Simulation Orchestrator (`@modelscript/exchange/cosim`)

- **Master Algorithms (`src/cosim/orchestrator.ts`, `src/cosim/coupling.js`)**:
  - Supports **Jacobi** (parallel) and **Gauss-Seidel** (serial) communication schedules across heterogeneous FMU and continuum physics participants.
  - **Adaptive Macro Step-Size Control**: Richardson extrapolation and local truncation error estimation with FMI rollback (`fmi2GetFMUstate` / `fmi2SetFMUstate`).
  - **Fluid-Structure Interaction (FSI) Relaxation**: Aitken $\Delta^2$ dynamic under-relaxation and IQN-ILS stabilization for strongly coupled algebraic loops.
- **Real-Time & Hardware-in-the-Loop (HIL) Participants (`src/cosim/participants/`, `src/cosim/audio-worklet-clock.ts`)**:
  - `fmu-wasm.ts`, `fmu-wasm-worker-proxy.ts`, `fmu-native.ts`, `fmu-js.ts`: Executes WASM, native shared-library, and JS FMUs.
  - `fea-provider.ts`, `cfd-provider.ts`, `lbm-provider.ts`: Couples 3D continuum FEA and Lattice Boltzmann CFD solvers directly into the co-simulation loop.
  - `web-hardware.ts`: Real-time HIL I/O over **WebSerial**, **WebUSB**, and **UDP** sockets.
  - `audio-worklet-clock.ts` & `native-shm-provider.ts`: Sub-millisecond deterministic real-time pacing via browser `AudioWorklet` sample clocks and POSIX shared-memory (`shm`) ring buffers.
  - **MQTT & WebSocket Telemetry (`src/cosim/mqtt/`, `src/cosim/ws/`, `src/cosim/historian/`)**: Distributed MQTT broker integration (`aedes`), live WebSocket streaming, and deterministic trajectory recording/replay.

### 4. Industrial Digital Twin & Open Hardware Packaging (`ddp`, `aasx`, `lens`)

- **PSI 21 / ISO/PAS 81346 Digital Data Package (`src/ddp/`)**: Packages multi-domain workspace artifacts into `.ddp` containers organized by function (`=`), product (`-`), and location (`+`) reference designation aspects.
- **Industry 4.0 IDTA Asset Administration Shell v3.0 (`@modelscript/exchange/aasx`, `src/aasx/opc-packager.ts`)**: Generates Open Packaging Conventions (`.aasx`) archives containing standardized AAS v3.0 XML/JSON environments (`Nameplate`, `TechnicalData`, `HandoverDocumentation`, and `SimulationModels` submodels).
- **DIN SPEC 3105 Open Know-How Lens Engine (`@modelscript/exchange/lens`, `src/lens/lens-engine.ts`)**: Projects unified workspace graphs into **DIN SPEC 3105-1 (OKH v1.0)** open hardware manifests (`okh.json` / `okh.toml`), extracting bills of materials (BOM), STEP/STL geometry links, PCB Gerber manufacturing files, and SPDX license metadata.

### 5. Binary Telemetry Readers (`src/telemetry/`)

- **ASAM MDF 4.x Reader (`src/telemetry/mdf4_reader.ts`)**: Zero-copy binary parser for automotive **ASAM COMMON MDF 4.1/4.2 (`.mf4`)** measurement files (`HD`, `DG`, `CG`, `CN`, `DT`/`DZ` blocks), converting recorded vehicle CAN/sensor channels into time-series trajectories for digital twin calibration.
- **ROS 2 MCAP Reader (`src/telemetry/mcap_reader.ts`)**: High-speed binary reader for robotics **MCAP (`.mcap`)** container files, extracting timestamped topic messages and sensor streams.
- **Live Telemetry Streamer (`src/telemetry/telemetry_streamer.ts`)**: Synchronizes recorded `.mf4`/`.mcap` streams with live `CoSimMaster` execution.

---

## Subpath Exports

| Subpath                          | Description                                                                                                             |
| :------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `@modelscript/exchange`          | Root barrel re-exporting `fmu`, `ssp`, `cosim`, `ddp`, `aasx`, `lens`, `telemetry`, `variants`, `compliance`, and `hpc` |
| `@modelscript/exchange/fmu`      | FMI 2.0/3.0 FMU codegen (C99/WASM/JS), `fmi-ls-bus.xml`, `terminalsAndIcons.xml`, and `.fmu` archiver                   |
| `@modelscript/exchange/ssp`      | SSP 1.0 `.ssp`, `.ssd`, `.ssv`, and `.ssm` parser, importer, and exporter                                               |
| `@modelscript/exchange/cosim`    | `CoSimMaster` orchestrator, MQTT/WebSocket bus, HIL hardware participants, and historian                                |
| `@modelscript/exchange/aasx`     | Industry 4.0 IDTA AAS v3.0 `.aasx` Open Packaging Conventions packager                                                  |
| `@modelscript/exchange/lens`     | Multi-standard projection lens engine (DIN SPEC 3105 `okh`, AAS, OSLC)                                                  |
| `@modelscript/exchange/variants` | Variant management and parameter override resolution                                                                    |
| `@modelscript/exchange/hpc`      | Cloud HPC batch job manifest and distributed trajectory bundler                                                         |

---

## Scripts

```bash
# Build TypeScript package
npm run build --workspace=@modelscript/exchange

# Run unit and standards validation tests (FMI, SSP, CoSim, Lens, AASX, MDF4/MCAP)
npm run test --workspace=@modelscript/exchange

# Verify exported FMUs against official fmusim / OpenModelica
npm run test:fmusim --workspace=@modelscript/exchange
npm run test:omc --workspace=@modelscript/exchange

# Typecheck and lint
npm run typecheck --workspace=@modelscript/exchange
npm run lint --workspace=@modelscript/exchange
```
