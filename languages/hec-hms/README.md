<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/hec-hms`

US Army Corps of Engineers HEC-HMS watershed rainfall-runoff hydrology and channel routing package for ModelScript.

## Overview

HEC-HMS is the primary international engineering standard for watershed hydrology, flood forecasting, and reservoir operations. This package pairs directly with `@modelscript/hec-ras` to provide end-to-end catchment-to-river hydraulics:

- High-throughput parser and serializer for HEC-HMS basin (`.basin`) and project (`.hms`) decks.
- SCS Runoff Curve Number ($CN$) loss calculations and initial abstraction evaluation.
- SCS Dimensionless Unit Hydrograph convolution and catchment routing.
- Muskingum and Muskingum-Cunge open-channel routing routines.
- Direct projection into HEC-RAS unsteady boundary flow (`.u01`) hydrograph tables.
- Zero-GC linear memory `DAEBuilder` lowering for watershed mass-storage continuity.
- Comprehensive linter validating drainage network topology, negative areas, and cycles.
- Language Server Protocol (LSP) document symbols and diagnostics.

## Feature Matrix

| Feature           | Supported | Description                                                                  |
| :---------------- | :-------- | :--------------------------------------------------------------------------- |
| Basin Parsing     | Yes       | Full support for `Subbasin`, `Reach`, `Junction`, `Reservoir`, `Sink`        |
| SCS-CN Loss       | Yes       | Potential retention $S$, initial abstraction $I_a$, cumulative runoff $Q$    |
| Unit Hydrograph   | Yes       | Standard SCS Dimensionless Unit Hydrograph convolution                       |
| Muskingum Routing | Yes       | Subreach-based Muskingum routing ($K, X$) with numerical stability checks    |
| HEC-RAS Coupling  | Yes       | Automated export to HEC-RAS unsteady boundary condition decks (`.u01`)       |
| DAE Lowering      | Yes       | Compilation of watershed storage continuity into `DAEBuilder` linear memory  |
| Diagnostics       | Yes       | Detection of drainage cycles, unreferenced downstream elements, invalid $CN$ |

## Usage

```typescript
import { parseHmsBasin, simulateSubbasinRunoff, hmsHydrographToHecRasU01 } from "@modelscript/hec-hms";

const basin = parseHmsBasin(basinFileContent);
const subbasin = basin.subbasins.get("UpperWatershed")!;

const hydrograph = simulateSubbasinRunoff(subbasin, {
  precipitationTotal: 85.0, // mm
  durationHours: 24.0,
});

const u01Deck = hmsHydrographToHecRasU01(hydrograph, {
  riverName: "Columbia",
  reachName: "UpperReach",
});
```
