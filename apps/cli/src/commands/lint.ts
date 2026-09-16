// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable no-useless-assignment */

import { createModelicaQueryEngine, createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import { UnifiedWorkspace } from "@modelscript/runtime";
import { createSysML2QueryEngine } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandModule } from "yargs";

import { LanguageResolver } from "../util/language-registry.js";

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

interface LintArgs {
  path: string;
  paths: string[] | undefined;
  language?: string;
}

function findPolyglotFiles(dir: string, fileList: string[] = [], recognizedExts: Set<string>) {
  if (!fs.existsSync(dir)) return fileList;
  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    const ext = path.extname(dir).toLowerCase();
    if (recognizedExts.has(ext)) {
      fileList.push(dir);
    }
  } else if (stat.isDirectory()) {
    for (const file of fs.readdirSync(dir)) {
      if (["node_modules", "dist", ".git", "build"].includes(file)) continue;
      findPolyglotFiles(path.join(dir, file), fileList, recognizedExts);
    }
  }
  return fileList;
}

export const Lint: CommandModule<any, any> = {
  command: "lint <path> [paths...]",
  describe: "Lint polyglot libraries using QueryEngine and DSL parsers",
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
      })
      .option("language", {
        alias: "l",
        description: "Filter to specific language (e.g. modelica, sysml2, scad)",
        type: "string",
      });
  },
  handler: async (args) => {
    const u = new UnifiedWorkspace();
    const modelicaItems: { uri: string; text: string }[] = [];
    const sysmlItems: { uri: string; text: string }[] = [];
    const genericItems: { uri: string; text: string; langName: string }[] = [];

    const allPaths = [args.path, ...(args.paths ?? [])];
    const files = new Set<string>();

    let recognizedExts: Set<string>;
    if (args.language) {
      const resolved = await LanguageResolver.resolve(undefined, args.language);
      recognizedExts = new Set(resolved.manifest.extensions.map((e) => e.toLowerCase()));
    } else {
      recognizedExts = new Set(LanguageResolver.getAllExtensions().map((e) => e.toLowerCase()));
    }

    for (const p of allPaths) {
      const found = findPolyglotFiles(path.resolve(p), [], recognizedExts);
      for (const f of found) files.add(f);
    }

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      if (file.endsWith(".mo") || file.endsWith(".mos") || file.endsWith(".msim")) {
        modelicaItems.push({ uri: `file://${file}`, text: content });
      } else if (file.endsWith(".sysml")) {
        sysmlItems.push({ uri: `file://${file}`, text: content });
      } else {
        try {
          const lang = await LanguageResolver.resolve(file);
          genericItems.push({ uri: `file://${file}`, text: content, langName: lang.manifest.name });
        } catch {}
      }
    }

    const hasModelica = modelicaItems.length > 0;
    const hasSysML = sysmlItems.length > 0;

    let mIdx: any = null;
    let sIdx: any = null;

    const astMap = new Map<string, any>();

    if (hasModelica) {
      mIdx = createModelicaWorkspaceIndex();
      const { parser } = await createWasmParser(modelicaWasmPath);
      for (const item of modelicaItems) {
        const ast = parser.parse(item.text)?.rootNode as any;
        astMap.set(item.uri, ast);
        mIdx.register(item.uri, () => ast);
      }
      u.registerWorkspace("modelica", mIdx, modelicaLangFallback);
    }

    if (hasSysML) {
      const { createWasmParser } = await import("@modelscript/dsl");
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const wasmPath = path.resolve(__dirname, "../../../../languages/sysml2/dist/parser.wasm");
      const sysmlResult = await createWasmParser(wasmPath);
      const sysmlParser = sysmlResult.parser;
      for (const item of sysmlItems) {
        const tree = sysmlParser.parse(item.text);
        if (tree) {
          const ast = tree.rootNode as any;
          astMap.set(item.uri, ast);
          sIdx.register(item.uri, () => ast);
        }
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

    for (const item of genericItems) {
      try {
        const lang = await LanguageResolver.resolve(item.uri);
        const { parser } = await lang.loadParser();
        const tree = parser.parse(item.text);
        if (tree?.rootNode?.hasError && tree.rootNode.hasError()) {
          const filePath = item.uri.replace("file://", "");
          diagnostics.push({
            severity: "error",
            lintName: "syntax-error",
            message: `Syntax errors detected in ${lang.manifest.name} document`,
            symbolId: null,
            resourceId: filePath,
            startByte: 0,
            endByte: item.text.length,
          });
        }
      } catch (e: any) {
        diagnostics.push({
          severity: "error",
          lintName: "parser-failure",
          message: e.message,
          symbolId: null,
          resourceId: item.uri.replace("file://", ""),
          startByte: 0,
          endByte: 0,
        });
      }
    }

    if (diagnostics.length === 0) {
      console.log("No diagnostics found.");
      return;
    }

    for (const d of diagnostics) {
      let entry = null;
      if (engineM && d.symbolId) entry = engineM.toQueryDB().symbol(d.symbolId);
      if (!entry && engineS && d.symbolId) entry = engineS.toQueryDB().symbol(d.symbolId);

      const resource = d.resourceId ?? (entry?.resourceId ? entry.resourceId.replace("file://", "") : "unknown");
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
