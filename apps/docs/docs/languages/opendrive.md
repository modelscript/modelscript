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
  - **Euler Clothoids**: Spiral transitions computed via numerical Fresnel integrals:
    $$x(s) = x_0 + \int_0^s \cos\left(\theta_0 + \kappa_0 \tau + \frac{\dot{\kappa}}{2}\tau^2\right) d\tau$$
  - **Arcs & Polynomials**: Straight lines, constant-curvature circular arcs, and cubic parameter polynomials.
- Computes elevation profiles ($z(s)$), crossfall/camber angles, and superelevation banking.

### 2. Multi-Lane Topology & Junction Network

- Analyzes lane sections (`<laneSection>`), driving lanes, sidewalks, and shoulders.
- Reconstructs predecessor/successor road connections, junction path conflicts, and lane boundary polylines.

### 3. Path-Following Vehicle DAE Lowering

- Compiles OpenDRIVE tracks directly into curvilinear Frenet-Serret coordinates ($s, d, \theta_e$) within `@modelscript/runtime`'s `DAEBuilder` arena:
  $$\dot{s} = \frac{v \cos \theta_e}{1 - d \cdot \kappa(s)}, \quad \dot{d} = v \sin \theta_e, \quad \dot{\theta}_e = \dot{\psi} - \dot{s}\kappa(s)$$
- Enables high-speed closed-loop vehicle chassis simulation with [@modelscript/simpack](./simpack.md) and [@modelscript/adams](./adams.md).

### 4. GENSYS Track Export

- Projections (`opendrive-to-gensys.ts`) convert OpenDRIVE centerlines and gauge profiles into GENSYS `.geom` and `.trax` geometry files for railway and guideway vehicle testing.

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
