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
