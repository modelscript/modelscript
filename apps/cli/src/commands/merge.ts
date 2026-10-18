// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeThreeWayMerge,
  mergeModelSourceText,
  type MergeStrategy,
  type NumericReconcileInput,
  type NumericReconcileOutput,
} from "@modelscript/dsl";
import { createModelicaWorkspaceIndex } from "@modelscript/modelica/factory";
import modelicaLangFallback from "@modelscript/modelica/language";
import { createWasmParser } from "@modelscript/modelica/parser";
import { PhysicsSimplexReconciler, QueryEngine } from "@modelscript/runtime";
import { createSysML2WorkspaceIndex } from "@modelscript/sysml2/factory";
import sysml2LangFallback from "@modelscript/sysml2/language";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { CommandModule } from "yargs";
import { LanguageResolver } from "../util/language-registry.js";

const require = createRequire(import.meta.url);

interface MergeArgs {
  base?: string | undefined;
  ours?: string | undefined;
  theirs?: string | undefined;
  strategy?: MergeStrategy | undefined;
  "order-agnostic"?: boolean | undefined;
  orderAgnostic?: boolean | undefined;
  "git-driver"?: boolean | undefined;
  gitDriver?: boolean | undefined;
  "install-git-driver"?: boolean | undefined;
  installGitDriver?: boolean | undefined;
  format?: "text" | "json" | "summary" | undefined;
  language?: string | undefined;
  output?: string | undefined;
}

function installGitMergeDriver(cwd: string): void {
  const gitAttributesPath = path.join(cwd, ".gitattributes");
  const linesToEnsure = ["*.mo merge=modelscript", "*.sysml merge=modelscript"];

  let existing = "";
  if (fs.existsSync(gitAttributesPath)) {
    existing = fs.readFileSync(gitAttributesPath, "utf8");
  }

  const missingLines = linesToEnsure.filter((line) => !existing.includes(line));
  if (missingLines.length > 0) {
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.writeFileSync(
      gitAttributesPath,
      `${existing}${prefix}# ModelScript AST/CST 3-way semantic merge driver\n${missingLines.join("\n")}\n`,
      "utf8",
    );
  }

  try {
    execFileSync("git", ["config", "merge.modelscript.name", "ModelScript 3-Way Semantic AST/CST Merge Driver"], {
      cwd,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "merge.modelscript.driver", "npx msx merge %O %A %B --git-driver"], {
      cwd,
      stdio: "ignore",
    });
  } catch {
    // Ignore git config errors when running outside a git repository
  }
}

async function buildIndexedDb(
  filePath: string,
  sourceText: string,
  detectedLang: string,
): Promise<{ db: any; rootId: number | null }> {
  const isSysml = detectedLang === "sysml2" || filePath.endsWith(".sysml");
  const isModelica = detectedLang === "modelica" || filePath.endsWith(".mo") || !isSysml;

  if (isModelica && !isSysml) {
    const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { parser } = await createWasmParser(modelicaWasmPath);
    const ast = parser.parse(sourceText)?.rootNode;
    const wIdx = createModelicaWorkspaceIndex();
    wIdx.register(filePath, () => ast);
    const index = wIdx.toUnified();
    const db = new QueryEngine(index, (modelicaLangFallback as any).queryHooks);
    const topIds = index.childrenOf.get(null) ?? [];
    return { db, rootId: topIds[0] ?? null };
  }

  let sysmlWasmPath: string;
  try {
    sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
  } catch {
    sysmlWasmPath = path.resolve(import.meta.dirname, "../../../../languages/sysml2/dist/parser.wasm");
  }
  const { createWasmParser: createSysmlParser } = await import("@modelscript/dsl/bindings");
  const { parser } = await createSysmlParser(sysmlWasmPath);
  const ast = parser.parse(sourceText)?.rootNode;
  const wIdx = createSysML2WorkspaceIndex();
  wIdx.register(filePath, () => ast);
  const index = await wIdx.toUnifiedAsync();
  const db = new QueryEngine(index, (sysml2LangFallback as any).queryHooks);
  const topIds = index.childrenOf.get(null) ?? [];
  return { db, rootId: topIds[0] ?? null };
}

