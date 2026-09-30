# Finite Element Analysis (FEA) Support

ModelScript supports Finite Element Analysis configurations, structural mesh metadata, and load case specifications under `languages/fea/`.

---

## Core Capabilities

- **Material Property Definitions**: Ingests isotropic, orthotropic, and anisotropic material tensors (Young's modulus $E$, Poisson's ratio $\nu$, yield strength $\sigma_y$).
- **Boundary & Load Conditions**: Parses structural fixtures (fixed, pinned, roller) and applied force/moment distributions.
- **Stress & Deflection Fields**: Extracts nodal von Mises stress contours, principal stresses, and displacement vectors.
- **Thermal-Structural Coupling**: Translates temperature distributions computed by Modelica thermal circuits into thermal strain load cases for FEA solvers.
