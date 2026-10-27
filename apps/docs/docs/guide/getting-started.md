# Getting Started

This tutorial walks you through building a complete **computable digital thread** in ModelScript across five steps:

1. Authoring and linting a **Modelica** physical dynamics model (`BouncingBall.mo`)
2. Linking **SysML v2** safety requirements (`BouncingBallReq.sysml`) and running **formal verification** (`msx verify`)
3. Binding physical state trajectories to **3D CAD geometry** (`msx csg`)
4. Running **time-domain simulation**, rendering **SVG schematics**, and exporting an **FMI 3.0 Co-Simulation FMU** (`msx simulate`, `msx render`, `msx fmu`)
5. Closing the loop with an **AI Agent** via `@modelscript/mcp`

---

## Step 1: Create a Workspace & Physics Model

Create a new directory and initialize a `modelscript.json` workspace manifest:

```bash
mkdir bouncing-ball-thread && cd bouncing-ball-thread
msx init -y
```

Create `BouncingBall.mo` with a hybrid continuous-discrete impact model:

```modelica
model BouncingBall
  parameter Real e = 0.7 "Coefficient of restitution (0 < e < 1)";
  parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
  parameter Real radius = 0.05 "Ball radius [m]";
  Real h(start = 1.0, fixed = true) "Center height above ground [m]";
  Real v(start = 0.0, fixed = true) "Vertical velocity [m/s]";
equation
  der(h) = v;
  der(v) = -g;
  when h <= radius and v < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
```

Run the static analyzer to verify syntax, types, and equation balance (`2 variables, 2 equations`):

```bash
msx lint BouncingBall.mo
```

---

## Step 2: Add SysML v2 Requirements & Formal Verification

Now create `BouncingBallReq.sysml` next to `BouncingBall.mo` to capture architectural requirements and bind them to the physics model:

```sysml
package BouncingBallArchitecture {
  attribute def Meter;
  attribute def RestitutionCoeff;

  requirement def <'REQ-ENERGY-01'> PassiveReboundRequirement {
    doc /* The coefficient of restitution must remain strictly passive (0 < e <= 1)
         * so rebound height never exceeds initial drop height. */
    attribute e : RestitutionCoeff;
    require constraint { e > 0.0 and e <= 1.0 }
  }

  requirement def <'REQ-CLEARANCE-02'> PeakAltitudeBound {
    doc /* Peak rebound altitude after the first impact shall not exceed 0.60 m. */
    attribute hMax : Meter;
    require constraint { hMax <= 0.60 }
  }

  part def BouncingBallSystem {
    attribute e : RestitutionCoeff = 0.7;
    attribute hMax : Meter = 0.49;
    satisfy PassiveReboundRequirement by self;
    satisfy PeakAltitudeBound by self;
  }
}
```

Lint both files together and run the unified formal verifier to check all requirements and emit a **SARIF 2.1.0** report:

```bash
# Lint the polyglot workspace (Modelica + SysML v2)
msx lint BouncingBall.mo BouncingBallReq.sysml

# Formally verify requirements and contracts, emitting a SARIF proof report
msx verify BouncingBall BouncingBall.mo --format sarif --report results.sarif
```

---

## Step 3: Bind 3D CAD Geometry to Physical States

In ModelScript, physical states can directly drive 3D Constructive Solid Geometry (CSG) or external STEP/glTF assets. Add a `CAD` annotation to `h` in `BouncingBall.mo`:

```modelica
model BouncingBall
  parameter Real e = 0.7 "Coefficient of restitution (0 < e < 1)";
  parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
  parameter Real radius = 0.05 "Ball radius [m]";
  Real h(start = 1.0, fixed = true) "Center height above ground [m]" annotation(
    CAD(
      primitive = "sphere",
      radius = "radius",
      position = {0, 0, 0},
      dynamicPosition = "{0, h, 0}"
    )
  );
  Real v(start = 0.0, fixed = true) "Vertical velocity [m/s]";
equation
  der(h) = v;
  der(v) = -g;
  when h <= radius and v < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
```

Extract and compile the 3D CSG topology from the command line, or open **ModelScript: Open 3D CAD Viewer** (`Ctrl+Shift+P`) in VS Code to watch the sphere rebound in 3D:

```bash
msx csg BouncingBall BouncingBall.mo
```

---

## Step 4: Simulate, Render Schematics & Export an FMI 3.0 FMU

Simulate the hybrid DAE over $3.0\text{ s}$, render an SVG schematic diagram, and package the model into a standards-compliant **FMI 3.0 Co-Simulation FMU** with an embedded WebAssembly binary:

```bash
# Flatten to the linear-memory DAE arena and simulate for 3.0 s
msx simulate BouncingBall BouncingBall.mo --stop-time 3.0 --interval 0.005 --format csv > trajectory.csv

# Render a publication-ready SVG schematic diagram
msx render BouncingBall BouncingBall.mo -o schematic.svg

# Export an FMI 3.0 Co-Simulation FMU with embedded C and WebAssembly binaries
msx fmu BouncingBall BouncingBall.mo --fmi-version 3 --type cs --wasm --output BouncingBall.fmu
```

---

## Step 5: Closed-Loop Calibration with an AI Agent (`@modelscript/mcp`)

Suppose experimental drop-test telemetry shows a lower rebound height than `e = 0.7` predicts. With `@modelscript/mcp` connected to your AI assistant (see [AI Agents & MCP Workflows](./ai-agents.md)), the agent can invoke **`modelica_diff_calibrate`** or **`modelscript_closed_loop_synthesize`** to automatically fit `e` against your CSV data and re-verify `BouncingBallReq.sysml`:

```json
{
  "tool": "modelica_diff_calibrate",
  "arguments": {
    "modelName": "BouncingBall",
    "sourceCode": "model BouncingBall ... end BouncingBall;",
    "parameters": [{ "name": "e", "initial": 0.7, "min": 0.1, "max": 0.99 }],
    "optimizer": "lbfgs",
    "maxIterations": 40
  }
}
```

---

## Next Steps

- **[Polyglot Languages Overview](../languages/overview.md)** — Explore all 44 supported engineering languages and cross-domain projections.
- **[AI Agents & MCP Workflows](./ai-agents.md)** — Automate closed-loop synthesis, TGG reconciliation, and RTM auditing with AI agents.
- **[CI/CD & GitHub Actions](./ci-cd.md)** — Gate pull requests with `msx lint`, `msx verify --format sarif`, `msx pr-diff`, and `msx dhf export`.
- **[Triple Graph Grammar (TGG) Engine](../architecture/tgg.md)** — Learn how bidirectional synchronization keeps SysML v2 and Modelica aligned.
