<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/examples

End-to-end polyglot Digital Thread reference workspaces demonstrating how ModelScript unifies systems architecture (**SysML v2**), continuous-time dynamics (**Modelica**), 3D parametric & B-Rep geometry (**OpenSCAD**, **STEP**), continuum finite-element & fluid analysis (**CalculiX FEA**, **SU2 CFD**), electromagnetic transients (**PSCAD EMT**), formal reachability verification, and manufacturing trade studies in a single zero-glue compilation pipeline.

---

## Reference Workspaces

### 1. `drone-reachability/` — Polyglot Cyber-Physical Reachability & Safety Certification

Located at [`packages/examples/drone-reachability/`](./drone-reachability/), this workspace demonstrates an end-to-end cross-domain verification pipeline where geometric, structural, and aerodynamic parameters flow automatically through the **Nelson-Oppen Theory Coordinator** into a continuous-time safety oracle.

#### Linked Domain Artifacts

| File Path                                                                         | Domain / Format                | Role in the Digital Thread                                                                                                                                                                                                             |
| :-------------------------------------------------------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`modelscript.json`](./drone-reachability/modelscript.json)                       | Workspace Manifest             | Declares cross-domain parameter bindings and verification targets across CAD, FEA, CFD, SysML v2, and Modelica.                                                                                                                        |
| [`sysml/drone_specs.sysml`](./drone-reachability/sysml/drone_specs.sysml)         | SysML v2 (`.sysml`)            | Defines system architecture (`DroneSystem`), requirement constraints (`FlightCeiling`: $v_{\text{climb}} \le 12\,\text{m/s}$, structural stress ceiling $\sigma_{\text{max}} \le 180\,\text{MPa}$), and requirement allocation links.  |
| [`modelica/DroneSimulation.mo`](./drone-reachability/modelica/DroneSimulation.mo) | Modelica (`.mo`)               | Nonlinear vertical flight dynamics and PD autopilot DAE ($\dot{z} = v$, $m\dot{v} = k_z(z_{\text{target}} - z) - k_v v - \frac{1}{2} C_d \rho A v \lvert v \rvert + w$) subject to turbulent wind gusts $w \in [-120, 120]\,\text{N}$. |
| [`cad/drone.scad`](./drone-reachability/cad/drone.scad)                           | OpenSCAD (`.scad`)             | Parametric 3D quadcopter frame geometry evaluated by `@modelscript/cad` to extract exact projected frontal area ($A_{\text{front}} = 0.030\,\text{m}^2$).                                                                              |
| [`cae/drone_chassis.inp`](./drone-reachability/cae/drone_chassis.inp)             | CalculiX / Abaqus FEA (`.inp`) | Tetrahedral structural mesh and boundary conditions verifying chassis mass ($m = 1.20\,\text{kg}$) and peak von Mises stress ($\sigma_{\text{max}} = 172.4\,\text{MPa} \le 180\,\text{MPa}$).                                          |
| [`cae/drone_aero.cfg`](./drone-reachability/cae/drone_aero.cfg)                   | SU2 CFD (`.cfg`)               | Aerodynamic solver configuration establishing the drag polar coefficient ($C_d = 0.80$).                                                                                                                                               |

#### Key Verification Result

Using Taylor-model **Zonotope Flowpipes** (`@modelscript/runtime`), ModelScript proves in $< 3\,\text{ms}$ that peak climb velocity under worst-case wind gusts reaches $\max v = 11.42\,\text{m/s} \le 12.0\,\text{m/s}$ (**UNSAT / SAFE**), whereas naive Interval Arithmetic suffers from the wrapping effect and reports a spurious breach ($14.85\,\text{m/s}$ at $t = 3.42\,\text{s}$).

---

### 2. `drone-chassis/` — Multi-Disciplinary CAD/FEA/CFD & Manufacturing Trade Study

Located at [`packages/examples/drone-chassis/`](./drone-chassis/), this workspace couples ISO 10303-21 STEP B-Rep geometry, thermo-mechanical Modelica manufacturing models, and multi-objective trade studies.

#### Linked Domain Artifacts

