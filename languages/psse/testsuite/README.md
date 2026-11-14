# PSS/E Testsuite & Commercial Ground-Truth Baselines

This directory contains `.raw` and companion `.dyr` benchmark cases (`ieee9`, `kundur2area`, `ieee14`, `ieee30`, `ieee118`) verified by `languages/psse/tests/corpus-regression.test.ts`.

## Adding Commercial Siemens PSS/E Reference Trajectories

To enforce automated numerical parity checks against commercial PSS/E:

1. Place a commercial `.out` binary channel file (`<case>.out`) or CSV export (`<case>.ref.csv`) next to `<case>.raw` (for example, `ieee9.out` or `ieee9.ref.csv`).
2. For `.ref.csv`, use a header row with time in column 0 and channel names matching `PsseTransientResult.variables` keys (e.g., `t,delta_1,omega_1,vt_1`).
3. Run `npm test --workspace=@modelscript/psse`. `corpus-regression.test.ts` will automatically compute NRMSE and Theil TIC via `calculateSotaDiscrepancy` and assert `NRMSE < 5%` and `Theil TIC < 0.05`.
4. You can also run ad-hoc comparisons via the CLI:
   ```bash
   msx psse verify languages/psse/testsuite/ieee9.raw languages/psse/testsuite/ieee9.dyr --ref-out=ieee9.out
   ```
