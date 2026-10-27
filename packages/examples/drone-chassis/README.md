<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# Drone Chassis Multi-Disciplinary CAD/FEA/CFD & Manufacturing Workspace

A reference multi-disciplinary design optimization (MDO) workspace demonstrating how ModelScript couples **ISO 10303-21 STEP B-Rep geometry**, programmatic **`@modelscript/cad` CSG**, **SysML v2** system requirements, **1D Modelica** structural & manufacturing process models, and **3D VTK Unstructured Grid (`.vtu`)** FEA/CFD continuum field snapshots.

---

## Linked Domain Artifacts

| File Path                                                  | Domain / Format                | Engineering Role in the Digital Thread                                                                                         |
| :--------------------------------------------------------- | :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| [`sysml/chassis.sysml`](./sysml/chassis.sysml)             | SysML v2 (`.sysml`)            | System architecture and mass/stiffness requirement definitions importing the 3D STEP chassis assembly.                         |
| [`Chassis.mo`](./Chassis.mo)                               | Modelica (`.mo`)               | 1D mechanical lumped-parameter structural dynamics model of the quadcopter chassis.                                            |
| [`Manufacturing.mo`](./Manufacturing.mo)                   | Modelica (`.mo`)               | Process cost, CNC machining cycle time, embodied carbon, and yield model for candidate alloys and carbon-fiber composites.     |
| [`TradeStudy.mo`](./TradeStudy.mo)                         | Modelica (`.mo`)               | Multi-disciplinary design optimization (MDO) trade study coupling structural mass, safety factor, and unit manufacturing cost. |
| [`cad/drone.step`](./cad/drone.step)                       | ISO 10303-21 STEP (`.step`)    | Exact B-Rep solid assembly of the quadcopter frame, arms, and motor mounts.                                                    |
| [`cad/drone.mcad.ts`](./cad/drone.mcad.ts)                 | `@modelscript/cad` CSG         | Programmatic parametric CSG definition of the chassis with tagged FEA load/support patches.                                    |
| [`cad/DroneCAD.mo`](./cad/DroneCAD.mo)                     | Modelica (`.mo`)               | Multibody 6-DOF dynamic model bound to 3D CAD visualizer annotations.                                                          |
| [`cad/DroneSimulation.mo`](./cad/DroneSimulation.mo)       | Modelica (`.mo`)               | Coupled flight and structural deflection simulation model.                                                                     |
| [`drone_fea.vtu`](./drone_fea.vtu)                         | VTK Unstructured Grid (`.vtu`) | 3D continuum FEA von Mises stress and displacement field snapshot.                                                             |
| [`drone_cfd.vtu`](./drone_cfd.vtu)                         | VTK Unstructured Grid (`.vtu`) | 3D continuum CFD aerodynamic velocity and pressure field snapshot.                                                             |
| [`evaluate-manufacturing.ts`](./evaluate-manufacturing.ts) | TypeScript Script              | Automated trade-study runner evaluating Pareto fronts across material, wall thickness, and unit cost.                          |

---

## Running with `msx`

From the repository root:

```bash
# 1. Flatten and simulate the multi-disciplinary TradeStudy model
npx msx compile TradeStudy packages/examples/drone-chassis/TradeStudy.mo
npx msx simulate TradeStudy packages/examples/drone-chassis/TradeStudy.mo --stop-time 5.0

# 2. Simulate the manufacturing cost and cycle-time model
npx msx simulate Manufacturing packages/examples/drone-chassis/Manufacturing.mo --stop-time 5.0

# 3. Run the automated Pareto trade-study evaluation script
npx tsx packages/examples/drone-chassis/evaluate-manufacturing.ts
```
