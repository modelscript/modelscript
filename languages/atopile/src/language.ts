// SPDX-License-Identifier: AGPL-3.0-or-later

import { language } from "@modelscript/dsl";
import { atopileGrammar } from "./grammar/atopile-grammar.js";
import { canIndexAtopileFile, indexAtopileFile } from "./indexing.js";

export const atopileLanguage = language({
  name: "atopile",
  fileExtensions: [".ato"],
  maturity: "beta",
  indexing: {
    indexFile: indexAtopileFile,
    canIndex: canIndexAtopileFile,
  },
  lsp: {
    fileExtensions: [".ato"],
    folding: ["BlockDef"],
    outline: ["BlockDef", "ImportStmt", "InstanceStmt"],
  },
  rules: atopileGrammar.rules,
  ui: {
    stencils: [
      { label: "Resistor", snippet: "r1 = new Resistor\nr1.resistance = 10kohm +/- 1%\n" },
      { label: "Capacitor", snippet: "c1 = new Capacitor\nc1.capacitance = 100nF +/- 5%\n" },
      { label: "Assert Bounds", snippet: "assert r1.resistance within 9.8kohm to 10.2kohm\n" },
    ],
    toolbarButtons: [
      {
        id: "atopileRunUq",
        label: "Run Tolerance UQ",
        shortLabel: "UQ",
        tooltip: "Compute worst-case corners and Monte Carlo uncertainty over +/- % tolerances",
        icon: "graph",
        views: ["diagram", "code"],
        targets: ["ansatz", "vscode"],
        placement: "primary",
        order: 10,
        actionId: "atopile_run_uq",
      },
      {
        id: "atopileExportIpc2581",
        label: "Export Netlist / IPC-2581C",
        shortLabel: "IPC-2581",
        tooltip: "Elaborate module hierarchy and export IPC-2581C manufacturing package",
        icon: "export",
        views: ["*"],
        targets: ["ansatz", "vscode"],
        placement: "overflow",
        order: 20,
        actionId: "atopile_export_ipc2581",
      },
    ],
  },
});
