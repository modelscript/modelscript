<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/tough`

Lawrence Berkeley National Laboratory (LBNL) TOUGH2/TOUGH3 non-isothermal multiphase flow, deep geothermal reservoir, steam-water flashing, and hydrothermal energy simulation package for ModelScript.

## Features

- **TOUGH Deck Parsing:** Parses standardized blocks (`ROCKS`, `PARAM`, `ELEME`, `CONNE`, `GENER`, `INCON`) from `.dat`, `.inp`, and `.tough` input decks.
- **Geothermal Well & Flashing Solver:** Solves mass and thermal energy production rates, steam fraction (quality $x$), and wellhead thermal output ($MW_{\text{th}}$ / $MW_{\text{e}}$).
- **Direct DAE Lowering:** Lowers multiphase Darcy continuity equations, rock-fluid thermal equilibria, and inter-element transmissibility fluxes directly into `@modelscript/runtime`'s `DAEBuilder` linear arena.
- **Power Generation Coupling:** Integrates with `@modelscript/modelica` and `@modelscript/aspen` for geothermal flash-cycle steam turbine power generation.
- **Pre-flight Linting:** Validates rock matrix properties, positive element volumes, connection geometric consistency, and thermodynamic temperature ranges.

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.tough` | TOUGH2 / TOUGH3 Master Input Deck | Grid blocks, rock physics & production wells |
| `.dat` | Traditional TOUGH Deck Data File | Standard LBNL simulation deck |
| `.incon` | TOUGH Initial Conditions File | Primary thermodynamic state variables ($P, T, S$) |

## Quick Example

```tough
ROCKS
GRAV1    2600.0      0.15 1.0E-13 1.0E-13 1.0E-13       2.5    1000.0
ELEME
A1  1GRAV1 1.0E+05
A1  2GRAV1 1.0E+05
CONNE
A1  1A1  2 50.0 50.0 1.0E+03       0.0
GENER
A1  1WELL1MASS      -15.0    1.2E+06
INCON
A1  1        1.0E+07       240.0
A1  2        1.0E+07       240.0
ENDCY
```
