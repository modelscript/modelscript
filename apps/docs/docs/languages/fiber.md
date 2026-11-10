---
title: "Fiber Outside Plant & SRLG Cadastre (TIA-598-D, GeoJSON)"
description: "@modelscript/fiber (languages/fiber) provides ANSI/TIA-598-D color code resolvers, outside plant GeoJSON cadastre parsers, strand-level circuit tracing, and Shared Risk Link Group (SRLG) disjointness analysis."
---

# Fiber Outside Plant & SRLG Cadastre (TIA-598-D, GeoJSON)

`@modelscript/fiber` (`languages/fiber`) provides outside plant (OSP) civil infrastructure modeling, strand-level optical routing, and physical route diversity analysis for **telecom carriers, metro fiber utilities, and critical infrastructure networks**.

---

## Supported Standards & Formats

| Format / Standard        | File Extensions     | Description                                                                                              |
| :----------------------- | :------------------ | :------------------------------------------------------------------------------------------------------- |
| **ANSI/TIA-598-D**       | Specification       | Standardized optical fiber cable color coding (12-color sequence) for buffer tubes, ribbons, and strands |
| **GeoJSON OSP Cadastre** | `.geojson`, `.json` | Geographic Outside Plant network schema for cables, ducts, utility poles, manholes, and splice closures  |
| **SRLG Risk Models**     | `.json`             | Shared Risk Link Group specifications for physical routing diversity verification                        |

---

## Key Capabilities

### 1. ANSI/TIA-598-D 12-Color Registry

- Full resolution of standard telecom color sequence:
  1. Blue, 2. Orange, 3. Green, 4. Brown, 5. Slate, 6. White, 7. Red, 8. Black, 9. Yellow, 10. Violet, 11. Rose, 12. Aqua.
- Hierarchical identification of high-count cables (up to 864+ fibers) with striped buffer tubes and bundle binders.

### 2. Multi-Hop Optical Strand Tracing

- Traces continuous optical lightpaths from Central Office (CO) Optical Distribution Frames (ODF) across cables, patch panels, and fusion splices down to customer demarcation points.
- Accounts for fusion splice insertion loss, connector reflections, and cable sheath lengths.

### 3. Shared Risk Link Group (SRLG) Disjointness

- Evaluates physical path isolation between primary and backup protection circuits:
  $$\text{SRLG}(P_{\text{primary}}) \cap \text{SRLG}(P_{\text{backup}}) = \emptyset$$
- Detects physical Single Points of Failure (SPOFs) where supposedly diverse customer circuits share common trenches, duct banks, utility poles, or bridge crossings.
- Calculates Jaccard physical diversity scores.

### 4. OTDR-to-GIS GPS Fault Geolocation

- Pinpoints the physical GPS latitude/longitude of fiber breaks or high-loss anomalies detected by OTDR traces.
- Applies cable helical twisting correction factor ($H = 1.01$–$1.05$):
  $$d_{\text{physical}} = \frac{d_{\text{optical}}}{H}$$
- Corrects for slack storage coils stored in vaults, manholes, and aerial snowshoes.
- Identifies the closest upstream and downstream access enclosures to dispatch emergency restoration crews directly to the proper vault.

### 5. NESC C2 Pole Loading, Make-Ready & FCC BDC H3 Fabric

- Solves aerial catenary sag-tension under NESC Heavy, Medium, Light, and Extreme Wind loading zones, and audits utility pole ground-line bending moment utilization and NESC Rule 235/238 vertical communication-to-supply clearances (plus CSA C22.3 No. 1 and Eurocode EN 1991-1-4).
- Discretizes fiber service polygons into Uber H3 resolution-8/9/10 hexagonal cells (`discretizeCoverageToH3`) for FCC Broadband Data Collection (BDC) filings.

---

## Pre-Flight Outside Plant Lint Rules

<LintRules lang="fiber" />

---

## CLI Usage (`msx fiber`)

```bash
# Convert OTDR optical fault distance into exact WGS84 GIS coordinates with helix slack correction
msx fiber locate route.geojson --distance=4250 --helix=1.03

# Trace end-to-end fiber strand connectivity and splice budget
msx fiber trace network.json --cable=CBL-101 --strand=12

# Audit Shared Risk Link Group (SRLG) physical path diversity and single points of failure
msx fiber srlg network.json

# Resolve ANSI/TIA-598-D buffer tube and fiber strand color codes
msx fiber color 144

# Discretize fiber coverage polygons into FCC Broadband Data Collection (BDC) H3 hexagons
msx fiber bdc route.geojson --tech=50 --down=1000 --up=1000 --res=9 --out=bdc.geojson

# Run NESC C2 / GO 95 utility pole structural loading and make-ready clearance audits
msx fiber pole-loading --pole-class=4 --species=southern-yellow-pine --length=40 --grade=C-elsewhere
msx fiber make-ready --prop-height=21
```

