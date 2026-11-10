// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript Optical DWDM / OpenROADM & OTDR (Telcordia SR-4731 .sor) Language Definition.
 */

import { language } from "@modelscript/dsl";
import { lowerOpticalEdfaToDae } from "./dae/optical-to-dae.js";
import { lintOpticalTopology } from "./lints/optical-linter.js";
import { parseOpenRoadmTopology } from "./parser/openroadm-parser.js";

export const opticalLanguage = language({
  name: "optical",
  fileExtensions: [".sor", ".openroadm.json"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".sor", ".openroadm.json"],
  },

  actions: [
    {
      id: "optical_lint",
      title: "Lint OpenROADM Optical Topology",
      description: "Validates OpenROADM / GNPy DWDM optical spans, EDFA amplifiers, and channel OSNR margins.",
      category: "verify",
      execute: async (ctx: { documentText?: string | undefined }, params?: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const topo = parseOpenRoadmTopology(text);
        return lintOpticalTopology(topo);
      },
    },
    {
      id: "optical_to_dae",
      title: "Lower Optical EDFA to DAE",
      description: "Compiles dynamic Erbium-Doped Fiber Amplifier (EDFA) gain saturation differential equations into DAEBuilder.",
      category: "transform",
      execute: async () => {
        const dae = lowerOpticalEdfaToDae();
        return {
          modelName: "OpticalEdfaDynamic",
          variableCount: dae.getVarCount(),
          equationCount: dae.getEqCount(),
        };
      },
    },
  ],
});

export default opticalLanguage;
