// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  antimonyLanguage,
  getAntimonyDocumentSymbols,
  getAntimonyHover,
  validateAntimony,
} from "@modelscript/antimony";
import { bnglLanguage, getBnglDocumentSymbols, getBnglHover, validateBngl } from "@modelscript/bngl";
import {
  canteraLanguage,
  extractCanteraTheoryConstraints,
  getCanteraDocumentSymbols,
  getCanteraHover,
  validateCantera,
} from "@modelscript/cantera";
import { cellmlLanguage, getCellmlDocumentSymbols, getCellmlHover, validateCellml } from "@modelscript/cellml";
import { dicomRtLanguage, getDicomRtDocumentSymbols, getDicomRtHover, validateDicomRt } from "@modelscript/dicom-rt";
import { febioLanguage, getFebioDocumentSymbols, getFebioHover, validateFebio } from "@modelscript/febio";
import { genbankLanguage, getGenbankDocumentSymbols, getGenbankHover, validateGenbank } from "@modelscript/genbank";
import { getGpromsDocumentSymbols, getGpromsHover, gpromsLanguage, validateGproms } from "@modelscript/gproms";
import { getIgtlDocumentSymbols, getIgtlHover, igtlLanguage, validateIgtl } from "@modelscript/igtl";
import { getMlxtranDocumentSymbols, getMlxtranHover, mlxtranLanguage, validateMlxtran } from "@modelscript/mlxtran";
import { getNiftiDocumentSymbols, getNiftiHover, niftiLanguage, validateNifti } from "@modelscript/nifti";
import {
  getNmodlDocumentSymbols,
  getNmodlHover,
  nmodlLanguage,
  provideNmodlCompletions,
  validateNmodl,
} from "@modelscript/nmodl";
import { getNmtranDocumentSymbols, getNmtranHover, nmtranLanguage, validateNmtran } from "@modelscript/nmtran";
import { getOpenSimDocumentSymbols, getOpenSimHover, openSimLanguage, validateOpenSim } from "@modelscript/opensim";
import { getPdbDocumentSymbols, getPdbHover, pdbLanguage, validatePdb } from "@modelscript/pdb";
import { getPhreeqcDocumentSymbols, getPhreeqcHover, phreeqcLanguage, validatePhreeqc } from "@modelscript/phreeqc";
import {
  getSbmlDocumentSymbols,
  getSbmlHover,
  sbmlActionHandlers,
  sbmlLanguage,
  validateSbml,
} from "@modelscript/sbml";
import { getSbolDocumentSymbols, getSbolHover, sbolLanguage, validateSbol } from "@modelscript/sbol";
import { getSedmlDocumentSymbols, getSedmlHover, sedmlLanguage, validateSedml } from "@modelscript/sedml";
import { getSmilesDocumentSymbols, getSmilesHover, smilesLanguage, validateSmiles } from "@modelscript/smiles";
import { getTopasDocumentSymbols, getTopasHover, topasLanguage, validateTopas } from "@modelscript/topas";
import type { WorkspaceManager } from "../../services/workspace-manager.js";
import { globalLanguageRegistry } from "../LanguageRegistry.js";
import { offsetToPos, registerStandardPlugin, toCompletionItems, toHover } from "../standard-plugin.js";

export const BIO_CHEM_MEDICAL_PLUGIN_IDS: readonly string[] = [
  "sbml",
  "antimony",
  "bngl",
  "cantera",
  "cellml",
  "dicom-rt",
  "febio",
  "genbank",
  "gproms",
  "igtl",
  "nifti",
  "nmtran",
  "opensim",
  "pdb",
  "phreeqc",
  "sbol",
  "sedml",
  "smiles",
  "topas",
  "mlxtran",
  "nmodl",
];

/**
 * Registers the 21 chemistry, systems/synthetic biology, pharmacology, radiology, and medical language plugins.
 */
