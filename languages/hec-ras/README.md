<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/hec-ras`

US Army Corps of Engineers (USACE) HEC-RAS 1D/2D river hydraulics, open-channel conveyance, dam breach, and flood routing language package for ModelScript.

## Features

- **Geometry Deck Parsing:** Parses river reaches, cross-sections (`Station Elevation Data`), bank stations, reach lengths, Manning's roughness distributions, and inline structures from `.g01`–`.g99` and `.rasgeo` files.
- **Unsteady & Steady Flow Decks:** Parses boundary conditions, stage hydrographs, flow hydrographs, and normal depth friction slopes from `.u01` and `.f01` files.
- **Direct Linear DAE Lowering:** Lowers 1D Saint-Venant continuity and momentum equations, energy conservation, and Manning friction slopes directly into `@modelscript/runtime`'s zero-overhead `DAEBuilder` arena.
- **Water Surface Profile (WSP) Solver:** Computes standard-step backwater curves (M1/M2/S1/S2), energy grade line (EGL), flow velocities, and Froude numbers.
- **Pre-flight Linting:** Detects inverted station offsets, roughness bounds violations, adverse bed slopes, and disconnected reaches.

## File Support

| Extension | Description | Role |
| :--- | :--- | :--- |
| `.g01` | HEC-RAS River Geometry File | Cross sections, river reaches, bridges & weirs |
| `.u01` | HEC-RAS Unsteady Flow File | Boundary hydrographs & lateral inflows |
| `.f01` | HEC-RAS Steady Flow File | Peak profile discharge boundary conditions |
| `.prj` | HEC-RAS Project File | Master plan and file association manifest |

## Quick Example

```rasgeo
Geom Title=Sample Reach
Program Version=6.3.1
River Reach=River1,Reach1
Reach XY=2
0, 5000
1000, 5000

Type RM CEM CS= 1 ,1000    ,        ,
Station Elevation Data= 5
0, 105  20, 95  50, 90  80, 95  100, 105
Cross Section Reach Lengths and Manning Values=
200, 200, 200, 3, 0.04, 0.03, 0.04, 0, 0
Bank Sta=20,80
```