| File Path                                                                                                                 | Domain / Format                | Role in the Digital Thread                                                                                                     |
| :------------------------------------------------------------------------------------------------------------------------ | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| [`sysml/chassis.sysml`](./drone-chassis/sysml/chassis.sysml)                                                              | SysML v2 (`.sysml`)            | System architecture and mass/stiffness requirement definitions importing the 3D STEP chassis assembly.                         |
| [`Chassis.mo`](./drone-chassis/Chassis.mo)                                                                                | Modelica (`.mo`)               | 1D mechanical lumped-parameter structural dynamics model of the drone chassis.                                                 |
| [`Manufacturing.mo`](./drone-chassis/Manufacturing.mo)                                                                    | Modelica (`.mo`)               | Process cost, CNC machining cycle time, embodied carbon, and yield model for candidate alloys and carbon-fiber composites.     |
| [`TradeStudy.mo`](./drone-chassis/TradeStudy.mo)                                                                          | Modelica (`.mo`)               | Multi-disciplinary design optimization (MDO) trade study coupling structural mass, safety factor, and unit manufacturing cost. |
| [`cad/drone.step`](./drone-chassis/cad/drone.step)                                                                        | ISO 10303-21 STEP (`.step`)    | Exact B-Rep solid assembly of the quadcopter frame, arms, and motor mounts.                                                    |
| [`cad/drone.mcad.ts`](./drone-chassis/cad/drone.mcad.ts)                                                                  | `@modelscript/cad` CSG         | Programmatic parametric CSG definition of the chassis with tagged FEA load/support patches.                                    |
| [`cad/DroneCAD.mo`](./drone-chassis/cad/DroneCAD.mo) & [`cad/DroneSimulation.mo`](./drone-chassis/cad/DroneSimulation.mo) | Modelica (`.mo`)               | Multibody 6-DOF dynamic model bound to 3D CAD visualizer annotations.                                                          |
| [`drone_fea.vtu`](./drone-chassis/drone_fea.vtu) & [`drone_cfd.vtu`](./drone-chassis/drone_cfd.vtu)                       | VTK Unstructured Grid (`.vtu`) | 3D continuum FEA von Mises stress fields and CFD velocity/pressure field snapshots.                                            |
| [`evaluate-manufacturing.ts`](./drone-chassis/evaluate-manufacturing.ts)                                                  | TypeScript Script              | Automated trade-study runner evaluating Pareto fronts across material, wall thickness, and unit cost.                          |

---

### 3. `pscad-microgrid/` — Electromagnetic Transients (EMT), IEEE 2800 Verification & Polyglot Co-Simulation

Located at [`packages/examples/pscad-microgrid/`](./pscad-microgrid/), this workspace demonstrates a 230 kV power transmission microgrid with Inverter-Based Resource (IBR) solar interconnection, Dommel companion-circuit EMT simulation, automated IEEE 2800-2022 / NERC PRC-029-1 grid-code auditing, IEEE C37.111 COMTRADE waveform recording, and polyglot projections to Modelica and SSP SystemStructure.

#### Linked Domain Artifacts