export function registerBioChemMedicalPlugins(workspaceManager?: WorkspaceManager): void {
  // 1. SBML
  registerStandardPlugin({
    id: "sbml",
    name: "SBML",
    extensions: [".sbml", ".xml"],
    languageDef: sbmlLanguage,
    symbols: getSbmlDocumentSymbols,
    hoverPos: getSbmlHover,
    validateWithTree: validateSbml,
    actionHandlers: sbmlActionHandlers,
  });

  // 2. Antimony
  registerStandardPlugin({
    id: "antimony",
    name: "Antimony",
    extensions: [".ant"],
    languageDef: antimonyLanguage,
    symbols: getAntimonyDocumentSymbols,
    validate: validateAntimony,
    customHandlers: {
      hover: (offset: number, text: string) => getAntimonyHover(text, offsetToPos(text, offset)),
    },
  });

  // 3. BNGL
  registerStandardPlugin({
    id: "bngl",
    name: "BNGL",
    extensions: [".bngl"],
    languageDef: bnglLanguage,
    symbols: getBnglDocumentSymbols,
    validate: validateBngl,
    customHandlers: {
      hover: (offset: number, text: string) => getBnglHover(text, offsetToPos(text, offset)),
    },
  });

  // 4. Cantera
  registerStandardPlugin({
    id: "cantera",
    name: "Cantera",
    extensions: [".cti", ".ctml"],
    languageDef: canteraLanguage,
    extractTheoryConstraints: extractCanteraTheoryConstraints,
    symbols: getCanteraDocumentSymbols,
    validate: validateCantera,
    customHandlers: {
      hover: (offset: number, text: string) => getCanteraHover(text, offsetToPos(text, offset)),
    },
  });

  // 5. CellML
  registerStandardPlugin({
    id: "cellml",
    name: "CellML",
    extensions: [".cellml"],
    languageDef: cellmlLanguage,
    symbols: getCellmlDocumentSymbols,
    hoverOffset: getCellmlHover,
    validateWithTree: validateCellml,
  });

  // 6. DICOM-RT
  registerStandardPlugin({
    id: "dicom-rt",
    name: "DICOM-RT",
    extensions: [".dcm.json", ".dicom-rt", ".rtplan.json", ".rtdose.json", ".rtstruct.json"],
    languageDef: dicomRtLanguage,
    symbols: getDicomRtDocumentSymbols,
    hoverOffset: getDicomRtHover,
    validateWithTree: validateDicomRt,
  });

  // 7. FEBio
  registerStandardPlugin({
    id: "febio",
    name: "FEBio",
    extensions: [".feb"],
    languageDef: febioLanguage,
    symbols: getFebioDocumentSymbols,
    hoverOffset: getFebioHover,
    validateWithTree: validateFebio,
  });

  // 8. GenBank
  registerStandardPlugin({
    id: "genbank",
    name: "GenBank",
    extensions: [".gb", ".gbk", ".genbank"],
    languageDef: genbankLanguage,
    symbols: getGenbankDocumentSymbols,
    validate: validateGenbank,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getGenbankHover(text, offsetToPos(text, offset))),
    },
  });

  // 9. gPROMS
  registerStandardPlugin({
    id: "gproms",
    name: "gPROMS",
    extensions: [".gPROMS", ".gproms"],
    languageDef: gpromsLanguage,
    symbols: getGpromsDocumentSymbols,
    validate: validateGproms,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getGpromsHover(text, offsetToPos(text, offset))),
    },
  });

  // 10. OpenIGTLink (IGTL)
  registerStandardPlugin({
    id: "igtl",
    name: "OpenIGTLink",
    extensions: [".igtl", ".igtl.json"],
    languageDef: igtlLanguage,
    symbols: getIgtlDocumentSymbols,
    hoverOffset: getIgtlHover,
    validateWithTree: validateIgtl,
  });

  // 11. NIfTI
  registerStandardPlugin({
    id: "nifti",
    name: "NIfTI",
    extensions: [".nii", ".nii.json"],
    languageDef: niftiLanguage,
    symbols: getNiftiDocumentSymbols,
    hoverOffset: getNiftiHover,
    validate: validateNifti,
  });

  // 12. NM-TRAN
  registerStandardPlugin({
    id: "nmtran",
    name: "NM-TRAN",
    extensions: [".ctl", ".nmtran"],
    languageDef: nmtranLanguage,
    symbols: getNmtranDocumentSymbols,
    validate: validateNmtran,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getNmtranHover(text, offsetToPos(text, offset))),
    },
  });

  // 13. OpenSim
  registerStandardPlugin({
    id: "opensim",
    name: "OpenSim",
    extensions: [".osim"],
    languageDef: openSimLanguage,
    symbols: getOpenSimDocumentSymbols,
    hoverOffset: getOpenSimHover,
    validateWithTree: validateOpenSim,
  });

  // 14. PDB
  registerStandardPlugin({
    id: "pdb",
    name: "PDB",
    extensions: [".pdb", ".ent"],
    languageDef: pdbLanguage,
    symbols: getPdbDocumentSymbols,
    validate: validatePdb,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getPdbHover(text, offsetToPos(text, offset))),
    },
  });

  // 15. PHREEQC
  registerStandardPlugin({
    id: "phreeqc",
    name: "PHREEQC",
    extensions: [".pqi", ".phreeqc"],
    languageDef: phreeqcLanguage,
    symbols: getPhreeqcDocumentSymbols,
    validate: validatePhreeqc,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getPhreeqcHover(text, offsetToPos(text, offset))),
    },
  });

  // 16. SBOL
  registerStandardPlugin({
    id: "sbol",
    name: "SBOL",
    extensions: [".sbol", ".sbol.xml"],
    languageDef: sbolLanguage,
    symbols: getSbolDocumentSymbols,
    validateWithTree: validateSbol,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getSbolHover(text, offsetToPos(text, offset))),
    },
  });

  // 17. SED-ML
  registerStandardPlugin({
    id: "sedml",
    name: "SED-ML",
    extensions: [".sedml"],
    languageDef: sedmlLanguage,
    symbols: getSedmlDocumentSymbols,
    validateWithTree: validateSedml,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getSedmlHover(text, offsetToPos(text, offset))),
    },
  });

  // 18. SMILES
  registerStandardPlugin({
    id: "smiles",
    name: "SMILES",
    extensions: [".smi", ".smiles"],
    languageDef: smilesLanguage,
    symbols: getSmilesDocumentSymbols,
    validate: validateSmiles,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getSmilesHover(text, offsetToPos(text, offset))),
    },
  });

  // 19. TOPAS
  registerStandardPlugin({
    id: "topas",
    name: "TOPAS",
    extensions: [".topas", ".tps"],
    languageDef: topasLanguage,
    symbols: getTopasDocumentSymbols,
    hoverOffset: getTopasHover,
    validate: validateTopas,
  });

  // 20. Monolix MLXTRAN
  registerStandardPlugin({
    id: "mlxtran",
    name: "MLXTRAN",
    extensions: [".mlxtran"],
    languageDef: mlxtranLanguage,
    symbols: getMlxtranDocumentSymbols,
    validate: validateMlxtran,
    customHandlers: {
      hover: (offset: number, text: string) => toHover(getMlxtranHover(text, offsetToPos(text, offset))),
    },
  });

  // 21. NMODL
  registerStandardPlugin({
    id: "nmodl",
    name: "NMODL",
    extensions: [".nmodl", ".mod"],
    languageDef: nmodlLanguage,
    symbols: getNmodlDocumentSymbols,
    hoverPos: getNmodlHover,
    validate: validateNmodl,
    customHandlers: {
      complete: (offset: number, text: string) =>
        toCompletionItems(provideNmodlCompletions(text, offsetToPos(text, offset))),
    },
  });

  if (
    workspaceManager?.unifiedWorkspace &&
    typeof workspaceManager.unifiedWorkspace.registerLanguageDef === "function"
  ) {
    for (const id of BIO_CHEM_MEDICAL_PLUGIN_IDS) {
      const plugin = globalLanguageRegistry.getPluginById(id);
      if (plugin?.languageDef) {
        workspaceManager.unifiedWorkspace.registerLanguageDef(plugin.id, plugin.languageDef);
      }
    }
  }
}
