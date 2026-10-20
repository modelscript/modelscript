# `@modelscript/examples`

End-to-end polyglot Digital Thread reference workspaces demonstrating how ModelScript unifies systems architecture (**SysML v2**), continuous-time dynamics (**Modelica**), 3D parametric & B-Rep geometry (**OpenSCAD**, **STEP**), continuum finite-element & fluid analysis (**CalculiX FEA**, **SU2 CFD**), formal reachability verification, and manufacturing trade studies in a single zero-glue compilation pipeline.

---

## Reference Workspaces

### 1. `drone-reachability/` — Polyglot Cyber-Physical Reachability & Safety Certification

Located at [`packages/examples/drone-reachability/`](./drone-reachability/), this workspace demonstrates an end-to-end cross-domain verification pipeline where geometric, structural, and aerodynamic parameters flow automatically through the **Nelson-Oppen Theory Coordinator** into a continuous-time safety oracle.

#### Linked Domain Artifacts

| File Path                                                                         | Domain / Format                | Role in the Digital Thread                                                                                                                                                                                                            |
| :-------------------------------------------------------------------------------- | :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | -------------------------------------------------------------------- |
| [`modelscript.json`](./drone-reachability/modelscript.json)                       | Workspace Manifest             | Declares cross-domain parameter bindings and verification targets across CAD, FEA, CFD, SysML v2, and Modelica.                                                                                                                       |
| [`sysml/drone_specs.sysml`](./drone-reachability/sysml/drone_specs.sysml)         | SysML v2 (`.sysml`)            | Defines system architecture (`DroneSystem`), requirement constraints (`FlightCeiling`: $v_{\text{climb}} \le 12\,\text{m/s}$, structural stress ceiling $\sigma_{\text{max}} \le 180\,\text{MPa}$), and requirement allocation links. |
| [`modelica/DroneSimulation.mo`](./drone-reachability/modelica/DroneSimulation.mo) | Modelica (`.mo`)               | Nonlinear vertical flight dynamics and PD autopilot DAE ($\dot{z} = v$, $m\dot{v} = k*z(z*{\text{target}} - z) - k_v v - \frac{1}{2} C_d \rho A v                                                                                     | v   | + w$) subject to turbulent wind gusts $w \in [-120, 120]\,\text{N}$. |
| [`cad/drone.scad`](./drone-reachability/cad/drone.scad)                           | OpenSCAD (`.scad`)             | Parametric 3D quadcopter frame geometry evaluated by `@modelscript/cad` to extract exact projected frontal area ($A_{\text{front}} = 0.030\,\text{m}^2$).                                                                             |
| [`cae/drone_chassis.inp`](./drone-reachability/cae/drone_chassis.inp)             | CalculiX / Abaqus FEA (`.inp`) | Tetrahedral structural mesh and boundary conditions verifying chassis mass ($m = 1.20\,\text{kg}$) and peak von Mises stress ($\sigma_{\text{max}} = 172.4\,\text{MPa} \le 180\,\text{MPa}$).                                         |
| [`cae/drone_aero.cfg`](./drone-reachability/cae/drone_aero.cfg)                   | SU2 CFD (`.cfg`)               | Aerodynamic solver configuration establishing the drag polar coefficient ($C_d = 0.80$).                                                                                                                                              |

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
```
