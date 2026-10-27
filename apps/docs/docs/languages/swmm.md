# EPA SWMM Stormwater & Urban Hydrology (`.inp`)

`@modelscript/swmm` (`languages/swmm`) provides zero-regex parsing, 1D Saint-Venant dynamic wave hydraulic routing, DAE lowering, and Modelica 3.x projection for **US EPA Stormwater Management Model (SWMM 5.x)** urban drainage, sewer collection, and flood mitigation networks.

---

## Supported Extensions & Standards

| Extension | Format              | Description                                                                                                      |
| :-------- | :------------------ | :--------------------------------------------------------------------------------------------------------------- |
| `.inp`    | EPA SWMM Input File | Industry-standard stormwater network deck (junctions, conduits, outfalls, subcatchments, pumps, weirs, orifices) |

---

## Key Capabilities

### 1. 1D Saint-Venant Dynamic Wave Routing

- Models open-channel and pressurized sewer hydraulics via the one-dimensional **Saint-Venant equations of unsteady flow**:
  - **Conservation of Mass (Continuity)**:
    $$\frac{\partial A}{\partial t} + \frac{\partial Q}{\partial x} = q_{\text{lateral}}$$
  - **Conservation of Momentum**:
    $$\frac{\partial Q}{\partial t} + \frac{\partial}{\partial x} \left( \frac{Q^2}{A} \right) + g A \frac{\partial H}{\partial x} + g A S_f = 0$$
    where $H = z + d$ is hydraulic head, $S_f$ is friction slope, and $S_0$ is conduit bed slope.
- Uses **Manning's open-channel equation** for friction slope:
  $$Q = \frac{k_m}{n} A R_h^{2/3} S_f^{1/2} \quad \implies \quad S_f = \frac{n^2 Q |Q|}{k_m^2 A^2 R_h^{4/3}}$$
  where $n$ is Manning roughness, $A$ is flow cross-sectional area, and $R_h = A / P_{\text{wetted}}$ is hydraulic radius.

### 2. Node & Link Hydraulic Structures

- **Junctions & Storage Units**: Continuous water stage mass conservation:
  $$A_{\text{node}} \frac{dH_i}{dt} = \sum Q_{\text{in}} - \sum Q_{\text{out}} + Q_{\text{inflow}} - Q_{\text{flood}}$$
- **Conduits**: Circular, rectangular, trapezoidal, and irregular natural river cross-sections with entrance/exit minor head loss coefficients.
- **Outfalls**: Free, normal, tidal, and fixed water elevation boundary conditions.
- **Regulators**: Orifices, transverse/side-flow weirs, and variable-speed lift pumps.

### 3. Direct DAE Lowering

- Compiles the entire stormwater collection network into `@modelscript/runtime`'s `DAEBuilder` struct-of-arrays linear memory arena.
- Enables co-simulation of municipal drinking water networks ([`@modelscript/epanet`](./epanet.md)) and drainage networks within the same computational arena.

### 4. Bidirectional Modelica 3.x Projection

- Projects SWMM nodes and channels into `Modelica.Fluid` open-channel tanks, flow conduits, and boundary reservoirs.

---

## Pre-Flight Diagnostics

The SWMM linter verifies network graph integrity and hydraulic feasibility before simulation:

<LintRules lang="swmm" />

---

## CLI Usage

```bash
# Inspect junctions, conduits, outfalls, and subcatchments
msx swmm inspect UrbanDrainage.inp

# Run pre-flight semantic diagnostics
msx swmm lint UrbanDrainage.inp

# Route steady-state hydraulic flow using Manning formulation
msx swmm route-flow UrbanDrainage.inp

# Lower network topology into ModelScript linear DAE arena
msx swmm to-dae UrbanDrainage.inp

# Project into Modelica 3.x fluid network components
msx swmm to-modelica UrbanDrainage.inp -o StormwaterNetwork.mo
```
