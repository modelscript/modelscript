// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { extractStepAssembly } from "../src/assembly-extractor.js";

const STEP_ASSEMBLY = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('NIST AP242 Benchmark'),'2;1');
FILE_NAME('gimbal.stp','2026-10-25T20:00:00',('NIST'),('ModelScript'),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('mechanical design');
#2 = PRODUCT_CONTEXT('',#1,'mechanical');
#10 = PRODUCT('GimbalAssembly','Two-Axis Gimbal','',(#2));
#20 = PRODUCT_DEFINITION_FORMATION('1.0','',#10);
#30 = PRODUCT_DEFINITION('design','',#20,#2);
#40 = PRODUCT('BaseMount','Aluminum Base','',(#2));
#41 = PRODUCT_DEFINITION_FORMATION('1.0','',#40);
#42 = PRODUCT_DEFINITION('design','',#41,#2);
#100 = CARTESIAN_POINT('origin', (0.0, 0.0, 0.0));
#101 = DIRECTION('z-axis', (0.0, 0.0, 1.0));
#102 = DIRECTION('x-axis', (1.0, 0.0, 0.0));
#110 = AXIS2_PLACEMENT_3D('Base Placement', #100, #101, #102);
ENDSEC;
END-ISO-10303-21;`;

export const stepBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "step",
  referenceTool: "NIST STEP AP242 / ISO 10303-21 Assembly",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const asm = extractStepAssembly(STEP_ASSEMBLY);
    const d1 = performance.now() - t0;

    return [
      {
        id: "step-ap242-assembly",
        name: "ISO 10303-21 STEP AP242 Product Assembly Extraction",
        scale: "micro",
        referenceTool: "NIST STEP AP242 / ISO 10303-21 Assembly",
        metricKind: "exact",
        threshold: 0,
        measuredError: asm.parts.size >= 2 ? 0 : 1,
        passed: asm.parts.size >= 2,
        durationMs: d1,
        details: `parts=${asm.parts.size}`,
      },
    ];
  },
};