| File Path                                                                                                               | Domain / Format            | Role in the Digital Thread                                                                                                                    |
| :---------------------------------------------------------------------------------------------------------------------- | :------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| [`modelscript.json`](./pscad-microgrid/modelscript.json)                                                                | Workspace Manifest         | Declares nominal grid parameters (230 kV, 60 Hz) and evaluated IEEE 2800-2022 ride-through clauses.                                           |
| [`Microgrid_IBR.pscx`](./pscad-microgrid/Microgrid_IBR.pscx)                                                            | PSCAD Case Study (`.pscx`) | 3-phase grid network with 250 MVA utility source, 16.5/230 kV transformer, 50 km Bergeron line, 100 MVA IBR inverter, and CSMF droop control. |
| [`Microgrid_Lib.pslx`](./pscad-microgrid/Microgrid_Lib.pslx)                                                            | PSCAD Library (`.pslx`)    | Custom component library defining reusable `IBR_Inverter_Defn`, `MOV_Arrester_Defn`, and `CSMF_Droop_Defn` catalog components.                |
| [`Microgrid.pswx`](./pscad-microgrid/Microgrid.pswx)                                                                    | PSCAD Workspace (`.pswx`)  | Master workspace container indexing the case study and library.                                                                               |
| [`Microgrid_IBR.svg`](./pscad-microgrid/Microgrid_IBR.svg)                                                              | Single-Line Diagram (SLD)  | Headless vector schematic visualization generated via `@modelscript/diagram`.                                                                 |
| [`Microgrid_IBR.cfg`](./pscad-microgrid/Microgrid_IBR.cfg) & [`Microgrid_IBR.dat`](./pscad-microgrid/Microgrid_IBR.dat) | IEEE C37.111 COMTRADE      | High-frequency (50 kHz) transient fault recording with 21 analog channels.                                                                    |
| [`Microgrid_IBR.mo`](./pscad-microgrid/Microgrid_IBR.mo)                                                                | Modelica (`.mo`)           | Polyglot projection to standard `Modelica.Electrical.Analog` DAE.                                                                             |
| [`SystemStructure.ssd`](./pscad-microgrid/SystemStructure.ssd)                                                          | SSP 1.0 SystemStructure    | FMI/SSP multi-FMU co-simulation architecture.                                                                                                 |
| [`ieee2800_report.md`](./pscad-microgrid/ieee2800_report.md)                                                            | Verification Audit Dossier | Full 7-clause IEEE 2800-2022 / NERC PRC-029-1 compliance report.                                                                              |

---

### 4. `alm-gitops/` — ALM GitOps Requirements Synchronization

Located at [`packages/examples/alm-gitops/`](./alm-gitops/), this workspace demonstrates declarative GitOps synchronization between external Application Lifecycle Management (ALM) tools (DOORS Next, Jama, Codebeamer, Polarion, Jira) and a ModelScript workspace.

- [`modelscript.yaml`](./alm-gitops/modelscript.yaml): Declares remote ALM endpoints, requirement bindings, and traceability policies (`ALM001`–`ALM004`).
- [`alm-sync-pr.yml`](./alm-gitops/alm-sync-pr.yml): GitHub Actions workflow automating `msx pull`, requirement drift linting, and pull-request traceability checks.

---

### 5. `asme-bpvc-viii-1/` — ASME BPVC Section VIII Division 1 Pressure Vessel Compliance

Located at [`packages/examples/asme-bpvc-viii-1/`](./asme-bpvc-viii-1/), this workspace pairs a Modelica separator vessel model with an ASME BPVC Section VIII Div. 1 SysML v2 verification pack and allowable-stress material tables.

- [`src/VesselSeparator.mo`](./asme-bpvc-viii-1/src/VesselSeparator.mo): Modelica pressure vessel separator model with shell/head wall thickness and MAWP equations.
- [`pack/src/asme_viii_1.sysml`](./asme-bpvc-viii-1/pack/src/asme_viii_1.sysml) & [`pack/tables/sa516-gr70-allowable-stress.json`](./asme-bpvc-viii-1/pack/tables/sa516-gr70-allowable-stress.json): SysML v2 compliance requirements and SA-516 Gr. 70 temperature-dependent allowable stress table verified by `PressureVesselOracle`.

---

### 6. `emt-screening-pack/` — Automated ISO Interconnection & EMT Screening Pack

Located at [`packages/examples/emt-screening-pack/`](./emt-screening-pack/), this workspace combines PSS/E steady-state/dynamic cases, PSCAD EMT models, SFRA curves, and SysML v2 interconnection requirements for multi-stage ISO grid-code screening.

- [`data/poi_case.raw`](./emt-screening-pack/data/poi_case.raw), [`data/poi_case.dyr`](./emt-screening-pack/data/poi_case.dyr), & [`data/ibr_interconnection.pscx`](./emt-screening-pack/data/ibr_interconnection.pscx): Point-of-interconnection power flow, dynamic deck, and PSCAD EMT plant model.
- [`src/system.sysml`](./emt-screening-pack/src/system.sysml), [`src/emt-checks.ts`](./emt-screening-pack/src/emt-checks.ts), & [`src/pipeline-stages.ts`](./emt-screening-pack/src/pipeline-stages.ts): SysML v2 screening criteria and automated TypeScript verification pipeline stages.

