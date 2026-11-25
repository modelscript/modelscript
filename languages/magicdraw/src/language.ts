// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Language Definition & Polyglot TGG Rules.
 *
 * Registers MagicDraw / Cameo (.mdzip, .mdxml, .xmi) OMG UML 2.x / SysML 1.x support,
 * clean-room OMG standard profiles, semantic lints (M9921–M9934), 2D diagram rendering,
 * DAE parametric lowering, and SysML v2 / ReqIF / Modelica projections.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { registerBuiltInMagicDrawLibrarySync } from "./catalog/library-package-adapter.js";
import { magicDrawDiagramConfig } from "./diagram.js";
import { magicDrawIndexing } from "./indexing.js";
import { magicDrawPolyglotConfig } from "./tgg/index.js";

export const magicDrawLanguage = language({
  name: "magicdraw",
  displayName: "MagicDraw / Cameo SysML 1.x (.mdzip)",
  fileExtensions: [".mdzip", ".mdxml", ".xmi"],
  maturity: "beta",
  polyglot: magicDrawPolyglotConfig,
  indexing: magicDrawIndexing,
  diagram: magicDrawDiagramConfig,
  lsp: {
    fileExtensions: [".mdzip", ".mdxml", ".xmi"],
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,
  ui: {
    panels: [
      {
        id: "magicdrawStudio",
        viewType: "modelscript.magicdrawStudio",
        title: "MagicDraw / Cameo Model Studio",
        shortTitle: "MagicDraw",
        selector: ["*.mdzip", "*.mdxml", "*.xmi"],
        priority: "option",
        targets: ["vscode", "ansatz", "artifact"],
        entry: "./src/ui/MagicDrawPanel.tsx",
        artifactViewTypes: ["magicdraw"],
      },
    ],
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 10,
        command: "ansatz:autoLayout",
      },
      {
        id: "magicdrawToSysml2",
        label: "Project MagicDraw Model to SysML v2 (.sysml)",
        shortLabel: "To SysML v2",
        tooltip: "Project MagicDraw / SysML 1.x model to OMG SysML v2",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "primary",
        order: 20,
        actionId: "magicdraw_to_sysml2",
      },
      {
        id: "magicdrawToReqif",
        label: "Export Requirements to OMG ReqIF 1.2 (.reqif)",
        shortLabel: "To ReqIF",
        tooltip: "Export SysML 1.x requirements to OMG ReqIF 1.2",
        icon: "checklist",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 30,
        actionId: "magicdraw_to_reqif",
      },
      {
        id: "magicdrawToModelica",
        label: "Project Parametrics to Modelica (.mo)",
        shortLabel: "To Modelica",
        tooltip: "Project SysML 1.x blocks and parametric constraints to Modelica",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 40,
        actionId: "magicdraw_to_modelica",
      },
      {
        id: "magicdrawToDae",
        label: "Lower Parametrics to DAE Arena",
        shortLabel: "Lower DAE",
        tooltip: "Lower SysML 1.x parametric equations into DAEBuilder",
        icon: "stack",
        views: ["code", "diagram"],
        targets: ["ansatz"],
        placement: "overflow",
        order: 50,
        actionId: "magicdraw_to_dae",
      },
    ],
  },
});

export default magicDrawLanguage;

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInMagicDrawLibrarySync();
