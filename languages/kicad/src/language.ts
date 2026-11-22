// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — Language Definition & Registration.
 */

import { language } from "@modelscript/dsl";
import { kicadGrammar } from "./grammar/kicad-grammar.js";
import { canIndexKiCadFile, indexKiCadFile } from "./indexing.js";

export const kicadLanguage = language({
  name: "kicad",
  fileExtensions: [".kicad_pcb", ".kicad_sch", ".kicad_sym", ".kicad_mod"],
  maturity: "beta",
  indexing: {
    indexFile: indexKiCadFile,
    canIndex: canIndexKiCadFile,
  },
  lsp: {
    fileExtensions: [".kicad_pcb", ".kicad_sch", ".kicad_sym", ".kicad_mod"],
    folding: ["SExpr"],
    outline: ["SExpr"],
  },
  rules: kicadGrammar.rules,
  ui: {
    toolbarButtons: [
      {
        id: "kicadRunDrc",
        label: "Run PCB DRC / ERC",
        shortLabel: "DRC/ERC",
        tooltip: "Run Design Rule Checks on .kicad_pcb or Electrical Rules Checks on .kicad_sch",
        icon: "shield-check",
        views: ["diagram", "code"],
        targets: ["morsel", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "kicad_run_drc",
      },
      {
        id: "kicadParasitics",
        label: "Extract Trace RLGC & Z0",
        shortLabel: "Parasitics",
        tooltip: "Compute microstrip/stripline impedance, lumped RLGC, and IPC-2221 ampacity",
        icon: "pulse",
        views: ["diagram", "code"],
        targets: ["morsel", "vscode"],
        placement: "primary",
        order: 20,
        actionId: "kicad_extract_parasitics",
      },
      {
        id: "kicadExportIpc2581",
        label: "Export IPC-2581C / IDX",
        shortLabel: "IPC-2581",
        tooltip: "Export board to IPC-2581C manufacturing XML or IDX v4.0 ECAD-MCAD exchange",
        icon: "export",
        views: ["*"],
        targets: ["morsel", "vscode"],
        placement: "overflow",
        order: 30,
        actionId: "kicad_export_ipc2581",
      },
    ],
  },
});
