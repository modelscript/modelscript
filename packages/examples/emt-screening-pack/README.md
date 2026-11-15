# EMT Screening & PMView Reference Pack

Demonstrates how to express power-system EMT screening workflows using standard **SysML v2** definitions and **@modelscript/sdk** TypeScript capabilities with implicit `@sysml` auto-discovery (no `wasm://` or `ts://` URIs):

- **Grid Strength Gatekeeping (`GridStrengthGate`):** Computes Short Circuit Ratio (`SCR = faultMVA / ratedMW`) at the POI and enforces `SCR >= 2.0` (or flags mandatory EMT study when `SCR < 2.0`).
- **PMView LVRT Ride-Through (`PmviewLvrtCheck`):** Parses a tabular voltage boundary profile (`data/pmview_lvrt_profile.txt`) via `parseDelimitedTable` + `ctx.readFile` and verifies ride-through margin against PRC-029-1.

Run headlessly via:

```bash
msx sysml-run packages/examples/emt-screening-pack/src/system.sysml
```
