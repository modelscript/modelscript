// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript SSP Language Definition.
 *
 * Provides declarative grammar, container extraction lambda, and
 * polyglot cross-language projections for SSP archives and SSD models.
 */

import { language, tggComplement, tggDefaultVal, tggEq, tggRule } from "@modelscript/dsl";
import { sspToModelicaBlock } from "./projection.js";
import { parseSsd } from "./ssd-parser.js";

export const sspLanguage = language({
  name: "ssp",
  fileExtensions: [".ssp", ".ssd"],
  lsp: {
    fileExtensions: [".ssp", ".ssd"],
    icons: {
      light: "./assets/ssp/icon-light.png",
      dark: "./assets/ssp/icon-dark.png",
    },
  },
  rules: {
    Root: () => "ssp",
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

  container: {
    extensions: [".ssp"],
    extract: (data, { zip }) => {
      const ssdContent = zip.readText(data, "SystemStructure.ssd");
      if (!ssdContent) return null;

      const system = parseSsd(ssdContent);

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
          action: entry.name.endsWith(".fmu")
            ? ("extract_nested" as const)
            : entry.name.endsWith(".ssd") || entry.name.endsWith(".ssv")
              ? ("parse_as_language" as const)
              : ("mount_vfs" as const),
          targetLanguage: entry.name.endsWith(".ssd") ? "ssp" : entry.name.endsWith(".ssv") ? "ssv" : undefined,
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

  polyglot: {
    languages: ["modelica", "sysml2"],
    typeMaps: {
      sspToModelica: {
        Real: "Real",
        Integer: "Integer",
        Boolean: "Boolean",
        String: "String",
        Enumeration: "Integer",
      },
    },
    rules: [
      // SSP <-> Modelica
      tggRule({
        name: "SspSystemToModelicaModel",
        sourceLang: "ssp",
        targetLang: "modelica",
        source: ($, v) => $.System({ name: v("sysName") }),
        target: ($, v) => $.ClassDefinition({ name: v("sysName"), classKind: "model" }),
        where: (v) => [
          tggEq(v("sysName"), v("sysName")),
          tggDefaultVal(v("isAbstract"), false),
          tggComplement(["version", "description"]),
        ],
      }),
      tggRule({
        name: "SspComponentToModelicaComponent",
        sourceLang: "ssp",
        targetLang: "modelica",
        source: ($, v) => $.Component({ name: v("compName"), source: v("sourceFile") }),
        target: ($, v) => $.ComponentClause({ name: v("compName"), typeSpecifier: v("sourceFile") }),
        where: (v) => [
          tggEq(v("compName"), v("compName")),
          tggEq(v("sourceFile"), v("sourceFile")),
          tggComplement(["type", "connectors"]),
        ],
      }),
      tggRule({
        name: "SspConnectorToModelicaConnector",
        sourceLang: "ssp",
        targetLang: "modelica",
        source: ($, v) => $.Connector({ name: v("connName"), type: v("typeName") }),
        target: ($, v) => $.ComponentClause({ name: v("connName"), typeSpecifier: v("typeName") }),
        where: (v) => [
          tggEq(v("connName"), v("connName")),
          tggEq(v("typeName"), v("typeName")),
          tggComplement(["kind", "unit"]),
        ],
      }),
      tggRule({
        name: "SspConnectionToModelicaConnect",
        sourceLang: "ssp",
        targetLang: "modelica",
        source: ($, v) => $.Connection({ startElement: v("fromEl"), endElement: v("toEl") }),
        target: ($, v) => $.ConnectClause({ connector1: v("fromEl"), connector2: v("toEl") }),
        where: (v) => [
          tggEq(v("fromEl"), v("fromEl")),
          tggEq(v("toEl"), v("toEl")),
          tggComplement(["startConnector", "endConnector"]),
        ],
      }),

      // SSP <-> SysML v2
      tggRule({
        name: "SspSystemToSysmlPackage",
        sourceLang: "ssp",
        targetLang: "sysml2",
        source: ($, v) => $.System({ name: v("sysName") }),
        target: ($, v) => $.PackageDefinition({ declaredName: v("sysName") }),
        where: (v) => [tggEq(v("sysName"), v("sysName")), tggComplement(["version", "description"])],
      }),
      tggRule({
        name: "SspComponentToSysmlPart",
        sourceLang: "ssp",
        targetLang: "sysml2",
        source: ($, v) => $.Component({ name: v("compName"), source: v("sourceFile") }),
        target: ($, v) => $.PartUsage({ declaredName: v("compName"), declaredType: v("sourceFile") }),
        where: (v) => [
          tggEq(v("compName"), v("compName")),
          tggEq(v("sourceFile"), v("sourceFile")),
          tggComplement(["type", "connectors"]),
        ],
      }),
      tggRule({
        name: "SspConnectorToSysmlPort",
        sourceLang: "ssp",
        targetLang: "sysml2",
        source: ($, v) => $.Connector({ name: v("connName"), type: v("typeName") }),
        target: ($, v) => $.PortUsage({ declaredName: v("connName"), declaredType: v("typeName") }),
        where: (v) => [
          tggEq(v("connName"), v("connName")),
          tggEq(v("typeName"), v("typeName")),
          tggComplement(["kind", "unit"]),
        ],
      }),
      tggRule({
        name: "SspConnectionToSysmlConnection",
        sourceLang: "ssp",
        targetLang: "sysml2",
        source: ($, v) => $.Connection({ startElement: v("fromEl"), endElement: v("toEl") }),
        target: ($, v) => $.ConnectionUsage({ declaredName: v("fromEl") }),
        where: (v) => [
          tggEq(v("fromEl"), v("fromEl")),
          tggComplement(["startConnector", "endElement", "endConnector"]),
        ],
      }),
    ],
  },
});

export default sspLanguage;
