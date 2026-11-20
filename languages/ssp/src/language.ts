// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript SSP Language Definition.
 *
 * Provides declarative grammar, container extraction lambda, and
 * polyglot cross-language projections for SSP archives and SSD models.
 */

import { language, xmlRules } from "@modelscript/dsl";
import { sspToModelicaBlock } from "./projection.js";
import { parseSsd, parseSsv } from "./ssd-parser.js";
import { sspTabularConfig } from "./tabular.js";
import { sspPolyglotConfig } from "./tgg/index.js";
import type { SspSystem } from "./types.js";

/**
 * ModelScript SSP (System Structure and Parameterization) language specification.
 *
 * Registers `.ssp`, `.ssd`, and `.ssv` file extensions, ZIP archive extraction
 * for `.ssp` containers (with nested `.fmu` extraction), IDE co-simulation actions,
 * and Triple Graph Grammar (TGG) rules projecting SSP systems to Modelica and SysML v2.
 */
export const sspLanguage = language({
  name: "ssp",
  fileExtensions: [".ssp", ".ssd", ".ssv", ".ssm", ".ssb"],
  maturity: "stable",
  lsp: {
    fileExtensions: [".ssp", ".ssd", ".ssv", ".ssm", ".ssb"],
    icons: {
      light: "./assets/ssp/icon-light.png",
      dark: "./assets/ssp/icon-dark.png",
    },
  },
  extras: ($) => {
    const comment = $["COMMENT"];
    const pi = $["PROCESSING_INSTRUCTION"];
    return comment && pi ? [/[ \t\r\n]+/, comment, pi] : [/[ \t\r\n]+/];
  },
  rules: xmlRules,

  // IDE and AI agent actions for inspecting SSD diagrams, running multi-FMU co-simulation, and Modelica projection
  ui: {
    toolbarButtons: [
      {
        id: "autoLayout",
        label: "Auto-Layout Diagram",
        shortLabel: "Layout",
        tooltip: "Re-run automatic schematic layout on the current diagram",
        icon: "flowchart",
        views: ["diagram"],
        targets: ["morsel"],
        placement: "primary",
        order: 10,
        command: "morsel:autoLayout",
      },
      {
        id: "openSspEditor",
        label: "Inspect System Structure (.ssd)",
        shortLabel: "Inspect System",
        tooltip: "Inspect System Structure (.ssd)",
        icon: "tools",
        views: ["diagram", "inspector"],
        targets: ["morsel"],
        placement: "primary",
        order: 20,
        actionId: "open_ssp_editor",
      },
      {
        id: "launchCosimulation",
        label: "Launch Multi-FMU Co-Simulation Master",
        shortLabel: "Launch Multi-FMU",
        tooltip: "Launch Multi-FMU Co-Simulation Master",
        icon: "play",
        views: ["diagram", "simulation"],
        targets: ["morsel"],
        placement: "overflow",
        order: 30,
        actionId: "launch_cosimulation",
      },
      {
        id: "projectToModelica",
        label: "Project System to Modelica Model",
        shortLabel: "Project System",
        tooltip: "Project System to Modelica Model",
        icon: "export",
        views: ["code", "diagram"],
        targets: ["morsel"],
        placement: "overflow",
        order: 40,
        actionId: "project_to_modelica",
      },
    ],
  },
  actions: [
    {
      id: "open_ssp_editor",
      title: "Inspect System Structure (.ssd)",
      description: "Opens the visual SystemStructure.ssd diagram showing FMU component blocks and connections.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(symbol-structure)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "ssp_open_editor",
          displayName: "Inspect SSP System Structure",
          modelDescription: "Inspects SystemStructure.ssd FMU components and connections.",
        },
      },
    },
    {
      id: "launch_cosimulation",
      title: "Launch Multi-FMU Co-Simulation Master",
      description: "Launches the distributed co-simulation master orchestrating multiple FMUs.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@1",
        },
        editorContextMenu: {
          group: "1_run@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "ssp_launch_cosimulation",
          displayName: "Launch Multi-FMU Co-Simulation",
          modelDescription: "Launches distributed Co-Simulation master orchestrating multiple FMUs.",
        },
      },
    },
    {
      id: "project_to_modelica",
      title: "Project System to Modelica Model",
      description: "Translates the SSP system network of FMUs and connections into a native Modelica block model.",
      category: "transform",
      ui: {
        editorContextMenu: {
          group: "2_transform@1",
        },
        languageModelTool: {
          name: "ssp_to_modelica",
          displayName: "Project SSP to Modelica",
          modelDescription: "Translates SSP system structure to a native Modelica model.",
        },
      },
    },
  ],

  // ZIP container handler for `.ssp` archives: parses SystemStructure.ssd and mounts or extracts nested FMUs
  container: {
    extensions: [".ssp"],
    extract: (data, { zip }) => {
      const ssdContent = zip.readText(data, "SystemStructure.ssd");
      if (!ssdContent) return null;

      const system = parseSsd(ssdContent);
      const resolveExternalSsv = (sys: SspSystem) => {
        for (const pb of sys.parameterBindings ?? []) {
          if (pb.source && (!pb.values || pb.values.length === 0)) {
            const cleanSource = pb.source.replace(/^\.\//, "");
            const ssvText = zip.readText(data, cleanSource) ?? zip.readText(data, pb.source);
            if (ssvText) {
              pb.values = parseSsv(ssvText);
            }
          }
        }
        for (const sub of sys.systems ?? sys.elements?.systems ?? []) {
          resolveExternalSsv(sub);
        }
      };
      resolveExternalSsv(system);

      return {
        manifest: {
          path: "SystemStructure.ssd",
          content: ssdContent,
          language: "ssp",
        },
        entries: zip.entries(data).map((entry) => ({
          path: entry.name,
          size: entry.size,
          read: () => zip.read(data, entry.name),
          readText: () => zip.readText(data, entry.name),
          // Recursively extract embedded `.fmu` archives; parse `.ssd`/`.ssv`/`.ssm`/`.ssb` descriptors; mount other resources in VFS
          action: entry.name.endsWith(".fmu")
            ? ("extract_nested" as const)
            : entry.name.endsWith(".ssd") ||
                entry.name.endsWith(".ssv") ||
                entry.name.endsWith(".ssm") ||
                entry.name.endsWith(".ssb")
              ? ("parse_as_language" as const)
              : ("mount_vfs" as const),
          targetLanguage: entry.name.endsWith(".ssd")
            ? "ssp"
            : entry.name.endsWith(".ssv")
              ? "ssv"
              : entry.name.endsWith(".ssm")
                ? "ssm"
                : entry.name.endsWith(".ssb")
                  ? "ssb"
                  : undefined,
        })),
        metadata: {
          systemName: system.name,
          version: system.version,
          componentCount: system.components.length,
          connectionCount: system.connections.length,
        },
        project: (targetLanguage: string) => {
          if (targetLanguage.toLowerCase() === "modelica") {
            return sspToModelicaBlock(system);
          }
          return null;
        },
      };
    },
  },

  // Bidirectional TGG rules mapping SSP systems, components, connectors, and connections to Modelica and SysML v2
  polyglot: sspPolyglotConfig,
  tabular: sspTabularConfig,
});

export default sspLanguage;
