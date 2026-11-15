# EMT Screening & PMView Reference Pack

Demonstrates how to build a multi-engine engineering verification DAG in user-space using standard **SysML v2** definitions (`src/system.sysml`), **@modelscript/sdk** helpers (`src/pipeline-stages.ts`, `src/emt-checks.ts`), and generic runtime capabilities:

1. **`BaselineModelAudit` (`action def`):** Audits `data/poi_case.raw` paired with `data/poi_case.dyr` at `poiBus = 300` via `ctx.inspect(...)` (`nerc-mod032` + `short-circuit` POI fault MVA) and writes a JSON audit report with `ctx.writeArtifact(...)`.
2. **`GridStrengthGate` (`analysis def`):** Consumes `BaselineModelAudit.poiFaultMva`, computes `scr = poiFaultMva / ibrRatedMw`, and determines `emtMandatory = scr < minScr` (`minScr = 2.0`).
3. **`EmtSsciAndLvrtCheck` (`verification def`, guarded):** Gated by `assume constraint { GridStrengthGate.emtMandatory == true }`. When skipped on a strong grid (`SCR >= 2.0`), it reports vacuous pass; when triggered on a weak grid (`SCR < 2.0`), it runs `ctx.inspect(...)` on `data/ibr_interconnection.pscx`, executes PSCAD frequency-scan and transient simulations (`ctx.simulate(...)`), checks LVRT envelope compliance via `checkEnvelope(...)`, and screens for SSCI damping risk.
4. **`PmviewLvrtCheck` (`verification def`):** Runs after `BaselineModelAudit` (`dependsOn`), parsing `data/pmview_lvrt_profile.txt` with `parseDelimitedTable` + `ctx.readFile` and verifying ride-through margin via `@sysml` convention discovery (`src/emt-checks.ts`).
5. **`TransformerCalibrationCheck` (`verification def`):** Runs after `BaselineModelAudit` (`dependsOn`), calibrating effective inductance `fittedLH` against measured SFRA impedance data (`data/sfra_curve.csv`).

## Running Headlessly

Default strong-grid run (`ibrRatedMw = 250.0` -> `EmtSsciAndLvrtCheck` skipped cleanly):

```bash
msx sysml-run packages/examples/emt-screening-pack/src/system.sysml
```

Override plant rating to trigger weak-grid EMT screening and export a signed PSI 21 DDP provenance bundle:

```bash
msx sysml-run packages/examples/emt-screening-pack/src/system.sysml \
  --param GridStrengthGate.ibrRatedMw=350 \
  --bundle reports/emt-screening.ddp.zip \
  --sign-key path/to/ed25519-pkcs8.pem
```
