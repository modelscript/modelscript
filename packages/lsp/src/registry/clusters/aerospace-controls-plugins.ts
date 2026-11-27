// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  automationMLLanguage,
  getAutomationMLDocumentSymbols,
  getAutomationMLHover,
  validateAutomationML,
} from "@modelscript/automationml";
import {
  ccsdsActionHandlers,
  ccsdsLanguage,
  getCcsdsDocumentSymbols,
  getCcsdsHover,
  validateCcsds,
} from "@modelscript/ccsds";
import {
  easy5ActionHandlers,
  easy5Language,
  getEasy5DocumentSymbols,
  getEasy5Hover,
  validateEasy5,
} from "@modelscript/easy5";
import {
  getJsbsimDocumentSymbols,
  getJsbsimHover,
  jsbsimActionHandlers,
  jsbsimLanguage,
  validateJsbsim,
} from "@modelscript/jsbsim";
import {
  getPlcopenDocumentSymbols,
  getPlcopenHover,
  plcopenActionHandlers,
  plcopenLanguage,
  validatePlcopen,
} from "@modelscript/plcopen";
import {
  getRocetsDocumentSymbols,
  getRocetsHover,
  rocetsActionHandlers,
  rocetsLanguage,
  validateRocets,
} from "@modelscript/rocets";
import {
  getSimulinkDocumentSymbols,
  getSimulinkHover,
  simulinkActionHandlers,
  simulinkLanguage,
  validateSimulink,
} from "@modelscript/simulink";
import {
  getTwentySimCompletions,
  getTwentySimDocumentSymbols,
  getTwentySimHover,
  twentySimLanguage,
  validateTwentySim,
} from "@modelscript/twentysim";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry } from "../LanguageRegistry.js";
import {
  type DocInput,
  docText,
  offsetToPos,
  registerStandardPlugin,
  toCompletionItems,
  toHover,
} from "../standard-plugin.js";

export const AEROSPACE_CONTROLS_PLUGIN_IDS: readonly string[] = [
  "simulink",
  "easy5",
  "jsbsim",
  "rocets",
  "ccsds",
  "plcopen",
  "automationml",
  "twentysim",
];

/**
 * Registers the 8 aerospace, flight dynamics, astrodynamics, and controls language plugins.
 */
export function registerAerospaceControlsPlugins(workspaceManager?: WorkspaceManager): void {
  // 1. EASY5
  registerStandardPlugin({
    id: "easy5",
    name: "EASY5",
    extensions: [".ez5", ".ezm", ".ezd", ".eas"],
    languageDef: easy5Language,
    symbols: getEasy5DocumentSymbols,
    hoverPos: getEasy5Hover,
    validate: validateEasy5,
    actionHandlers: easy5ActionHandlers,
  });

  // 2. ROCETS
  registerStandardPlugin({
    id: "rocets",
    name: "ROCETS",
    extensions: [".roc", ".deck"],
    languageDef: rocetsLanguage,
    symbols: getRocetsDocumentSymbols,
    hoverPos: getRocetsHover,
    validate: validateRocets,
    actionHandlers: rocetsActionHandlers,
  });

  // 3. PLCopen
  registerStandardPlugin({
    id: "plcopen",
    name: "IEC 61131-3 PLCopen / Structured Text",
    extensions: [".xml", ".plcopen", ".st"],
    languageDef: plcopenLanguage,
    symbols: getPlcopenDocumentSymbols,
    hoverOffset: getPlcopenHover,
    validateWithTree: validatePlcopen,
    actionHandlers: plcopenActionHandlers,
  });

  // 4. JSBSim
  registerStandardPlugin({
    id: "jsbsim",
    name: "JSBSim Flight Dynamics",
    extensions: [".xml"],
    languageDef: jsbsimLanguage,
    symbols: getJsbsimDocumentSymbols,
    hoverPos: getJsbsimHover,
    validateWithTree: validateJsbsim,
    actionHandlers: jsbsimActionHandlers,
  });

  // 5. CCSDS
  registerStandardPlugin({
    id: "ccsds",
    name: "CCSDS",
    extensions: [".ccsds", ".oem", ".opm", ".omm", ".xtce"],
    languageDef: ccsdsLanguage,
    symbols: getCcsdsDocumentSymbols,
    hoverOffset: getCcsdsHover,
    validate: validateCcsds,
    actionHandlers: ccsdsActionHandlers,
  });

  // 6. Simulink
  registerStandardPlugin({
    id: "simulink",
    name: "MATLAB Simulink",
    extensions: [".slx", ".mdl"],
    languageDef: simulinkLanguage,
    symbols: getSimulinkDocumentSymbols,
    validateWithTree: validateSimulink,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getSimulinkHover(text, offsetToPos(text, offset), "model.mdl")),
    },
    actionHandlers: simulinkActionHandlers,
  });

  // 7. 20-sim (Bond Graphs & SIDOPS Multi-Domain Simulation)
  registerStandardPlugin({
    id: "twentysim",
    name: "20-sim",
    extensions: [".emx", ".emxz", ".sid"],
    languageDef: twentySimLanguage,
    symbols: getTwentySimDocumentSymbols,
    customHandlers: {
      validate: (doc: DocInput) => validateTwentySim(docText(doc)),
      hover: (offset: number, text: string) => toHover(getTwentySimHover(text, offset)),
      complete: () => toCompletionItems(getTwentySimCompletions()),
    },
  });

  // 8. AutomationML
  registerStandardPlugin({
    id: "automationml",
    name: "AutomationML",
    extensions: [".aml", ".amlx"],
    languageDef: automationMLLanguage,
    symbols: getAutomationMLDocumentSymbols,
    hoverOffset: getAutomationMLHover,
    validate: validateAutomationML,
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of AEROSPACE_CONTROLS_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
