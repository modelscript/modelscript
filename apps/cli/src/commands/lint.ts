// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/compiler";
import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/core";
import modelicaLangFallback from "@modelscript/modelica/language";
import Modelica from "@modelscript/modelica/parser";
import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";

interface LintArgs {
  path: string;
  paths: string[] | undefined;
}

function findModelicaFiles(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const stat = fs.statSync(dir);
  if (stat.isFile() && dir.endsWith(".mo")) {
    fileList.push(dir);
  } else if (stat.isDirectory()) {
    for (const file of fs.readdirSync(dir)) {
      findModelicaFiles(path.join(dir, file), fileList);
    }
  }
  return fileList;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Lint: CommandModule<{}, LintArgs> = {
  command: "lint <path> [paths...]",
  describe: "Lint a Modelica library using the QueryEngine",
  builder: (yargs) => {
    return yargs
      .positional("path", {
        demandOption: true,
        description: "path of library or module to lint",
        type: "string",
      })
      .positional("paths", {
        array: true,
        demandOption: false,
        description: "additional paths of libraries and modules to load",
        type: "string",
      });
  },
  handler: async (args) => {
    const u = new UnifiedWorkspace();
    const items: { uri: string; text: string }[] = [];

    const allPaths = [args.path, ...(args.paths ?? [])];
    const files = new Set<string>();

    for (const p of allPaths) {
      const found = findModelicaFiles(path.resolve(p));
      for (const f of found) files.add(f);
    }

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      items.push({ uri: `file://${file}`, text: content });
    }

    const mIdx = createModelicaWorkspaceIndex();
    const parser = new Parser();
    parser.setLanguage(Modelica);
    for (const item of items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mIdx.register(item.uri, () => parser.parse(item.text).rootNode as any);
    }
    u.registerWorkspace("modelica", mIdx, modelicaLangFallback);

    const db = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();
    const engine = createModelicaQueryEngine(db);

    const diagnostics = await engine.runAllLintsAsync();

    if (diagnostics.length === 0) {
      console.log("No diagnostics found.");
      return;
    }

    for (const d of diagnostics) {
      const entry = engine.toQueryDB().symbol(d.symbolId);
      const resource = entry?.resourceId ? entry.resourceId.replace("file://", "") : "unknown";
      console.log(`[${resource}:${d.startByte}-${d.endByte}] ${d.severity}: [${d.lintName}] ${d.message}`);
    }

    const errors = diagnostics.filter((d) => d.severity === "error").length;
    const warnings = diagnostics.filter((d) => d.severity !== "error").length;

    if (errors > 0 || warnings > 0) {
      console.log(`\n${errors} error(s), ${warnings} warning(s) found.`);
    }
  },
};
