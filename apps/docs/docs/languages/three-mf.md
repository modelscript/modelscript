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

- Constructs the mesh half-edge incidence graph to verify that every triangle edge is shared by exactly two oppositely oriented faces (zero boundary holes, zero non-manifold edges, zero degenerate zero-area triangles).
- Computes exact signed divergence volume, surface area, connected shells, genus $g$, and Euler characteristic $\chi = V - E + F = 2(1 - g)$.

### 2. Surgical Cutting Guide & Drill-Sleeve Verification

- Validates patient-specific osteotomy cutting guides and pedicle/dental drill sleeves:
  - Enforces minimum structural wall thickness ($\ge 1.2\text{ mm}$ for biocompatible PA12 / Formlabs BioMed resins) and positive drill-guide sleeve radial wall thickness ($r_{\text{outer}} - r_{\text{inner}} \ge 1.0\text{ mm}$).
  - Verifies unit-normalized osteotomy cutting-plane normals ($\|\mathbf{n}\| = 1$) and drill trajectory vectors.

### 3. ISO 10303-21 STEP & OpenSCAD Export

- Exports verified surgical guides and implants to **ISO 10303-21 STEP** (`threeMfToStep`) and **OpenSCAD** (`threeMfToScad`).

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

# Export surgical guide mesh to ISO 10303-21 STEP or OpenSCAD
msx three-mf to-step MandibleOsteotomyGuide.3mf > MandibleOsteotomyGuide.stp
msx three-mf to-scad MandibleOsteotomyGuide.3mf > MandibleOsteotomyGuide.scad
```
