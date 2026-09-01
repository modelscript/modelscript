// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript SSP Language Definition.
 *
 * Provides declarative grammar, container extraction lambda, and
 * polyglot cross-language projections for SSP archives and SSD models.
 */

import { language } from "@modelscript/language/dsl";
import { sspToModelicaBlock } from "./projection.js";
import { parseSsd } from "./ssd-parser.js";

export const sspLanguage = language({
  name: "ssp",
  rules: {
    Root: () => "ssp",
  },

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
  },
});

export default sspLanguage;
