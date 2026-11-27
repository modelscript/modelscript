// SPDX-License-Identifier: AGPL-3.0-or-later

import { asmLanguage, getAsmDiagnostics, getAsmDocumentSymbols } from "@modelscript/asm";
import {
  aspenActionHandlers,
  aspenLanguage,
  getAspenDocumentSymbols,
  getAspenHover,
  validateAspen,
} from "@modelscript/aspen";
import {
  eclipseActionHandlers,
  eclipseLanguage,
  getEclipseDocumentSymbols,
  getEclipseHover,
  validateEclipse,
} from "@modelscript/eclipse";
import {
  energyplusActionHandlers,
  energyplusLanguage,
  getEnergyPlusDocumentSymbols,
  getEnergyPlusHover,
  validateEnergyPlus,
} from "@modelscript/energyplus";
import {
  epanetActionHandlers,
  epanetLanguage,
  getEpanetDocumentSymbols,
  getEpanetHover,
  validateEpanet,
} from "@modelscript/epanet";
import {
  getDiagnostics as getHecHmsDiagnostics,
  getDocumentSymbols as getHecHmsDocumentSymbols,
  hecHmsLanguage,
} from "@modelscript/hec-hms";
import { getHecRasDocumentSymbols, getHecRasHover, hecRasLanguage, validateHecRas } from "@modelscript/hec-ras";
import { getLandgemDocumentSymbols, getLandgemHover, landgemLanguage, validateLandgem } from "@modelscript/landgem";
import { getLpsDocumentSymbols, getLpsHover, lpsActionHandlers, lpsLanguage, validateLps } from "@modelscript/lps";
import { getModflowDocumentSymbols, getModflowHover, modflowLanguage, validateModflow } from "@modelscript/modflow";
import {
  getOlgaCodeLenses,
  getOlgaDocumentSymbols,
  getOlgaHover,
  getOlgaQuickFixes,
  olgaActionHandlers,
  olgaLanguage,
  validateOlga,
} from "@modelscript/olga";
import {
  getRelap5DocumentSymbols,
  getRelap5Hover,
  relap5ActionHandlers,
  relap5Language,
  validateRelap5,
} from "@modelscript/relap5";
import {
  getSwmmDocumentSymbols,
  getSwmmHover,
  swmmActionHandlers,
  swmmLanguage,
  validateSwmm,
} from "@modelscript/swmm";
import { getToughDocumentSymbols, getToughHover, toughLanguage, validateTough } from "@modelscript/tough";
import { getWaterMlDiagnostics, getWaterMlDocumentSymbols, watermlLanguage } from "@modelscript/waterml";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry, type PluginCodeLensContext } from "../LanguageRegistry.js";
import { type DocInput, docText, docUri, registerStandardPlugin } from "../standard-plugin.js";

export const FLUID_PROCESS_NUCLEAR_PLUGIN_IDS: readonly string[] = [
  "olga",
  "lps",
  "aspen",
  "eclipse",
  "epanet",
  "swmm",
  "relap5",
  "energyplus",
  "hec-ras",
  "tough",
  "modflow",
  "landgem",
  "hec-hms",
  "waterml",
  "asm",
];

/**
 * Registers the 15 fluid, process, subsurface, civil water, and nuclear language plugins.
 */
