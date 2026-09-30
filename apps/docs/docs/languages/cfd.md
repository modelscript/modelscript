# Computational Fluid Dynamics (CFD) Support

ModelScript supports Computational Fluid Dynamics boundary conditions, mesh specifications, and configuration dialects under `languages/cfd/`.

---

## Dialects Supported

- **SU2**: Configuration files (`.cfg`) for aeronautical shape optimization and compressible/incompressible flow analysis.
- **OpenFOAM**: Dictionary files (`fvSchemes`, `fvSolution`, boundary condition files).

---

## Capabilities in the Digital Thread

1. **Boundary Condition Ingestion**: Parses velocity inlets, pressure outlets, wall boundary roughness, and turbulence models ($k\text{-}\epsilon$, SST $k\text{-}\omega$).
2. **Coupled Co-Simulation (1D/3D)**: Couples 1D Modelica hydraulic/pneumatic piping systems with 3D continuum CFD flow domains via co-simulation interfaces.
3. **Aerodynamic Coefficient Extraction**: Extracts lift ($C_L$), drag ($C_D$), and pitching moment ($C_M$) polar surfaces to generate reduced-order aerodynamic tables for fast flight simulation.