export const Merge: CommandModule<{}, MergeArgs> = {
  command: "merge [base] [ours] [theirs]",
  describe: "Perform an AST/CST-aware 3-way semantic merge across base, ours, and theirs model files",
  builder: (yargs) => {
    return yargs
      .positional("base", {
        description: "Path to common ancestor (base / %O) model file",
        type: "string",
      })
      .positional("ours", {
        description: "Path to current branch (ours / %A) model file",
        type: "string",
      })
      .positional("theirs", {
        description: "Path to incoming branch (theirs / %B) model file",
        type: "string",
      })
      .option("strategy", {
        alias: "s",
        description: "Conflict resolution strategy",
        choices: ["strict", "ours", "theirs", "physics-simplex"] as const,
        default: "strict" as MergeStrategy,
      })
      .option("order-agnostic", {
        description: "Ignore child ordering differences in declarative sections",
        type: "boolean",
        default: true,
      })
      .option("git-driver", {
        description: "Run as a Git custom merge driver (writes result to <ours> and exits 1 on conflict)",
        type: "boolean",
        default: false,
      })
      .option("install-git-driver", {
        description: "Configure .gitattributes and .git/config to use ModelScript as the Git merge driver",
        type: "boolean",
        default: false,
      })
      .option("format", {
        alias: "f",
        description: "Output format",
        choices: ["text", "json", "summary"] as const,
        default: "text" as const,
      })
      .option("language", {
        alias: "l",
        description: "Explicit language override (modelica, sysml2)",
        type: "string",
      })
      .option("output", {
        alias: "o",
        description: "Write merged output to specified file path",
        type: "string",
      }) as any;
  },
  handler: async (args) => {
    if (args.installGitDriver || args["install-git-driver"]) {
      installGitMergeDriver(process.cwd());
      console.log("Configured Git custom merge driver for *.mo and *.sysml files.");
      return;
    }

    if (!args.base || !args.ours || !args.theirs) {
      console.error("Error: <base>, <ours>, and <theirs> file paths are required unless --install-git-driver is used.");
      process.exit(1);
    }

    const basePath = path.resolve(process.cwd(), args.base);
    const oursPath = path.resolve(process.cwd(), args.ours);
    const theirsPath = path.resolve(process.cwd(), args.theirs);

    for (const [label, p] of [
      ["Base", basePath],
      ["Ours", oursPath],
      ["Theirs", theirsPath],
    ] as const) {
      if (!fs.existsSync(p)) {
        console.error(`Error: ${label} file not found at ${p}`);
        process.exit(1);
      }
    }

    let detectedLang = args.language || "";
    if (!detectedLang) {
      try {
        const r = await LanguageResolver.resolve(oursPath);
        detectedLang = r.manifest.id;
      } catch {
        // Fallback to extension detection
      }
    }

    const baseText = fs.readFileSync(basePath, "utf8");
    const oursText = fs.readFileSync(oursPath, "utf8");
    const theirsText = fs.readFileSync(theirsPath, "utf8");

    const [baseIndexed, oursIndexed, theirsIndexed] = await Promise.all([
      buildIndexedDb(basePath, baseText, detectedLang),
      buildIndexedDb(oursPath, oursText, detectedLang),
      buildIndexedDb(theirsPath, theirsText, detectedLang),
    ]);

    const strategy: MergeStrategy = args.strategy || "strict";
    const orderAgnostic = args.orderAgnostic ?? args["order-agnostic"] ?? true;

    const reconcileNumeric = (input: NumericReconcileInput): NumericReconcileOutput => {
      const simplexRes = PhysicsSimplexReconciler.reconcile({
        name: `merge_${input.parameterName}`,
        parameters: {
          [input.parameterName]: {
            name: input.parameterName,
            unit: input.unit || "1",
            ...(input.bounds ? { bounds: input.bounds } : {}),
            proposals: [
              { domain: "ours", value: input.oursValue, unit: input.unit || "1", weight: 1.0 },
              { domain: "theirs", value: input.theirsValue, unit: input.unit || "1", weight: 1.0 },
            ],
          },
        },
      });
      const paramRes = simplexRes.parameters[input.parameterName];
      if (simplexRes.status === "OPTIMAL" && paramRes) {
        return {
          resolved: true,
          value: paramRes.optimalValue,
          recommendation: simplexRes.recommendation,
        };
      }
      return {
        resolved: false,
        recommendation: simplexRes.recommendation,
      };
    };

    const mergeResult = computeThreeWayMerge(
      baseIndexed.rootId !== null ? { id: baseIndexed.rootId, db: baseIndexed.db } : null,
      oursIndexed.rootId !== null ? { id: oursIndexed.rootId, db: oursIndexed.db } : null,
      theirsIndexed.rootId !== null ? { id: theirsIndexed.rootId, db: theirsIndexed.db } : null,
      {
        strategy,
        orderAgnostic,
        reconcileNumeric,
      },
    );

    const sourceMerge = mergeModelSourceText(baseText, oursText, theirsText, mergeResult);
    const isGitDriver = Boolean(args.gitDriver || args["git-driver"]);

    if (isGitDriver) {
      fs.writeFileSync(oursPath, sourceMerge.mergedText, "utf8");
      if (sourceMerge.hasConflicts) {
        process.exit(1);
      }
      return;
    }

    if (args.output) {
      const outPath = path.resolve(process.cwd(), args.output);
      fs.writeFileSync(outPath, sourceMerge.mergedText, "utf8");
    }

    if (args.format === "json") {
      console.log(
        JSON.stringify(
          {
            status: mergeResult.status,
            strategy: mergeResult.strategy,
            hasConflicts: mergeResult.hasConflicts,
            appliedEditsCount: sourceMerge.appliedEditsCount,
            conflicts: mergeResult.conflicts.map((c) => ({
              kind: c.kind,
              symbolName: c.symbolName,
              symbolKind: c.symbolKind,
              category: c.category,
              description: c.description,
              baseValue: c.baseValue,
              oursValue: c.oursValue,
              theirsValue: c.theirsValue,
              isBreaking: c.isBreaking,
            })),
            mergedText: sourceMerge.mergedText,
          },
          null,
          2,
        ),
      );
    } else if (args.format === "summary") {
      console.log(`Merge Status: ${mergeResult.status.toUpperCase()} (strategy: ${mergeResult.strategy})`);
      console.log(`Applied Edits: ${sourceMerge.appliedEditsCount}`);
      console.log(`Conflicts: ${mergeResult.conflicts.length}`);
      for (const c of mergeResult.conflicts) {
        console.log(`  - [${c.kind}] ${c.symbolKind} '${c.symbolName}': ${c.description}`);
      }
    } else if (!args.output) {
      process.stdout.write(sourceMerge.mergedText);
    }

    if (sourceMerge.hasConflicts) {
      process.exitCode = 1;
    }
  },
};
