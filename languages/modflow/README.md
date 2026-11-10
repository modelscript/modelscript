<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/modflow`

USGS MODFLOW 6 / 2005 groundwater flow, multi-layer aquifer, well abstraction, and surface-subsurface hydrologic interaction package for ModelScript.

## Features

- **MODFLOW 6 & Classic Parsing:** Parses structured grid discretization (`.dis`, `DIS6`), node property flow (`.npf`, `NPF6`), multi-well pumping (`.wel`, `WEL6`), river interaction (`.riv`, `RIV6`), constant head boundaries (`.chd`, `CHD6`), and simulation name files (`mfsim.nam`).
- **3D Groundwater Flow Solver:** Calculates inter-cell harmonic mean conductances, Darcy fluxes, hydraulic head distribution, and aquifer water balance residuals.
- **Direct DAE Lowering:** Compiles transient and steady-state groundwater flow continuity equations ($S_s \Delta V \frac{\partial h}{\partial t} = \sum Q$) directly into `@modelscript/runtime`'s linear memory `DAEBuilder` arena.
- **Surface-Water Coupling:** Integrates seamlessly with `@modelscript/hec-ras` and `@modelscript/swmm` for regional conjunctive water management and river-aquifer exchange.
- **Pre-flight Linting:** Detects out-of-bounds layer/row/column indexing, non-positive hydraulic conductivity, river stage below bed elevation, and unreferenced boundary conditions.

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.dis`, `.dis6` | Structured Grid Discretization | Spatial discretization ($N_{lay}, N_{row}, N_{col}, \Delta r, \Delta c$, top/botm) |
| `.npf`, `.npf6` | Node Property Flow | Hydraulic conductivity ($K_h, K_v$), specific storage ($S_s, S_y$) |
| `.wel`, `.wel6` | Well Pumping & Recharge Package | Pumping rates ($Q_w$) and extraction locations |
| `.riv`, `.riv6` | River Package | Stage elevation, bed conductance, and bottom elevation |
| `.chd`, `.chd6` | Constant Head Boundary Package | Fixed head boundary conditions |
| `.nam`, `mfsim.nam` | Simulation Name File | Package manifest and component registration |

## Quick Example

```modflow
BEGIN DIS6
  NLAY 2
  NROW 3
  NCOL 3
  DELR 100.0
  DELC 100.0
  TOP 50.0
  BOTM 20.0 0.0
END DIS6

BEGIN NPF6
  K 10.0
  K33 1.0
  SS 1.0e-4
  SY 0.15
END NPF6

BEGIN WEL6
  1 2 2 -500.0
END WEL6

BEGIN RIV6
  1 1 2 48.0 250.0 45.0
END RIV6
```
