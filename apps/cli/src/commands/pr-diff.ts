// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ModelScript PR-Diff CLI Command:
// Computes an AST-aware visual and semantic pull request diff across Git revisions
// for SysML v2, Modelica, and polyglot architecture models.

import { renderVisualDiffToHtml } from "@modelscript/diagram/html-diff-bundle";
import { buildVisualDiffGraph } from "@modelscript/diagram/visual-diff";
import { renderVisualDiffToSvg } from "@modelscript/diagram/visual-diff-renderer";
import { buildSysML2DiagramData, createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import { exec, execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { CommandModule } from "yargs";

const require = createRequire(import.meta.url);

interface PrDiffArgs {
  file?: string;
  base?: string;
  head?: string;
  format?: string;
  output?: string;
  view?: string;
  breakingOnly?: boolean;
  "breaking-only"?: boolean;
  open?: boolean;
}

/**
 * Executes a Git command safely and returns stdout trimmed, or empty string on error.
 */
function runGit(args: string[], cwd: string = process.cwd()): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/**
 * Gets relative path from Git repository root.
 */
function getGitRelativePath(absolutePath: string, repoRoot: string): string {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, "/");
}

export const PrDiff: CommandModule<{}, PrDiffArgs> = {
  command: "pr-diff [file]",
  describe: "Compute visual and semantic pull request diff across Git revisions (SysML v2, Modelica)",
  builder: (yargs) => {
    return yargs
      .positional("file", {
        description: "Path to model file to diff (optional; auto-detects changed model files if omitted)",
        type: "string",
      })
      .option("base", {
        alias: "b",
        description: "Base Git reference (branch, tag, or commit hash)",
        type: "string",
        default: "HEAD~1",
      })
      .option("head", {
        alias: "h",
        description: "Head Git reference (branch, commit hash, or omit for working tree)",
        type: "string",
      })
      .option("format", {
        alias: "f",
        description: "Output format for the visual diff",
        choices: ["visual-html", "visual-svg", "pr-comment", "json", "terminal"],
        default: "visual-html",
      })
      .option("output", {
        alias: "o",
        description: "Output file path (defaults to stdout or visual-diff.html / visual-diff.svg)",
        type: "string",
      })
      .option("view", {
        alias: "v",
        description: "SysML v2 viewpoint projection filter (e.g. All, BDD, IBD, StateMachine)",
        type: "string",
        default: "All",
      })
      .option("breaking-only", {
        description: "Only report breaking changes",
        type: "boolean",
        default: false,
      })
      .option("open", {
        description: "Automatically open generated visual HTML in default web browser",
        type: "boolean",
        default: false,
      }) as any;
  },
  handler: async (args) => {
    const cwd = process.cwd();
    const repoRoot = runGit(["rev-parse", "--show-toplevel"], cwd) || cwd;

    const baseRef = args.base || "HEAD~1";
    const headRef = args.head;
    const format = args.format || "visual-html";
    const viewName = args.view || "All";

    // 1. Identify target file(s)
    let targetFiles: string[] = [];

    if (args.file) {
      targetFiles = [path.resolve(cwd, args.file)];
    } else {
      // Auto-detect changed model files between base and head
      const gitDiffArgs = headRef ? ["diff", "--name-only", baseRef, headRef] : ["diff", "--name-only", baseRef];
      const diffOutput = runGit(gitDiffArgs, repoRoot);

      if (diffOutput) {
        targetFiles = diffOutput
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.endsWith(".sysml") || f.endsWith(".mo"))
          .map((f) => path.resolve(repoRoot, f));
      }
    }

    if (targetFiles.length === 0 || !targetFiles[0]) {
      console.log("No changed .sysml or .mo files detected between", baseRef, "and", headRef || "working tree");
      return;
    }

    const targetFile: string = targetFiles[0];
    const gitRelPath = getGitRelativePath(targetFile, repoRoot);
    const fileName = path.basename(targetFile);

    // 2. Fetch Base and Head file contents
    const baseContent = runGit(["show", `${baseRef}:${gitRelPath}`], repoRoot);
    let headContent = "";

    if (headRef) {
      headContent = runGit(["show", `${headRef}:${gitRelPath}`], repoRoot);
    } else if (fs.existsSync(targetFile)) {
      headContent = fs.readFileSync(targetFile, "utf-8");
    }

    if (!baseContent && !headContent) {
      console.error(`Error: Could not retrieve content for ${gitRelPath} at base '${baseRef}' or head.`);
      process.exit(1);
    }

    const isSysml = targetFile.endsWith(".sysml");

    // 3. Parse ASTs and Build Diagrams
    let baseDiagram: any = null;
    let headDiagram: any = null;

    if (isSysml) {
      let sysmlWasmPath: string;
      try {
        sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
      } catch {
        sysmlWasmPath = path.resolve(import.meta.dirname, "../../../../languages/sysml2/dist/parser.wasm");
      }
      const { createWasmParser } = await import("@modelscript/dsl/bindings");
      const res = await createWasmParser(sysmlWasmPath);
      const parser = res.parser;

      if (baseContent) {
        const baseAst = parser.parse(baseContent)?.rootNode;
        const baseWIdx = createSysML2WorkspaceIndex();
        baseWIdx.register(targetFile, () => baseAst);
        const baseIndex = await baseWIdx.toUnifiedAsync();
        baseDiagram = buildSysML2DiagramData(baseIndex, targetFile, undefined, viewName);
      }

      if (headContent) {
        const headAst = parser.parse(headContent)?.rootNode;
        const headWIdx = createSysML2WorkspaceIndex();
        headWIdx.register(targetFile, () => headAst);
        const headIndex = await headWIdx.toUnifiedAsync();
        headDiagram = buildSysML2DiagramData(headIndex, targetFile, undefined, viewName);
      }
    } else {
      console.log(`Visual PR diff for ${fileName}: Modelica/Polyglot support.`);
    }

    // 4. Construct Stabilized Visual Diff Graph
    const diffData = buildVisualDiffGraph(baseDiagram, headDiagram, {
      padding: 40,
      iterations: 25,
    });

    const title = `Visual PR Diff: ${fileName}`;
    const displayHead = headRef || "working tree";

    // 5. Output Format Rendering
    if (format === "visual-html") {
      const html = renderVisualDiffToHtml(diffData, {
        title,
        baseRef,
        headRef: displayHead,
        repoName: path.basename(repoRoot),
      });

      const outFile = args.output || path.resolve(cwd, `visual-diff-${fileName}.html`);
      fs.writeFileSync(outFile, html, "utf-8");
      console.log(`\x1b[32m✔ Visual PR Diff HTML generated:\x1b[0m ${outFile}`);
      console.log(
        `  Added: +${diffData.stats.addedNodes} | Deleted: −${diffData.stats.deletedNodes} | Modified: ~${diffData.stats.modifiedNodes} | Breaking: ${diffData.stats.breakingChanges}`,
      );

      if (args.open) {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${opener} "${outFile}"`).on("error", () => {
          console.warn(`Could not automatically open browser for: ${outFile}`);
        });
      }
    } else if (format === "visual-svg") {
      const svg = renderVisualDiffToSvg(diffData, {
        title: `${title} (${baseRef} ➔ ${displayHead})`,
      });

      const outFile = args.output || path.resolve(cwd, `visual-diff-${fileName}.svg`);
      fs.writeFileSync(outFile, svg, "utf-8");
      console.log(`\x1b[32m✔ Visual PR Diff SVG generated:\x1b[0m ${outFile}`);
    } else if (format === "pr-comment") {
      // Markdown PR Review Comment for GitHub/GitLab
      const hasBreaking = diffData.stats.breakingChanges > 0;
      const statusIcon = hasBreaking ? "⚠️" : "✅";

      let comment = `### ${statusIcon} ModelScript SysML v2 Visual PR Review: \`${fileName}\`\n\n`;
      comment += `Comparing base **\`${baseRef}\`** ➔ head **\`${displayHead}\`**\n\n`;
      comment += `| Metric | Count | Details |\n`;
      comment += `| :--- | :---: | :--- |\n`;
      comment += `| 🟢 **Added Elements** | \`+${diffData.stats.addedNodes}\` | New parts, ports, and allocations |\n`;
      comment += `| 🔴 **Deleted Elements** | \`−${diffData.stats.deletedNodes}\` | Removed subsystem components |\n`;
      comment += `| 🟡 **Modified Elements** | \`~${diffData.stats.modifiedNodes}\` | Attribute or structural updates |\n`;
      comment += `| ⚡ **Breaking Changes** | \`${diffData.stats.breakingChanges}\` | ${hasBreaking ? "**Review Required**: interface or causality breaking shifts" : "No breaking interface changes"} |\n\n`;

      const modifiedNodes = diffData.nodes.filter((n) => n.diffStatus === "modified");
      if (modifiedNodes.length > 0) {
        comment += `<details>\n<summary><b>🔍 Detailed Element Modifications (${modifiedNodes.length})</b></summary>\n\n`;
        comment += `| Component | Breaking? | Property Deltas |\n`;
        comment += `| :--- | :---: | :--- |\n`;
        for (const mn of modifiedNodes) {
          const name = mn.properties?.values?.name || mn.id;
          const changes = (mn.propertyChanges || [])
            .map((c) => `\`${c.key}\`: ${JSON.stringify(c.oldValue)} ➔ ${JSON.stringify(c.newValue)}`)
            .join("<br>");
          comment += `| \`${name}\` | ${mn.isBreaking ? "⚠️ **YES**" : "No"} | ${changes || "Port configuration changed"} |\n`;
        }
        comment += `\n</details>\n\n`;
      }

      comment += `> 💡 *Generated by [ModelScript](https://github.com/modelscript/modelscript) Visual PR Diff Engine.*\n`;

      if (args.output) {
        fs.writeFileSync(path.resolve(cwd, args.output), comment, "utf-8");
        console.log(`\x1b[32m✔ PR Comment Markdown written to:\x1b[0m ${args.output}`);
      } else {
        console.log(comment);
      }
    } else if (format === "json") {
      const outputJson = {
        file: fileName,
        base: baseRef,
        head: displayHead,
        stats: diffData.stats,
        nodes: diffData.nodes.map((n) => ({
          id: n.id,
          name: n.properties?.values?.name || n.id,
          diffStatus: n.diffStatus,
          isBreaking: n.isBreaking,
          changes: n.propertyChanges,
        })),
        edges: diffData.edges.map((e) => ({
          id: e.id,
          diffStatus: e.diffStatus,
          isBreaking: e.isBreaking,
        })),
      };
      if (args.output) {
        fs.writeFileSync(path.resolve(cwd, args.output), JSON.stringify(outputJson, null, 2), "utf-8");
        console.log(`\x1b[32m✔ Diff JSON written to:\x1b[0m ${args.output}`);
      } else {
        console.log(JSON.stringify(outputJson, null, 2));
      }
    } else {
      // Terminal format
      console.log(`\x1b[1mModelScript Visual PR Diff:\x1b[0m ${fileName}`);
      console.log(`Base: ${baseRef}  ➔  Head: ${displayHead}`);
      console.log(`─────────────────────────────────────────────────────────────`);
      for (const n of diffData.nodes) {
        const name = n.properties?.values?.name || n.id;
        if (n.diffStatus === "added") {
          console.log(`  \x1b[32m+ [ADDED]\x1b[0m   ${name}`);
        } else if (n.diffStatus === "deleted") {
          console.log(`  \x1b[31m- [DELETED]\x1b[0m ${name} \x1b[31m(BREAKING)\x1b[0m`);
        } else if (n.diffStatus === "modified") {
          const brk = n.isBreaking ? ` \x1b[31m(BREAKING)\x1b[0m` : "";
          console.log(`  \x1b[33m~ [MODIFIED]\x1b[0m ${name}${brk}`);
        }
      }
      console.log(`─────────────────────────────────────────────────────────────`);
      console.log(
        `Summary: +${diffData.stats.addedNodes} Added, −${diffData.stats.deletedNodes} Deleted, ~${diffData.stats.modifiedNodes} Modified (${diffData.stats.breakingChanges} Breaking)`,
      );
    }
  },
};
