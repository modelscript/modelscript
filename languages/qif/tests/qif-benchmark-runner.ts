// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { parseQif } from "../src/parser/index.js";
import { evaluateQifSpc, lowerQifToDae } from "../src/spc/index.js";

const QIF_SPC_DSL = `
  QIF 3.0.0 qpId="99999999-0000-4000-8000-000000000001"
  HEADER partName="GearboxCover" units="mm"
  FEATURE F_BORE Cylinder "BearingBore" size=50.0 points=8 internal=true
  DEVICE CMM1 CMM "Zeiss_Prismo" uncertainty=0.001
  CHARACTERISTIC C_POS Position "BearingBore_Pos" zone=0.06 material=MMC features=[F_BORE] device=CMM1
  ACTUAL A1 characteristic=C_POS serial="SN-01" value=0.038 actualSize=50.02 status=PASS
  ACTUAL A2 characteristic=C_POS serial="SN-02" value=0.040 actualSize=50.02 status=PASS
  ACTUAL A3 characteristic=C_POS serial="SN-03" value=0.042 actualSize=50.02 status=PASS
  ACTUAL A4 characteristic=C_POS serial="SN-04" value=0.039 actualSize=50.02 status=PASS
  ACTUAL A5 characteristic=C_POS serial="SN-05" value=0.041 actualSize=50.02 status=PASS
`;

export const qifBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "qif",
  referenceTool: "QIF 3.0 / ISO 22514-7 GD&T MMC SPC",
  defaultTolerance: 1e-6,
  metricKind: "max-relative-error",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const doc = parseQif(QIF_SPC_DSL);
    const spc = evaluateQifSpc(doc);
    const dae = lowerQifToDae(doc);
    const d1 = performance.now() - t0;

    const rep = spc.characteristics[0]!;
    const meanErr = Math.abs(rep.mean - 0.04);
    const turErr = Math.abs((rep.tur ?? 0) - 40.0);
    const maxErr = Math.max(meanErr, turErr);

    return [
      {
        id: "qif-mmc-spc-tur",
        name: "QIF 3.0 MMC Bonus Tolerance, Cp/Cpk & TUR Evaluation",
        scale: "micro",
        referenceTool: "QIF 3.0 / ISO 22514-7 GD&T MMC SPC",
        metricKind: "max-relative-error",
        threshold: 1e-6,
        measuredError: maxErr,
        passed: spc.overallPassRate === 1.0 && rep.cpk > 2.0 && maxErr < 1e-6 && dae.getVarCount() > 0,
        durationMs: d1,
        details: `effTol=${rep.effectiveTolerance}mm, Cpk=${rep.cpk.toFixed(2)}, TUR=${rep.tur}`,
      },
    ];
  },
};
