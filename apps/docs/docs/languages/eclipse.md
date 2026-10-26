# Schlumberger ECLIPSE Reservoir Engineering (`.data`, `.dat`, `.inc`)

`@modelscript/eclipse` (`languages/eclipse`) provides zero-regex parsing, multiphase Darcy material balance solving, Peaceman well inflow modeling, linear DAE lowering, and Modelica 3.x projection for **Schlumberger ECLIPSE 100 (Black Oil) & 300 (Compositional)** reservoir simulation decks.

---

## Supported Extensions & Standards

| Extension       | Format               | Description                                                                                     |
| :-------------- | :------------------- | :---------------------------------------------------------------------------------------------- |
| `.data`         | ECLIPSE Master Deck  | Structured keyword deck defining grid geometry, rock/fluid properties, and well schedules       |
| `.dat` / `.inc` | ECLIPSE Include File | Modular sub-decks for PVT tables (`PROPS`), well completions (`SCHEDULE`), or permeability maps |

---

## Key Capabilities

### 1. Sectioned Deck Architecture & Table Records

- Parses all standard ECLIPSE keyword sections:
  - **`RUNSPEC`**: Phases (OIL, WATER, GAS, DISGAS), grid dimensions ($N_x \times N_y \times N_z$), unit systems (FIELD, METRIC, LAB).
  - **`GRID`**: Block dimensions (`DX`, `DY`, `DZ`), top depths (`TOPS`), porosity (`PORO`), and directional permeabilities (`PERMX`, `PERMY`, `PERMZ`).
  - **`PROPS`**: Multi-phase relative permeability curves (`SWOF`, `SGOF`) and PVT tables (`PVDO`, `PVTW`, `PVDG`).
  - **`REGIONS`**: Fluid and equilibrium region partitions.
  - **`SOLUTION`**: Initial equilibrium pressure and saturation distributions (`PRESSURE`, `SWAT`, `SOIL`).
  - **`SCHEDULE`**: Well specifications (`WELSPECS`), completion intervals (`COMPDAT`), production controls (`WCONPROD`), and water/gas injection controls (`WCONINJE`).

### 2. Multiphase Darcy Flow & Material Balance Solver

- Computes original hydrocarbons in place:
  - **Stock Tank Oil Initially In Place (STOIIP)**:
    $$\text{STOIIP} = \sum_{k} \frac{V_{b,k} \cdot \phi_k \cdot S_{o,k}}{B_{oi}}$$
  - **Gas Initially In Place (GIIP)**:
    $$\text{GIIP} = \sum_{k} \frac{V_{b,k} \cdot \phi_k \cdot (S_{g,k} + S_{o,k} R_{si})}{B_{gi}}$$
- Evaluates dynamic reservoir depletion using the generalized **Havlena-Odeh material balance equation**:
  $$N_p \left[ B_o + (R_p - R_s) B_g \right] + W_p B_w = N \left[ (B_o - B_{oi}) + (R_{si} - R_s) B_g \right] + m N B_{oi} \left( \frac{B_g}{B_{gi}} - 1 \right) + (1 + m) N B_{oi} \frac{c_w S_{wi} + c_f}{1 - S_{wi}} \Delta P + W_{\text{inj}} B_w$$
- Evaluates well deliverability via the **Peaceman well model**:
  $$q_p = PI \cdot (P_{\text{block}} - P_{\text{bh}}), \quad PI = \frac{2 \pi k h}{\mu B \left( \ln \frac{r_o}{r_w} + s \right)}$$
  where $r_o = 0.28 \frac{\sqrt{(k_y / k_x)^{1/2} \Delta x^2 + (k_x / k_y)^{1/2} \Delta y^2}}{(k_y / k_x)^{1/4} + (k_x / k_y)^{1/4}}$ is Peaceman's equivalent block radius.

### 3. Direct DAE Lowering

- Lowers reservoir grid pore volumes, multi-phase flow equations, and well drawdown constraints into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between subterranean porous media flow and surface transient multiphase gathering pipelines ([`@modelscript/olga`](file:///home/omar/git3/modelscript/languages/olga)) and process facilities ([`@modelscript/aspen`](file:///home/omar/git3/modelscript/languages/aspen)).

### 4. Bidirectional Modelica 3.x Projection

- Projects reservoir blocks and production wells into `Modelica.Fluid` porous media volumes and source boundaries.

---

## Pre-Flight Diagnostics (`M8701`–`M8710`)

The ECLIPSE validator inspects grid bounds, PVT table monotonicity, and well completions:

| Code    | Severity  | Rule Identifier                 | Condition Checked                                                               |
| :------ | :-------- | :------------------------------ | :------------------------------------------------------------------------------ |
| `M8701` | `error`   | `invalid-grid-dimensions`       | Grid cell count $N_x, N_y, N_z \le 0$.                                          |
| `M8702` | `error`   | `negative-porosity`             | Porosity outside physical bounds ($\phi < 0$ or $\phi > 1.0$).                  |
| `M8703` | `error`   | `negative-permeability`         | Absolute rock permeability $k \le 0\text{ mD}$.                                 |
| `M8704` | `error`   | `non-monotonic-pvt`             | Formation volume factor $B_o(P)$ or gas-oil ratio $R_s(P)$ non-monotonic.       |
| `M8705` | `error`   | `out-of-bounds-well-completion` | Well completion coordinate $(I, J, K)$ exceeds declared grid dimensions.        |
| `M8707` | `warning` | `voidage-replacement-deficit`   | Water injection volume is significantly less than reservoir production voidage. |

---

## CLI Usage

```bash
# Inspect grid dimensions, fluid phases, and well completions
msx eclipse inspect NorthSeaReservoir.data

# Run pre-flight linting and PVT table monotonicity checks
msx eclipse lint NorthSeaReservoir.data

# Solve reservoir depletion trajectory and compute STOIIP / GIIP
msx eclipse solve NorthSeaReservoir.data --duration=365.0

# Lower reservoir material balance to ModelScript linear DAE arena
msx eclipse to-dae NorthSeaReservoir.data

# Project into Modelica 3.x porous medium flow model
msx eclipse to-modelica NorthSeaReservoir.data -o ReservoirModel.mo
```
