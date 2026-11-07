---
title: 3MF Medical Surgical Guides & Implants (.3mf)
description: Native WebAssembly parsing, half-edge 2-manifold watertightness and Euler-Poincaré characteristic verification, surgical guide wall-thickness and K-wire clearance auditing, DAEBuilder lowering, and STEP / OpenSCAD projections for ISO/ASTM 52915 3MF.
---

# 3MF Medical Surgical Guides & Implants (`.3mf`)

`@modelscript/three-mf` (`languages/three-mf`) provides native WebAssembly parsing, **half-edge 2-manifold watertightness** and Euler-Poincaré characteristic ($\chi = V - E + F$) verification, surgical guide minimum wall-thickness and drill-sleeve K-wire clearance auditing, osteotomy cutting-plane normal validation, `DAEBuilder` lowering, and ISO 10303-21 STEP / OpenSCAD projections for **ISO/ASTM 52915 3MF Medical** patient-specific 3D-printed surgical guides and cranial/orthopedic implants.

---

## Supported Extensions & Standards

| Extension | Format             | Description                                                                                                                               |
| :-------- | :----------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `.3mf`    | ISO/ASTM 52915 3MF | 3D Manufacturing Format (`<model>`, `<resources>`, `<mesh>`, `<vertices>`, `<triangles>`, `<build>`, and surgical guide/implant metadata) |

---

## Key Capabilities

### 1. Watertight 2-Manifold Topology & Signed Divergence Volume

`@modelscript/three-mf` constructs the directed half-edge incidence graph over `<vertices>` and `<triangles>` (`analyzeMeshTopology`) to verify that every directed edge $(u \to v)$ is paired with exactly one opposite half-edge $(v \to u)$:

$$\chi = V - E + F = 2(S - g), \qquad V_{\text{signed}} = \frac{1}{6}\sum_{f=1}^{F} \mathbf{v}_{f,1} \cdot \left(\mathbf{v}_{f,2} \times \mathbf{v}_{f,3}\right)$$

where $S$ is the number of closed connected shells and $g$ is the topological genus (e.g., number of drill-guide holes through the template). Pre-flight checks flag open boundary edges ($N_{\text{boundary}} > 0$), non-manifold edges shared by $>2$ faces, inverted negative-volume shells, and zero-area degenerate triangles ($\|\left(\mathbf{v}_2 - \mathbf{v}_1\right) \times \left(\mathbf{v}_3 - \mathbf{v}_1\right)\| = 0$).

### 2. Surgical Cutting Guide & Drill-Sleeve Verification

- Validates patient-specific osteotomy cutting guides and pedicle/dental drill sleeves:
  - **Minimum Wall Thickness**: Enforces structural wall thickness $t_{\text{wall}} \ge 1.2\text{ mm}$ for biocompatible additive manufacturing (SLS PA12, SLA BioMed Clear/Amber, Ti6Al4V DMLS).
  - **Drill-Sleeve Annular Wall & K-Wire Clearance**: Checks radial wall thickness $r_{\text{outer}} - r_{\text{inner}} \ge 1.0\text{ mm}$ and positive diametral clearance between guide cylinder bore and surgical drill bit / Kirschner wire.
  - **Osteotomy Plane Normals**: Verifies unit-normalized cutting-plane normal vectors ($\lvert \|\mathbf{n}\|_2 - 1 \rvert < 10^{-4}$).

### 3. ISO 10303-21 STEP, OpenSCAD & DAE Lowering

- Exports verified surgical guides and implants to **ISO 10303-21 STEP** (`threeMfToStep`), **OpenSCAD** (`threeMfToScad`), and `@modelscript/runtime`'s `DAEBuilder` arena (`lowerThreeMfToDae`).

---

## Pre-Flight Diagnostics

<LintRules lang="three-mf" />

---

## CLI Usage

```bash
# Inspect 3MF objects, build items, and surgical guide metadata
msx three-mf inspect MandibleOsteotomyGuide.3mf

# Validate 2-manifold watertightness, wall thickness, and osteotomy planes
msx three-mf validate MandibleOsteotomyGuide.3mf

# Compute mesh topology metrics (Euler characteristic, volume, surface area)
msx three-mf topology MandibleOsteotomyGuide.3mf

# Export surgical guide mesh to ISO 10303-21 STEP, OpenSCAD, or DAE arena
msx three-mf to-step MandibleOsteotomyGuide.3mf > MandibleOsteotomyGuide.stp
msx three-mf to-scad MandibleOsteotomyGuide.3mf > MandibleOsteotomyGuide.scad
msx three-mf to-dae MandibleOsteotomyGuide.3mf
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseThreeMfModel,
  analyzeMeshTopology,
  lowerThreeMfToDae,
  threeMfToStep,
  threeMfToScad,
} from "@modelscript/three-mf";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseThreeMfModel(threeMfXmlSource);
const topology = analyzeMeshTopology(model);

const builder = new DAEBuilder();
lowerThreeMfToDae(model, builder);
const stepFile = threeMfToStep(model);
const scadCode = threeMfToScad(model);
```
