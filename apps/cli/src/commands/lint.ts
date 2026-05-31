// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any, prefer-const, no-useless-assignment */

import { UnifiedWorkspace } from "@modelscript/compiler";
import {
  createModelicaQueryEngine,
  createModelicaWorkspaceIndex,
  createSysML2QueryEngine,
  createSysML2WorkspaceIndex,
} from "@modelscript/core";
import modelicaLangFallback from "@modelscript/modelica/language";
import Modelica from "@modelscript/modelica/parser";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Parser from "tree-sitter";
import type { CommandModule } from "yargs";

interface LintArgs {
  path: string;
  paths: string[] | undefined;
}

function findPolyglotFiles(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const stat = fs.statSync(dir);
  if (stat.isFile() && (dir.endsWith(".mo") || dir.endsWith(".sysml"))) {
    fileList.push(dir);
  } else if (stat.isDirectory()) {
    for (const file of fs.readdirSync(dir)) {
      findPolyglotFiles(path.join(dir, file), fileList);
    }
  }
  return fileList;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export const Lint: CommandModule<{}, LintArgs> = {
  command: "lint <path> [paths...]",
  describe: "Lint a Polyglot library using the QueryEngine",
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
    const modelicaItems: { uri: string; text: string }[] = [];
    const sysmlItems: { uri: string; text: string }[] = [];

    const allPaths = [args.path, ...(args.paths ?? [])];
    const files = new Set<string>();

    for (const p of allPaths) {
      const found = findPolyglotFiles(path.resolve(p));
      for (const f of found) files.add(f);
    }

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (file.endsWith(".mo")) {
        modelicaItems.push({ uri: `file://${file}`, text: content });
      } else if (file.endsWith(".sysml")) {
        sysmlItems.push({ uri: `file://${file}`, text: content });
      }
    }

    const hasModelica = modelicaItems.length > 0;
    const hasSysML = sysmlItems.length > 0;

    let mIdx: any = null;
    let sIdx: any = null;

    const astMap = new Map<string, any>();

    if (hasModelica) {
      mIdx = createModelicaWorkspaceIndex();
      const parser = new Parser();
      parser.setLanguage(Modelica);
      for (const item of modelicaItems) {
        const ast = parser.parse(item.text).rootNode as any;
        astMap.set(item.uri, ast);
        mIdx.register(item.uri, () => ast);
      }
      u.registerWorkspace("modelica", mIdx, modelicaLangFallback);
    }

    if (hasSysML) {
      sIdx = createSysML2WorkspaceIndex();
      const WebParserModule = await import("web-tree-sitter");
      const WebParser: any = WebParserModule.default || WebParserModule;
      await WebParser.Parser.init();
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/tree-sitter-sysml2.wasm");
      const SysML2 = await WebParser.Language.load(fs.readFileSync(wasmPath));
      const sysmlParser = new WebParser.Parser();
      sysmlParser.setLanguage(SysML2);
      for (const item of sysmlItems) {
        const tree = sysmlParser.parse(item.text);
        const ast = tree.rootNode as any;
        astMap.set(item.uri, ast);
        sIdx.register(item.uri, () => ast);
      }
      u.registerWorkspace("sysml2", sIdx, sysml2LangFallback as any);
    }

    if (hasSysML && sIdx) {
      await sIdx.toUnifiedAsync();
    }

    const db = u.toUnifiedAsync ? await u.toUnifiedAsync() : u.toUnified();

    // Implement WorkspaceCSTProvider to enable AST-dependent Salsa queries (like equation counting)
    const cstProvider = {
      getText: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const uri = entry.resourceId;
        const modelicaItem = modelicaItems.find((i) => i.uri === uri);
        if (modelicaItem) return modelicaItem.text.slice(startByte, endByte);
        const sysmlItem = sysmlItems.find((i) => i.uri === uri);
        if (sysmlItem) return sysmlItem.text.slice(startByte, endByte);
        return null;
      },
      getNode: (startByte: number, endByte: number, entry?: any) => {
        if (!entry || !entry.resourceId) return null;
        const ast = astMap.get(entry.resourceId);
        if (!ast) return null;
        return ast.descendantForIndex(startByte, endByte);
      },
    };

    const diagnostics: any[] = [];
    let engineM: any = null;
    let engineS: any = null;

    if (hasModelica) {
      engineM = createModelicaQueryEngine(db, cstProvider as any);
      const diagsM = await engineM.runAllLintsAsync();
      diagnostics.push(...diagsM);
    }

    if (hasSysML) {
      engineS = createSysML2QueryEngine(db, cstProvider as any);
      const diagsS = await engineS.runAllLintsAsync();
      diagnostics.push(...diagsS);
    }

    if (diagnostics.length === 0) {
      console.log("No diagnostics found.");
      return;
    }

    for (const d of diagnostics) {
      let entry = null;
      if (engineM) entry = engineM.toQueryDB().symbol(d.symbolId);
      if (!entry && engineS) entry = engineS.toQueryDB().symbol(d.symbolId);

      const resource = entry?.resourceId ? entry.resourceId.replace("file://", "") : "unknown";
      console.log(`[${resource}:${d.startByte}-${d.endByte}] ${d.severity}: [${d.lintName}] ${d.message}`);
    }

    const errors = diagnostics.filter((d: any) => d.severity === "error").length;
    const warnings = diagnostics.filter((d: any) => d.severity !== "error").length;

    if (errors > 0 || warnings > 0) {
      console.log(`\n${errors} error(s), ${warnings} warning(s) found.`);
    }

    if (errors > 0) {
      process.exitCode = 1;
    }
  },
};
