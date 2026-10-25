# @modelscript/gtsuite

Gamma Technologies GT-SUITE / GT-POWER 1D powertrain, internal combustion engine, turbocharging, and thermo-fluid dynamic simulation package (`.gtm`, `.gtd`, `.gtx`, `.gt`, `.dat`, `.gdx`) for ModelScript.

## Capabilities

- **GT-SUITE Model Parsing & AST (`parseGtmModel`, `parseGtTableMap`)**: Ingestion of both GT-SUITE XML project files and concise ASCII engine decks, extracting cylinders, valves, intake/exhaust runners, plenums, turbochargers, intercoolers, injectors, and boundary environments.
- **In-WASM 0D/1D Cylinder Thermodynamics & Combustion (`simulateGtSuiteTransient`)**: Zero-GC numerical execution in WebAssembly linear memory:
  - Crank-slider kinematic geometry ($V(\theta)$, $dV/d\theta$, piston speed)
  - Single & Double Wiebe heat release functions ($x_b(\theta)$) and imposed mass fraction burned (MFB) tables
  - Woschni and Annand in-cylinder convective wall heat transfer ($h_c$)
  - Real-gas variable specific heats ($\gamma(T)$, $c_p(T)$) across gasoline, diesel, methane, hydrogen, and ethanol
  - Extended Zeldovich thermal NOx rate kinetics and Livengood-Wu knock induction integral
- **Direct Continuous DAE Arena Lowering (`lowerGtSuiteToDae`)**: Lowers Mean-Value Engine Models (MVEM) directly into `@modelscript/runtime`'s `IDaeBuilder` for high-speed vehicle-level co-simulation (MiL/SiL/HiL).
- **Pre-Flight Static Linter (`lintGtModel`, `M9001`–`M9015`)**: Diagnostics for acoustic CFL stability limits on discretized runners, compressor surge and choke margins, valve lash clearances, compression ratio sanity, unconnected plenums, and non-physical discharge coefficients.
- **Polyglot Interoperability & Projections**:
  - `gtsuiteToSysml2`: Translates engine topologies into SysML v2 textual architecture (`part def EnginePowertrainSystem`, ports, and formal BSFC/boost/NOx requirements).
  - `gtsuiteToModelica`: Turnkey projection into standard Modelica 3.x continuous fluid/thermal models.
  - `gtsuiteToSsp`: FMI SystemStructure and Parameterization XML packaging (`SystemStructure.ssd`).
- **Engine Diagram Visualization (`renderGtSuiteSchematicSvg`, `buildGtSuiteDiagramData`)**: Headless vector SVG schematic generation and AntV X6 graph layout for airflow, intake plenum, cylinders, exhaust manifold, and turbocharger paths.
- **GT-POST Trajectory Reader & Verification Gates (`parseGdxTrajectory`, `verifyEngineGates`)**: Parses GT-POST `.gdx` SQLite/tabular trajectory outputs and evaluates formal pass/fail verification gates against fuel economy and emissions standards.
- **Native Tool Orchestration (`runGtSuiteSimulation`, `isGtSuiteEngineAvailable`)**: Headless batch execution (`gtise`) when GT-SUITE is locally installed, with seamless automatic fallback to ModelScript's in-WASM DAE simulator.
