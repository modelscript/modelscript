# Getting Started

This guide will walk you through creating your first ModelScript project, utilizing the polyglot capabilities for Modelica and CAD.

## 1. Creating a Workspace

1. Open an empty folder in VS Code.
2. Run the command `ModelScript: Initialize Workspace` from the command palette (`Ctrl+Shift+P`).
3. This creates a standard `.modelscript` configuration directory for your project.

## 2. Writing Your First Modelica Class

Create a new file called `BouncingBall.mo`:

```modelica
model BouncingBall
  parameter Real e = 0.7 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity acceleration";
  Real h(start=1) "Height of ball";
  Real v(start=0) "Velocity of ball";
equation
  der(h) = v;
  der(v) = -g;
  when h <= 0 and v < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;
```

You should instantly see syntax highlighting and language server features.

## 3. Integrating 3D CAD

If you have a STEP file (e.g., `ball.step`), you can map the 3D model to the simulation variable `h` using a DynamicSelect annotation:

```modelica
model BouncingBall
  // ... parameters ...
  Real h(start=1) "Height of ball" annotation(
    CAD(
      shape="ball.step",
      transform=DynamicSelect(
        translate(0, 0, 0),
        translate(0, h, 0)
      )
    )
  );
  // ... equations ...
end BouncingBall;
```

Open the `BouncingBall.mo` file, and click the **Open 3D Viewer** icon in the editor toolbar to see the ball respond to the Modelica equations!
