// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderVisualDiffToHtml } from "@modelscript/diagram/html-diff-bundle";
import { buildVisualDiffGraph } from "@modelscript/diagram/visual-diff";
import { renderVisualDiffToSvg } from "@modelscript/diagram/visual-diff-renderer";
import { computeSemanticDiff, type SemanticEdit } from "@modelscript/dsl";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import { QueryEngine } from "@modelscript/runtime";
import { buildSysML2DiagramData, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { CommandModule } from "yargs";

const require = createRequire(import.meta.url);

import { LanguageResolver } from "../util/language-registry.js";

interface DiffArgs {
  file1: string;
  file2: string;
  orderAgnostic?: boolean;
  breakingOnly?: boolean;
  "order-agnostic": boolean;
  "breaking-only": boolean;
  format: string;
  language?: string;
  output?: string;
}

export const Diff: CommandModule<{}, DiffArgs> = {
  command: "diff <file1> <file2>",
  describe: "Compute an AST-aware semantic diff between two model files (supports any registered DSL)",
  builder: (yargs) => {
    return yargs
      .positional("file1", {
        demandOption: true,
        description: "Path to original/baseline file",
        type: "string",
      })
      .positional("file2", {
        demandOption: true,
        description: "Path to modified/target file",
        type: "string",
      })
      .option("language", {
        alias: "l",
        description: "Explicit language override (e.g. modelica, sysml2, scad)",
        type: "string",
      })
      .option("order-agnostic", {
        description: "Ignore child order changes in declarative sections (e.g. equation sets)",
        type: "boolean",
        default: true,
      })
      .option("breaking-only", {
        description: "Only report breaking changes (API modifications, deleted connectors, type switches)",
        type: "boolean",
        default: false,
      })
      .option("format", {
        description: "Output format",
        choices: ["terminal", "json", "summary", "visual-html", "visual-svg", "pr-comment"],
        default: "terminal",
      })
      .option("output", {
        alias: "o",
        description: "Output file path for visual formats",
        type: "string",
      }) as any;
  },
  handler: async (args) => {
    const file1Path = path.resolve(process.cwd(), args.file1);
    const file2Path = path.resolve(process.cwd(), args.file2);

    if (!fs.existsSync(file1Path)) {
      console.error(`Error: Base file not found at ${file1Path}`);
      process.exit(1);
    }
    if (!fs.existsSync(file2Path)) {
      console.error(`Error: Target file not found at ${file2Path}`);
      process.exit(1);
    }

    let detectedLang: string = args.language || "";
    if (!detectedLang) {
      try {
        const r1 = await LanguageResolver.resolve(file1Path);
        detectedLang = r1.manifest.id;
      } catch {}
    }

    const isSysml = detectedLang === "sysml2" || file1Path.endsWith(".sysml") || file2Path.endsWith(".sysml");
    const isModelica = detectedLang === "modelica" || file1Path.endsWith(".mo") || file2Path.endsWith(".mo");

    const orderAgnostic = args.orderAgnostic ?? args["order-agnostic"] ?? true;
    const breakingOnly = args.breakingOnly ?? args["breaking-only"] ?? false;
    const format = args.format || "terminal";

    const text1 = fs.readFileSync(file1Path, "utf8");
    const text2 = fs.readFileSync(file2Path, "utf8");

    // Load appropriate parser & indexes
    let parser: any;
    let oldIndex: any;
    let newIndex: any;
    let oldDb: any;
    let newDb: any;

    if (isModelica) {
      const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
      const res = await createWasmParser(modelicaWasmPath);
      parser = res.parser;

      const oldAst = parser.parse(text1)?.rootNode;
      const newAst = parser.parse(text2)?.rootNode;

      const oldWIdx = createModelicaWorkspaceIndex();
      oldWIdx.register(file1Path, () => oldAst);
      oldIndex = oldWIdx.toUnified();
      oldDb = new QueryEngine(oldIndex, (modelicaLangFallback as any).queryHooks);

      const newWIdx = createModelicaWorkspaceIndex();
      newWIdx.register(file2Path, () => newAst);
      newIndex = newWIdx.toUnified();
      newDb = new QueryEngine(newIndex, (modelicaLangFallback as any).queryHooks);
    } else if (isSysml) {
      let sysmlWasmPath: string;
      try {
        sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
      } catch {
        sysmlWasmPath = path.resolve(import.meta.dirname, "../../../../languages/sysml2/dist/parser.wasm");
      }
      const { createWasmParser: createSysmlParser } = await import("@modelscript/dsl/bindings");
      const res = await createSysmlParser(sysmlWasmPath);
      parser = res.parser;

      const oldAst = parser.parse(text1)?.rootNode;
      const newAst = parser.parse(text2)?.rootNode;

      const oldWIdx = createSysML2WorkspaceIndex();
      oldWIdx.register(file1Path, () => oldAst);
      oldIndex = await oldWIdx.toUnifiedAsync();
      oldDb = new QueryEngine(oldIndex, (sysml2LangFallback as any).queryHooks);

      const newWIdx = createSysML2WorkspaceIndex();
      newWIdx.register(file2Path, () => newAst);
      newIndex = await newWIdx.toUnifiedAsync();
      newDb = new QueryEngine(newIndex, (sysml2LangFallback as any).queryHooks);
    } else {
      // Generic DSL semantic diff
      const resolved = await LanguageResolver.resolve(file1Path, args.language);
      const { parser: genParser } = await resolved.loadParser();
      const tree1 = genParser.parse(text1);
      const tree2 = genParser.parse(text2);
      const s1 = tree1?.rootNode?.toString() || text1;
      const s2 = tree2?.rootNode?.toString() || text2;
      if (s1 === s2) {
        console.log("No semantic changes detected.");
        return;
      }
      console.log(`[Semantic Diff: ${resolved.manifest.name}]`);
      console.log(`Base:   ${file1Path}`);
      console.log(`Target: ${file2Path}`);
      console.log("Files differ in AST structure.");
      return;
    }

    const getRoots = (idx: any) => {
      const byNull = idx.childrenOf?.get(null) || [];
      if (byNull.length > 0) return byNull;
      const byZero = idx.childrenOf?.get(0) || [];
      if (byZero.length > 0) return byZero;
      const roots: number[] = [];
      for (const [id, sym] of idx.symbols?.entries() || []) {
        if (sym.parentId === null || sym.parentId === 0) {
          roots.push(id);
        }
      }
      return roots;
    };

    const oldRoots = getRoots(oldIndex);
    const newRoots = getRoots(newIndex);
    const maxLen = Math.max(oldRoots.length, newRoots.length);

    const allEdits: SemanticEdit[] = [];
    let hasBreaking = false;

    for (let i = 0; i < maxLen; i++) {
      const oldId = i < oldRoots.length ? oldRoots[i] : null;
      const newId = i < newRoots.length ? newRoots[i] : null;

      const oldNode = oldId !== null ? { id: oldId, db: oldDb.toQueryDB() } : null;
      const newNode = newId !== null ? { id: newId, db: newDb.toQueryDB() } : null;

      if (!oldNode && !newNode) continue;

      const diff = computeSemanticDiff(oldNode, newNode, { orderAgnostic, breakingOnly });
      if (diff.action !== "none") {
        allEdits.push(diff);
        if (diff.isBreaking) hasBreaking = true;
      }
    }

    // Flatten edits for output
    const flatList: { action: string; description: string; isBreaking: boolean; category?: string | undefined }[] = [];
    function collectFlat(edit: SemanticEdit) {
      if (edit.children && edit.children.length > 0) {
        for (const child of edit.children) {
          collectFlat(child);
        }
      } else if (edit.action !== "none" && edit.description) {
        if (!breakingOnly || edit.isBreaking) {
          flatList.push({
            action: edit.action,
            description: edit.description,
            isBreaking: !!edit.isBreaking,
            category: edit.category ?? undefined,
          });
        }
      }
    }
    for (const e of allEdits) collectFlat(e);

    const insertedCount = flatList.filter((e) => e.action === "insert").length;
    const deletedCount = flatList.filter((e) => e.action === "delete").length;
    const updatedCount = flatList.filter((e) => e.action === "update").length;
    const breakingCount = flatList.filter((e) => e.isBreaking).length;

    if (format === "visual-html" || format === "visual-svg" || format === "pr-comment") {
      let baseDiagram: any = null;
      let headDiagram: any = null;

      if (isSysml && oldIndex && newIndex) {
        baseDiagram = buildSysML2DiagramData(oldIndex, file1Path);
        headDiagram = buildSysML2DiagramData(newIndex, file2Path);
      }

      const diffData = buildVisualDiffGraph(baseDiagram, headDiagram);
      const title = `Visual Diff: ${path.basename(file1Path)} vs ${path.basename(file2Path)}`;

      if (format === "visual-html") {
        const html = renderVisualDiffToHtml(diffData, {
          title,
          baseRef: path.basename(file1Path),
          headRef: path.basename(file2Path),
        });
        const outPath = args.output || path.resolve(process.cwd(), "visual-diff.html");
        fs.writeFileSync(outPath, html, "utf-8");
        console.log(`\x1b[32m✔ Visual Diff HTML generated:\x1b[0m ${outPath}`);
      } else if (format === "visual-svg") {
        const svg = renderVisualDiffToSvg(diffData, { title });
        const outPath = args.output || path.resolve(process.cwd(), "visual-diff.svg");
        fs.writeFileSync(outPath, svg, "utf-8");
        console.log(`\x1b[32m✔ Visual Diff SVG generated:\x1b[0m ${outPath}`);
      } else if (format === "pr-comment") {
        let comment = `### 🔍 ModelScript Visual Diff: \`${path.basename(file1Path)}\` ➔ \`${path.basename(file2Path)}\`\n\n`;
        comment += `| Added | Deleted | Modified | Breaking Changes |\n`;
        comment += `| :---: | :---: | :---: | :---: |\n`;
        comment += `| \`+${diffData.stats.addedNodes}\` | \`−${diffData.stats.deletedNodes}\` | \`~${diffData.stats.modifiedNodes}\` | \`${diffData.stats.breakingChanges}\` |\n\n`;
        if (args.output) {
          fs.writeFileSync(path.resolve(process.cwd(), args.output), comment, "utf-8");
          console.log(`\x1b[32m✔ PR Comment written to:\x1b[0m ${args.output}`);
        } else {
          console.log(comment);
        }
      }
      return;
    }

    if (format === "json") {
      console.log(
        JSON.stringify(
          {
            file1: args.file1,
            file2: args.file2,
            summary: {
              totalChanges: flatList.length,
              inserted: insertedCount,
              deleted: deletedCount,
              updated: updatedCount,
              breaking: breakingCount,
            },
            changes: flatList,
          },
          null,
          2,
        ),
      );
    } else if (format === "summary") {
      console.log(`ModelScript Semantic Diff Summary:`);
      console.log(`  Base: ${args.file1}`);
      console.log(`  Target: ${args.file2}`);
      console.log(`  Inserted: ${insertedCount}`);
      console.log(`  Deleted:  ${deletedCount}`);
      console.log(`  Updated:  ${updatedCount}`);
      console.log(`  Breaking: ${breakingCount}`);
    } else {
      // ANSI colors
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";
      const bold = "\x1b[1m";
      const reset = "\x1b[0m";

      console.log(`${bold}ModelScript Semantic AST Diff${reset}`);
      console.log(`Base:   ${args.file1}`);
      console.log(`Target: ${args.file2}`);
      console.log("─────────────────────────────────────────────────────────────");

      if (flatList.length === 0) {
        console.log(`${green}No semantic changes detected (AST topologies are equivalent).${reset}`);
      } else {
        for (const item of flatList) {
          const breakingBadge = item.isBreaking ? `${red}${bold}[BREAKING]${reset} ` : "";
          if (item.action === "insert") {
            console.log(`  ${green}+ [INSERT]${reset} ${breakingBadge}${item.description}`);
          } else if (item.action === "delete") {
            console.log(`  ${red}- [DELETE]${reset} ${breakingBadge}${item.description}`);
          } else if (item.action === "update") {
            console.log(`  ${yellow}~ [UPDATE]${reset} ${breakingBadge}${item.description}`);
          }
        }
      }

      console.log("─────────────────────────────────────────────────────────────");
      const summaryColor = breakingCount > 0 ? red : green;
      console.log(
        `${summaryColor}Summary: ${flatList.length} semantic change(s) (${insertedCount} inserted, ${deletedCount} deleted, ${updatedCount} updated, ${breakingCount} BREAKING)${reset}`,
      );
    }

    if (breakingOnly && hasBreaking) {
      process.exit(1);
    }
  },
};
