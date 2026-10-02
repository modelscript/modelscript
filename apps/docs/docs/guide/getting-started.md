# Getting Started

This guide walks you through building your first **computable digital thread** in ModelScript — linking 1D dynamic physics in Modelica with 3D STEP CAD geometry and simulating the combined system.

---

## 1. Creating a Workspace

1. Open an empty project folder in VS Code.
2. Run the command `ModelScript: Initialize Workspace` from the command palette (`Ctrl+Shift+P`).
3. This creates a standard `.modelscript` workspace index configuration.

---

## 2. Writing Your First Physics Model

Create a new file called `BouncingBall.mo`:

```modelica
model BouncingBall
  parameter Real e = 0.7 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity acceleration";
  Real h(start=1.0) "Height of ball";
  Real v(start=0.0) "Velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 and v < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
```

The native WebAssembly GLR language server instantly activates, providing sub-millisecond diagnostics, type checking, and hover info.

---

## 3. Weaving the Digital Thread: Binding 3D CAD

In a computable digital thread, physical states directly drive geometric positions. If you have a STEP file (e.g., `ball.step`), you can bind the 3D geometry directly to the dynamic variable `h` using a `DynamicSelect` CAD annotation:

```modelica
model BouncingBall
  parameter Real e = 0.7 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity acceleration";
  Real h(start=1.0) "Height of ball" annotation(
    CAD(
      shape="ball.step",
      transform=DynamicSelect(
        translate(0, 0, 0),
        translate(0, h, 0)
      )
    )
  );
  Real v(start=0.0) "Velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 and v < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
```

Open the `BouncingBall.mo` file and click the **Open 3D Viewer** icon in the editor toolbar to see the 3D STEP mesh animate in synchrony with the continuous physics!

---

## 4. Simulating via the CLI

Execute the model using the unified `msx` command-line tool:

```bash
# Flatten to linear DAE arena and simulate
msx simulate BouncingBall BouncingBall.mo --stop-time 3.0 --step-size 0.01

# Render the interactive SVG schematic diagram
msx render BouncingBall BouncingBall.mo > schematic.svg
```

---

## 5. Next Steps

- Explore [Polyglot Languages](../languages/overview.md) to integrate SysML v2 architectural requirements and OWL2 ontologies into the digital thread.
- Learn about the [Triple Graph Grammar (TGG)](../architecture/tgg.md) engine for automated bidirectional model synchronization.
- Read about the [Nelson-Oppen Coordinator](../architecture/theory-coordinator.md) for cross-domain formal verification.
