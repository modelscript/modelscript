// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractPscadSteadyStateSnapshot } from "@modelscript/pscad";
import { parseRaw, pssePowerFlowToSnapshot, psseToEmtNetlist, solvePowerFlowAsync } from "@modelscript/psse";
import assert from "node:assert/strict";
import test from "node:test";
import { extractSysML2SeasonalSpec, runSysML2SeasonalVerificationSweep } from "../src/seasonal-sweep.js";

const THREE_BUS_SUMMER_RAW = `0, 100.00, 33, 0, 1, 60.00
THREE BUS SUMMER PEAK
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'GEN2',  230.0000, 2, 1, 1, 1, 1.01000, -2.0000
3, 'LOAD3', 230.0000, 1, 1, 1, 1, 1.00000, -4.0000
0 / END OF BUS DATA
3, '1 ', 1, 1, 1, 75.0, 25.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 45.0, 10.0, 100.0, -100.0, 1.020, 0, 100.0, 0.003, 0.18, 0, 0, 1, 1, 100, 200, 0
2, '1 ', 30.0, 5.0, 100.0, -100.0, 1.010, 0, 100.0, 0.003, 0.20, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.010, 0.080, 0.04, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
1, 3, '1 ', 0.012, 0.100, 0.05, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
2, 3, '1 ', 0.015, 0.120, 0.06, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;

const THREE_BUS_WINTER_RAW = THREE_BUS_SUMMER_RAW.replace("75.0, 25.0", "45.0, 12.0");

const SYSML_SEASONAL_MODEL = `
package SeasonalPowerFlowStudy {
  part def PsseEngine {
    attribute solver = "psse";
  }
  part def PscadEngine {
    attribute solver = "pscad";
  }

  variation part def SeasonalOperatingCases {
    variant part SummerPeak {
      attribute season = "SummerPeak";
      attribute rawKey = "summer";
      attribute ambientTempC = 40;
    }
    variant part WinterPeak {
      attribute season = "WinterPeak";
      attribute rawKey = "winter";
      attribute ambientTempC = 0;
    }
  }

  requirement def SummerVoltageEnvelope {
    assume constraint { season == "SummerPeak" }
    require constraint { minVmPu >= 0.90 and convergedPowerFlow == true }
  }

  requirement def WinterVoltageEnvelope {
    assume constraint { season == "WinterPeak" }
    require constraint { minVmPu >= 0.95 and convergedPowerFlow == true }
  }
}
`;

test("extractSysML2SeasonalSpec and runSysML2SeasonalVerificationSweep evaluate PSS/E + PSCAD across seasons", async () => {
  const spec = extractSysML2SeasonalSpec(SYSML_SEASONAL_MODEL);
  assert.equal(spec.packageName, "SeasonalPowerFlowStudy");
  assert.equal(spec.variants.length, 2);
  assert.equal(spec.variants[0]!.name, "SummerPeak");
  assert.equal(spec.variants[1]!.name, "WinterPeak");
  assert.equal(spec.globalRequirements.length, 2);

  const rawCases: Record<string, string> = {
    summer: THREE_BUS_SUMMER_RAW,
    winter: THREE_BUS_WINTER_RAW,
  };

  const matrix = await runSysML2SeasonalVerificationSweep(SYSML_SEASONAL_MODEL, async (variant) => {
    const rawKey = String(variant.attributes["rawKey"] ?? "summer");
    const psseCase = parseRaw(rawCases[rawKey]!);
    const pf = await solvePowerFlowAsync(psseCase);
    const baseline = pssePowerFlowToSnapshot(psseCase, pf, variant.name);
    const pscadSnap = extractPscadSteadyStateSnapshot(psseToEmtNetlist(psseCase), {
      solver: "pscad",
      nominalFrequencyHz: baseline.frequencyHz,
    });

    const minVmPu = Math.min(...baseline.buses.map((b) => b.vmPu));
    return {
      baseline,
      comparators: [pscadSnap],
      comparisonOptions: {
        vmTolerancePu: 0.01,
        vaToleranceDeg: 3.0,
      },
      metrics: {
        minVmPu,
        convergedPowerFlow: pf.converged,
      },
    };
  });

  assert.equal(matrix.totalVariants, 2, matrix.summaryText);
  assert.equal(matrix.passedVariants, 2, matrix.summaryText);
  assert.equal(matrix.overallPassed, true);
  assert.ok(matrix.variants[0]!.powerFlowComparison);
  assert.equal(matrix.variants[0]!.powerFlowComparison!.pairs[0]!.matchedBuses, 3);
});
