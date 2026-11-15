---
title: "OpenDRIVE Road Networks (.xodr)"
description: "@modelscript/opendrive (languages/opendrive) provides compiler, analytical 3D clothoid sampling, path-following DAE lowering, and vehicle dynamics integration for the ASAM OpenDRIVE standard."
---

# OpenDRIVE Road Networks (`.xodr`)

`@modelscript/opendrive` (`languages/opendrive`) provides compiler, analytical 3D clothoid sampling, path-following DAE lowering, and vehicle dynamics integration for the **ASAM OpenDRIVE** standard.

---

## Supported Extensions & Standards

| Extension       | Standard / Format            | Description                                                               |
| :-------------- | :--------------------------- | :------------------------------------------------------------------------ |
| `.xodr`, `.xml` | **ASAM OpenDRIVE v1.4–v1.7** | Description of road networks, lanes, junctions, and spatial road geometry |

---

## Key Capabilities

### 1. Analytical 3D Fresnel Clothoid Sampling

- Evaluates road reference lines parameterized by arc length $s$ with smooth curvature transitions:
  - **Euler Clothoids**: Spiral transitions whose planar $x$-coordinate is computed via numerical Fresnel integrals of linearly varying curvature:
    $$x(s) = x_0 + \int_0^s \cos\left(\theta_0 + \kappa_0 \tau + \frac{\dot{\kappa}}{2}\tau^2\right) d\tau$$

    | Symbol         | Meaning                                                            | Units / Domain         |
    | :------------- | :----------------------------------------------------------------- | :--------------------- |
    | $x(s), x_0$    | Global $x$-coordinate at arc length $s$ and initial $x$-coordinate | $\text{m}$             |
    | $s, \tau$      | Road reference-line arc length and integration variable            | $\text{m}$ ($s \ge 0$) |
    | $\theta_0$     | Initial heading angle at $s = 0$                                   | $\text{rad}$           |
    | $\kappa_0$     | Initial curvature at $s = 0$                                       | $\text{m}^{-1}$        |
    | $\dot{\kappa}$ | Constant rate of curvature change with respect to arc length       | $\text{m}^{-2}$        |

  - **Arcs & Polynomials**: Straight lines, constant-curvature circular arcs, and cubic parameter polynomials.

- Computes elevation profiles ($z(s)$), crossfall/camber angles, and superelevation banking.

### 2. Multi-Lane Topology & Junction Network

- Analyzes lane sections (`<laneSection>`), driving lanes, sidewalks, and shoulders.
- Reconstructs predecessor/successor road connections, junction path conflicts, and lane boundary polylines.

### 3. Path-Following Vehicle DAE Lowering

- Compiles OpenDRIVE tracks directly into curvilinear Frenet-Serret coordinates ($s, d, \theta_e$) within `@modelscript/runtime`'s `DAEBuilder` arena, expressing longitudinal progress, lateral offset rate, and heading-error dynamics along a curved reference path:
  $$\dot{s} = \frac{v \cos \theta_e}{1 - d \cdot \kappa(s)}, \quad \dot{d} = v \sin \theta_e, \quad \dot{\theta}_e = \dot{\psi} - \dot{s}\kappa(s)$$

  | Symbol                     | Meaning                                                                | Units / Domain               |
  | :------------------------- | :--------------------------------------------------------------------- | :--------------------------- |
  | $\dot{s}$                  | Longitudinal speed along the road reference line                       | $\text{m/s}$                 |
  | $d, \dot{d}$               | Lateral offset from centerline and its time derivative                 | $\text{m}$, $\text{m/s}$     |
  | $\theta_e, \dot{\theta}_e$ | Vehicle heading error relative to road tangent and its time derivative | $\text{rad}$, $\text{rad/s}$ |
  | $v$                        | Vehicle scalar speed                                                   | $\text{m/s}$                 |
  | $\kappa(s)$                | Road reference-line curvature at arc length $s$                        | $\text{m}^{-1}$              |
  | $\dot{\psi}$               | Vehicle yaw rate                                                       | $\text{rad/s}$               |

- Enables high-speed closed-loop vehicle chassis simulation with [@modelscript/simpack](./simpack.md) and [@modelscript/adams](./adams.md).

### 4. GENSYS Track Export

- Projections (`opendrive-to-gensys.ts`) convert OpenDRIVE centerlines and gauge profiles into GENSYS `.geom` and `.trax` geometry files for railway and guideway vehicle testing.

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="opendrive" />

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="opendrive" />

---

## CLI Usage

```bash
# Lint an OpenDRIVE road network
msx opendrive lint HighwayInterchange.xodr

# Sample 3D road centerline and lane boundaries at 0.5m resolution
msx opendrive track HighwayInterchange.xodr --step 0.5 -o track_points.json

# Lower road geometry to DAE path-following arena
msx opendrive to-dae HighwayInterchange.xodr --out=road.dae.json

# Project into GENSYS track geometry format
msx opendrive to-gensys HighwayInterchange.xodr -o TrackGeometry.geom
```