---

### 7. `sysml-wasm-pack/` — User-Defined AssemblyScript & TypeScript Verification Kernels

Located at [`packages/examples/sysml-wasm-pack/`](./sysml-wasm-pack/), this workspace demonstrates authoring custom `@modelscript/sdk` capability kernels in AssemblyScript (compiled to WebAssembly) and TypeScript, bound to SysML v2 definitions and a Modelica plant.

- [`src/system.sysml`](./sysml-wasm-pack/src/system.sysml) & [`src/plant.mo`](./sysml-wasm-pack/src/plant.mo): SysML v2 capability bindings and Modelica plant model.
- [`assembly/analyzer.ts`](./sysml-wasm-pack/assembly/analyzer.ts) & [`src/ts-analyzer.ts`](./sysml-wasm-pack/src/ts-analyzer.ts): Portable AssemblyScript WASM and TypeScript verification kernels executed via `msx sysml-run`.

---

### 8. `telecom-co-microgrid/` — Telecom Central Office Microgrid & CTRF Verification

Located at [`packages/examples/telecom-co-microgrid/`](./telecom-co-microgrid/), this workspace models a resilient Telecom Central Office DC/AC backup microgrid with automated unit verification and Common Test Report Format (CTRF) reporting.

- [`Telecom_Microgrid.mo`](./telecom-co-microgrid/Telecom_Microgrid.mo): Modelica electrical & battery backup dynamics for a telecom central office.
- [`simulate_microgrid.ts`](./telecom-co-microgrid/simulate_microgrid.ts), [`tests/microgrid.test.ts`](./telecom-co-microgrid/tests/microgrid.test.ts), & [`ctrf/ctrf-report.json`](./telecom-co-microgrid/ctrf/ctrf-report.json): Automated simulation harness, verification test suite, and CTRF audit output.

---

## Running the Examples with `msx`

From the repository root, use the `msx` (`@modelscript/cli`) binary to verify, simulate, and inspect the polyglot digital thread:

```bash
# 1. Run formal reachability & cross-domain contract verification on drone-reachability
npx msx verify packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --sysml packages/examples/drone-reachability/sysml/drone_specs.sysml

# 2. Simulate the Modelica flight dynamics and export a CSV trajectory
npx msx simulate DroneSimulation \
  packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --stop-time 10.0 \
  --solver dopri5 \
  --format csv > drone_trajectory.csv

# 3. Inspect the end-to-end polyglot Digital Thread & Requirements Traceability Matrix (RTM)
npx msx polyglot thread packages/examples/drone-reachability

# 4. Simulate the drone-chassis trade study and manufacturing model
npx msx simulate TradeStudy packages/examples/drone-chassis/TradeStudy.mo --stop-time 5.0

# 5. Export an FDA / ISO-compliant Design History File (DHF) verification dossier
npx msx dhf export packages/examples/drone-reachability --format markdown -o Drone_DHF.md

# 6. Lint, simulate, verify, and diagram the PSCAD microgrid workspace
npx msx pscad lint packages/examples/pscad-microgrid/Microgrid_IBR.pscx
npx msx pscad sim packages/examples/pscad-microgrid/Microgrid_IBR.pscx --step=20us --tstop=0.25
npx msx pscad verify-ieee2800 packages/examples/pscad-microgrid/Microgrid_IBR.pscx
npx msx pscad diagram packages/examples/pscad-microgrid/Microgrid_IBR.pscx --out=Microgrid_IBR.svg
npx msx pscad export-modelica packages/examples/pscad-microgrid/Microgrid_IBR.pscx --out=Microgrid_IBR.mo
npx msx pscad export-ssp packages/examples/pscad-microgrid/Microgrid_IBR.pscx --out=SystemStructure.ssd

# 7. Run SysML v2 + WASM capability verification on sysml-wasm-pack
npx msx sysml-run packages/examples/sysml-wasm-pack/src/system.sysml
```
