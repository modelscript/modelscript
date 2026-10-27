# GT-SUITE / GT-POWER Modeling (`.gtm`, `.gtd`, `.gtx`, `.gt`)

The `@modelscript/gtsuite` package (`languages/gtsuite`) provides native compilation, simulation, analysis, and multi-domain projections for **Gamma Technologies GT-SUITE and GT-POWER** 1D engine, powertrain, turbocharging, and thermo-fluid dynamic simulation models.

---

## Supported File Specifications

| Extension           | Format                 | Key Structural Features                                                                            |
| :------------------ | :--------------------- | :------------------------------------------------------------------------------------------------- |
| **`.gtm` / `.gtd`** | GT-SUITE Model Deck    | ASCII and XML representations of cylinders, plenums, runners, valves, injectors, and turbochargers |
| **`.dat` / `.map`** | Tabular Component Maps | Compressor and turbine pressure ratio vs. corrected mass flow and efficiency performance maps      |
| **`.gdx` / `.csv`** | Trajectory Results     | Crank-resolved in-cylinder pressure, temperature, burn rate, and emissions time series             |

---

## Architecture & Compilation Pipeline

```mermaid
flowchart TD
    SRC["GT-SUITE Model (.gtm, .gtd, .dat)"]

    subgraph FrontEnd["Parser & Static Analysis"]
        PARSER["GT Model & Map Parsers (parseGtmModel, parseGtTableMap)"]
        INDEX["GtWorkspaceIndex (IWorkspaceIndex)"]
        LINT["Pre-Flight Engine Linter (M9001–M9015)"]
    end

    subgraph Core["Analytical & Numerical Solvers"]
        THERMO["Combustion & Heat Transfer (Wiebe, Woschni, Zeldovich NOx)"]
        DAE["Mean-Value Engine Model DAE Lowering (IDaeBuilder)"]
        SOLVER["In-WASM Fast Engine Simulator (simulateGtSuiteTransient)"]
        GATES["Formal Verification Engine Gates (verifyEngineGates)"]
    end

    subgraph Projections["Multi-Domain Projections"]
        SYSML["SysML v2 Powertrain Architecture (gtsuiteToSysml2)"]
        MO["Modelica 3.x Fluid/Thermal Model (gtsuiteToModelica)"]
        SSP["FMI Co-Simulation SystemStructure.ssd (gtsuiteToSsp)"]
    end

    subgraph Presentation["User Experience & Toolchain"]
        SVG["Vector Schematic Diagram (renderGtSuiteSchematicSvg)"]
        CLI["CLI Toolchain (msx gtsuite lint | simulate | verify | diagram)"]
        LSP["Language Server Protocol Services"]
    end

    SRC --> PARSER
    PARSER --> INDEX --> LINT
    PARSER --> THERMO --> DAE --> SOLVER
    SOLVER --> GATES --> CLI
    DAE --> MO
    DAE --> SSP
    DAE --> SYSML
    PARSER --> SVG
    LINT --> LSP
```

---

## Pre-Flight Powertrain Linter Rules

<LintRules lang="gtsuite" />

---

## Headless CLI Operations (`msx gtsuite`)

```bash
# Print model summary
msx gtsuite summary cases/Turbo4Cyl.gtm

# Run pre-flight static analysis
msx gtsuite lint cases/Turbo4Cyl.gtm

# Run in-WASM transient thermodynamic simulation
msx gtsuite simulate cases/Turbo4Cyl.gtm --duration=0.5 --out=trajectories.csv

# Evaluate formal verification gates (BSFC, boost, emissions, knock)
msx gtsuite verify cases/Turbo4Cyl.gtm --max-bsfc=240.0 --max-boost=2.8 --max-nox=60.0

# Export vector schematic SVG diagram
msx gtsuite diagram cases/Turbo4Cyl.gtm --view=schematic --out=engine_schematic.svg

# Project to Modelica and SysML v2
msx gtsuite to-modelica cases/Turbo4Cyl.gtm --out=Engine.mo
msx gtsuite to-sysml2 cases/Turbo4Cyl.gtm --out=Engine.sysml
```