export function registerFluidProcessNuclearPlugins(workspaceManager?: WorkspaceManager): void {
  // 1. Aspen
  registerStandardPlugin({
    id: "aspen",
    name: "Aspen",
    extensions: [".in", ".inp", ".bkp"],
    languageDef: aspenLanguage,
    symbols: getAspenDocumentSymbols,
    hoverPos: getAspenHover,
    validate: validateAspen,
    actionHandlers: aspenActionHandlers,
  });

  // 2. SWMM
  registerStandardPlugin({
    id: "swmm",
    name: "SWMM",
    extensions: [".inp"],
    languageDef: swmmLanguage,
    symbols: getSwmmDocumentSymbols,
    hoverPos: getSwmmHover,
    validate: validateSwmm,
    actionHandlers: swmmActionHandlers,
  });

  // 3. OLGA
  registerStandardPlugin({
    id: "olga",
    name: "OLGA",
    extensions: [".genkey", ".key", ".opi", ".olga", ".pvt", ".tab"],
    languageDef: olgaLanguage,
    symbols: getOlgaDocumentSymbols,
    hoverPos: getOlgaHover,
    validate: validateOlga,
    customHandlers: {
      codeLens: (doc: DocInput, ctx?: PluginCodeLensContext) =>
        getOlgaCodeLenses(
          ctx?.text ?? docText(doc),
          ctx?.uri ?? docUri(doc),
          ctx as Parameters<typeof getOlgaCodeLenses>[2],
        ),
      codeActions: (doc: DocInput) =>
        getOlgaQuickFixes(docText(doc), docUri(doc)).map((fix) => ({
          title: fix.title,
          kind: "quickfix",
          edit: fix.edit,
          ...(fix.isPreferred !== undefined ? { isPreferred: fix.isPreferred } : {}),
        })),
    },
    actionHandlers: olgaActionHandlers,
  });

  // 4. LPS
  registerStandardPlugin({
    id: "lps",
    name: "PipelineStudio",
    extensions: [".lps", ".tgx", ".tlx", ".tgn", ".tln", ".psg", ".psl"],
    languageDef: lpsLanguage,
    symbols: getLpsDocumentSymbols,
    hoverPos: getLpsHover,
    validateWithTree: validateLps,
    actionHandlers: lpsActionHandlers,
  });

  // 5. RELAP5
  registerStandardPlugin({
    id: "relap5",
    name: "RELAP5",
    extensions: [".i", ".inp", ".r5"],
    languageDef: relap5Language,
    symbols: getRelap5DocumentSymbols,
    hoverPos: getRelap5Hover,
    validate: validateRelap5,
    actionHandlers: relap5ActionHandlers,
  });

  // 6. ECLIPSE
  registerStandardPlugin({
    id: "eclipse",
    name: "ECLIPSE",
    extensions: [".data", ".dat", ".inc"],
    languageDef: eclipseLanguage,
    symbols: getEclipseDocumentSymbols,
    hoverPos: getEclipseHover,
    validate: validateEclipse,
    actionHandlers: eclipseActionHandlers,
  });

  // 7. EnergyPlus
  registerStandardPlugin({
    id: "energyplus",
    name: "EnergyPlus",
    extensions: [".idf", ".epjson"],
    languageDef: energyplusLanguage,
    symbols: getEnergyPlusDocumentSymbols,
    hoverOffset: getEnergyPlusHover,
    validate: validateEnergyPlus,
    actionHandlers: energyplusActionHandlers,
  });

  // 8. EPANET
  registerStandardPlugin({
    id: "epanet",
    name: "EPANET",
    extensions: [".inp"],
    languageDef: epanetLanguage,
    symbols: getEpanetDocumentSymbols,
    hoverOffset: getEpanetHover,
    validate: validateEpanet,
    actionHandlers: epanetActionHandlers,
  });

  // 9. HEC-RAS (River Hydraulics & Floodplains)
  registerStandardPlugin({
    id: "hec-ras",
    name: "HEC-RAS",
    extensions: [".g01", ".g02", ".g03", ".rasgeo", ".u01", ".f01", ".prj"],
    languageDef: hecRasLanguage,
    symbols: getHecRasDocumentSymbols,
    hoverPos: getHecRasHover,
    customHandlers: {
      validate: (doc: DocInput) => validateHecRas(docText(doc)),
    },
  });

  // 10. TOUGH (Deep Geothermal Reservoir & Hydrothermal Flows)
  registerStandardPlugin({
    id: "tough",
    name: "TOUGH",
    extensions: [".tough", ".dat", ".tgh"],
    languageDef: toughLanguage,
    symbols: getToughDocumentSymbols,
    hoverPos: getToughHover,
    customHandlers: {
      validate: (doc: DocInput) => validateTough(docText(doc)),
    },
  });

  // 11. MODFLOW (Multi-Layer Groundwater Aquifers)
  registerStandardPlugin({
    id: "modflow",
    name: "MODFLOW",
    extensions: [".dis", ".dis6", ".npf", ".npf6", ".wel", ".wel6", ".riv", ".riv6", ".chd", ".chd6"],
    languageDef: modflowLanguage,
    symbols: getModflowDocumentSymbols,
    hoverPos: getModflowHover,
    customHandlers: {
      validate: (doc: DocInput) => validateModflow(docText(doc)),
    },
  });

  // 12. LandGEM (Landfill Gas & ADM1 Anaerobic Digestion)
  registerStandardPlugin({
    id: "landgem",
    name: "LandGEM",
    extensions: [".landgem", ".lfg", ".biogas"],
    languageDef: landgemLanguage,
    symbols: getLandgemDocumentSymbols,
    hoverPos: getLandgemHover,
    customHandlers: {
      validate: (doc: DocInput) => validateLandgem(docText(doc)),
    },
  });

  // 13. ASM (Activated Sludge Model)
  registerStandardPlugin({
    id: "asm",
    name: "ASM",
    extensions: [".asm", ".bsm", ".wrrf"],
    languageDef: asmLanguage,
    symbols: getAsmDocumentSymbols,
    validate: getAsmDiagnostics,
  });

  // 14. HEC-HMS
  registerStandardPlugin({
    id: "hec-hms",
    name: "HEC-HMS",
    extensions: [".basin", ".hms", ".met", ".control"],
    languageDef: hecHmsLanguage,
    symbols: getHecHmsDocumentSymbols,
    validate: getHecHmsDiagnostics,
  });

  // 15. WaterML
  registerStandardPlugin({
    id: "waterml",
    name: "WaterML",
    extensions: [".waterml", ".wml2", ".xml", ".json"],
    languageDef: watermlLanguage,
    symbols: getWaterMlDocumentSymbols,
    validate: getWaterMlDiagnostics,
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of FLUID_PROCESS_NUCLEAR_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
