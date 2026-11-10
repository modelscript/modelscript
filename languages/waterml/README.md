<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/waterml`

OGC WaterML 2.0 (OGC 12-031r4 / WMO No. 1083) and TimeseriesML hydrologic telemetry engine, stage-discharge power-law rating curve fitting, hydraulic engine boundary projections (HEC-RAS, EPANET, SWMM), and zero-GC linear-memory `DAEBuilder` arena lowering for ModelScript.

Supports streamflow telemetry, USGS NWIS observation streams, Copernicus GloFAS/EFAS datasets, reservoir stage observations, and hydrologic simulation integration.

---

## Features

| Feature                      | Description                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Standards Compliance**     | Full implementation of OGC WaterML 2.0 (XML and JSON) and TimeseriesML standards.                                                                                               |
| **Hydrologic Rating Curves** | Stage-to-discharge power-law rating equation $Q = a(h - h_0)^b$, piecewise-linear table interpolation, and least-squares regression fitting.                                    |
| **Boundary Projections**     | Seamless conversion of hydrologic timeseries into HEC-RAS unsteady flow hydrographs (`.u01`), EPANET hydraulic patterns (`[PATTERNS]`), and SWMM timeseries (`[TIMESERIES]`).   |
| **DAE Arena Lowering**       | Direct compilation of telemetry observations and rating curves into linear-memory `@modelscript/runtime` `DAEBuilder` arena.                                                    |
| **Diagnostic Linter**        | Validates collection metadata (`WML1001`), missing IDs (`WML1002`), timestamp monotonicity (`WML2001`), physical non-negativity (`WML3001`), and rating parameters (`WML4001`). |
| **LSP Integration**          | Document symbols for monitoring points and observation streams with real-time diagnostics.                                                                                      |

---

## Installation

```bash
npm install @modelscript/waterml
```

---

## Quick Start

```typescript
import { parseWaterMl, fitRatingCurve, lowerWaterMlToDae, projectWaterMlToHecRas } from "@modelscript/waterml";

// 1. Ingest WaterML 2.0 XML or JSON telemetry
const doc = parseWaterMl(waterMlXml);
console.log(`Loaded collection: ${doc.id} with ${doc.timeSeriesList.length} time series`);

// 2. Fit stage-discharge rating curve
const fit = fitRatingCurve([
  { stageM: 1.0, dischargeM3S: 12.5 },
  { stageM: 2.0, dischargeM3S: 45.2 },
  { stageM: 3.0, dischargeM3S: 98.7 },
]);
console.log(
  `Fitted Q = ${fit.equation.a.toFixed(2)} * (h - ${fit.equation.h0})^${fit.equation.b.toFixed(2)}, RMSE: ${fit.rmse.toFixed(3)}`,
);

// 3. Lower telemetry timeseries into zero-GC DAE arena
const dae = lowerWaterMlToDae(doc);
console.log(`DAE arena instantiated with ${dae.varCount} variables and ${dae.eqCount} equations`);

// 4. Project streamflow to HEC-RAS flow hydrograph
const rasHydrograph = projectWaterMlToHecRas(doc.timeSeriesList[0]!);
```

---

## License

AGPL-3.0-or-later
