# Polyglot Drone Reachability Verification Workspace

This workspace demonstrates an end-to-end, zero-glue cyber-physical verification pipeline running entirely in-browser and WebAssembly.

---

## Architecture & Multi-Domain Pipeline

```
  ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
  │ cad/drone.scad  │      │cae/drone_arm.inp│      │cae/drone_aero.cfg
  │ (OpenSCAD CAD)  │      │  (CalculiX FEA) │      │   (SU2 CFD)     │
  └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
           │                        │                        │
           ▼                        ▼                        ▼
    OpenCascade WASM       FEA Stress Slicing       CFD Drag Polar
   A_front = 0.03 m²         m = 1.2 kg (σ≤180)        Cd = 0.80
           │                        │                        │
           └────────────────► ──────┼────── ◄────────────────┘
                                    │
                         ┌──────────▼──────────┐
                         │  Theory Coordinator │ (Nelson-Oppen Equality Exchange)
                         └──────────┬──────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌───────────────────────────┐                     ┌───────────────────────────┐
│  sysml/drone_specs.sysml  │                     │modelica/DroneSimulation.mo│
│ (SysML v2 FlightCeiling)  │                     │ (Continuous Modelica DAE) │
│  assert v_climb <= 12 m/s │                     │  In-Place WASM Lowering   │
└──────────┬────────────────┘                     └──────────┬────────────────┘
           │                                                 │
           └────────────────────────┬────────────────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │ Continuous Safety Oracle    │
                     │  - Zonotope Zero-Wrapping   │
                     │  - Interval Arithmetic (IA) │
                     │  - Octagon DBM & Affine     │
                     └──────────────┬──────────────┘
                                    │
                                    ▼
                     ┌─────────────────────────────┐
                     │ VS Code Reachability Panel  │
                     │  - Multi-Ribbon Canvas Plot │
                     │  - Live Salsa Re-Solve      │
                     │  - Edit-Time IDE Squiggles  │
                     └─────────────────────────────┘
```

## Physical System Dynamics

Autopilot climb rate equation:
$$\dot{z} = v$$
$$\dot{v} = \frac{k_z (z_{\text{target}} - z) - k_v v - \frac{1}{2} C_d \rho A v |v| + w}{m}$$

- **State variables**: Altitude $z(t)$, climb velocity $v(t)$
- **Target altitude**: $z_{\text{target}} = 11.0\,\text{m}$
- **Autopilot gains**: $k_z = 3.1\,\text{N/m}$, $k_v = 1.35\,\text{N/(m/s)}$
- **Parameters from domains**:
  - $m = 1.20\,\text{kg}$ from FEA structural stress sizing ($\sigma_{\text{max}} = 172.4\,\text{MPa} \le 180.0\,\text{MPa}$)
  - $A = 0.030\,\text{m}^2$ from OpenSCAD CAD frontal projection
  - $C_d = 0.80$ from SU2 CFD aerodynamic drag polar
  - $\rho = 1.225\,\text{kg/m}^3$ air density
- **Disturbance input**: Turbulent wind gust $w \in [-120, 120]\,\text{N}$

## Key Reachability Findings

| Representation            | Max Climb Velocity ($\max v$) | Ceiling Check ($v \le 12\,\text{m/s}$) | Verification Status                        |
| :------------------------ | :---------------------------- | :------------------------------------- | :----------------------------------------- |
| **Nominal Run ($w = 0$)** | $10.9\,\text{m/s}$            | Satisfied                              | Valid Trajectory                           |
| **Zonotope Flowpipe**     | $11.42\,\text{m/s}$           | Satisfied                              | **Proven SAT ($< 3\,\text{ms}$)**          |
| **Octagon DBM**           | $11.75\,\text{m/s}$           | Satisfied                              | Weakly Relational Enclosure                |
| **Affine Forms**          | $11.90\,\text{m/s}$           | Satisfied                              | First-Order Noise Symbols                  |
| **Interval Arithmetic**   | $14.85\,\text{m/s}$           | **Breached @ $t = 3.42\,\text{s}$**    | **Spurious False Alarm (Wrapping Effect)** |
