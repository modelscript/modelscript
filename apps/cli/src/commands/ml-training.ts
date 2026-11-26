// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript CLI (`msx`) commands for Relational Dynamic-m Zonotope Datasets,
 * DiskANN Engineering Memory, Formal CI Evaluation, and PyTorch/Slurm HPC Export.
 */

import {
  analyzeRecipePreFlight,
  bucketHypergraphExamples,
  compileRelationalHypergraph,
  diffDatasetVersions,
  generatePyTorchSlurmRecipeExport,
  runFormalModelEvalSuite,
  SmallLlmZonotopeRuntime,
  type FormalEvalCase,
  type RecipeExampleInput,
  type RelationalHypergraphRecord,
} from "@modelscript/runtime";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Argv, CommandModule } from "yargs";

function inferDialect(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mo":
      return "modelica";
    case ".sysml":
    case ".kerml":
      return "sysml2";
    case ".scad":
      return "scad";
    case ".step":
    case ".stp":
      return "step";
    case ".urdf":
      return "urdf";
    case ".owl":
    case ".ofn":
    case ".ttl":
      return "owl2";
    case ".sp":
    case ".cir":
      return "spice";
    case ".md":
    case ".markdown":
      return "markdown";
    default:
      return "text";
  }
}

function expandInputFiles(inputs: string[]): string[] {
  const files: string[] = [];
  const walk = (p: string) => {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      files.push(abs);
    } else if (stat.isDirectory()) {
      for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
        if (ent.name === ".git" || ent.name === "node_modules" || ent.name === "dist") continue;
        walk(path.join(abs, ent.name));
      }
    }
  };
  for (const inp of inputs) walk(inp);
  return files.sort();
}

function loadRecipeExamplesFromTarget(targetPath: string, relativeToTargetDir: boolean): RecipeExampleInput[] {
  const abs = path.resolve(targetPath);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);

  if (stat.isFile() && path.extname(abs).toLowerCase() === ".json") {
    try {
      const parsed = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;
      if (Array.isArray(parsed)) {
        const mapped: RecipeExampleInput[] = [];
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>)["source"] === "string") {
            const obj = item as Record<string, unknown>;
            const entry: RecipeExampleInput = {
              uri: typeof obj["uri"] === "string" && obj["uri"].trim() ? obj["uri"].trim() : `example_${i}`,
              dialect:
                typeof obj["dialect"] === "string" && obj["dialect"].trim()
                  ? obj["dialect"].trim().toLowerCase()
                  : "text",
              source: obj["source"] as string,
            };
            if (typeof obj["exampleId"] === "string" && obj["exampleId"].trim()) {
              entry.exampleId = obj["exampleId"].trim();
            }
            mapped.push(entry);
          }
        }
        if (mapped.length > 0 || parsed.length === 0) {
          return mapped;
        }
      }
    } catch {
      // Fall back to treating as raw source file
    }
  }

  if (stat.isDirectory()) {
    const files = expandInputFiles([abs]);
    return files.map((file) => ({
      uri: (relativeToTargetDir ? path.relative(abs, file) : path.relative(process.cwd(), file)).replace(/\\/g, "/"),
      dialect: inferDialect(file),
      source: fs.readFileSync(file, "utf8"),
    }));
  }

  return [
    {
      uri: path.relative(process.cwd(), abs).replace(/\\/g, "/"),
      dialect: inferDialect(abs),
      source: fs.readFileSync(abs, "utf8"),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. `msx dataset <action> [paths..]`
// ─────────────────────────────────────────────────────────────────────────────

interface DatasetArgs {
  action: string;
  paths?: string[] | undefined;
  outDir: string;
  shardSize: number;
  batchSize: number;
  mCap: number;
  recipeName: string;
}

export const DatasetCommand: CommandModule<{}, DatasetArgs> = {
  command: "dataset <action> [paths..]",
  describe: "Compile, inspect, pre-flight audit, or semantically diff Relational Zonotope datasets",
  builder: ((y: Argv) =>
    y
      .positional("action", {
        type: "string",
        choices: ["compile", "inspect", "audit", "diff"],
        demandOption: true,
        description: "Action to perform (compile | inspect | audit | diff)",
      })
      .positional("paths", {
        type: "string",
        array: true,
        description: "Input files, directories, JSON example arrays, or JSONL shard paths",
      })
      .option("out-dir", {
        alias: "o",
        type: "string",
        default: ".modelscript/datasets",
        description: "Output directory for compiled m_init-bucketed shards",
      })
      .option("shard-size", {
        type: "number",
        default: 256,
        description: "Maximum examples per m_init-bucketed shard",
      })
      .option("batch-size", {
        type: "number",
        default: 8,
        description: "Batch size used for Dynamic-m bucketing efficiency audit",
      })
      .option("m-cap", {
        type: "number",
        default: 32,
        description: "Hard Dynamic-m generator safety ceiling",
      })
      .option("recipe-name", {
        type: "string",
        default: "@local/engineering-dataset",
        description: "Logical recipe name written into dataset-manifest.json",
      })) as unknown as CommandModule<{}, DatasetArgs>["builder"],
  handler: async (args) => {
    const paths = args.paths ?? [];
    if (args.action === "compile") {
      const files = expandInputFiles(paths);
      if (files.length === 0) {
        console.error("[msx dataset compile] No input files found.");
        process.exitCode = 1;
        return;
      }

      const records: RelationalHypergraphRecord[] = [];
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const dialect = inferDialect(file);
        records.push(
          compileRelationalHypergraph({
            source,
            uri: path.relative(process.cwd(), file).replace(/\\/g, "/"),
            dialect,
          }),
        );
      }

      const buckets = bucketHypergraphExamples(records, args.shardSize, args.mCap);
      const outDir = path.resolve(args.outDir);
      fs.mkdirSync(outDir, { recursive: true });

      const shardManifests: { shardId: string; file: string; mMin: number; mMax: number; count: number }[] = [];
      for (const b of buckets) {
        const payload =
          b.examples
            .map((ex) =>
              JSON.stringify({
                example_id: ex.exampleId,
                uri: ex.uri,
                dialect: ex.dialect,
                m_init: ex.mInit,
                token_ids: ex.tokenIds,
                group_ids: ex.groupIds,
                rel_type_ids: ex.relTypeIds,
                rel_signs: ex.relSigns,
              }),
            )
            .join("\n") + "\n";
        const shardId = crypto.createHash("sha256").update(payload).digest("hex");
        const shardFile = path.join(outDir, `${shardId}.jsonl`);
        fs.writeFileSync(shardFile, payload, "utf8");
        const ms = b.examples.map((e) => e.mInit);
        shardManifests.push({
          shardId,
          file: path.basename(shardFile),
          mMin: Math.min(...ms),
          mMax: Math.max(...ms),
          count: b.examples.length,
        });
      }

      const manifestPath = path.join(outDir, "dataset-manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            category: "dataset-pretrain",
            recipeName: args.recipeName,
            memoryBackend: "diskann",
            targetModelScale: "0.5B-1.5B",
            mCap: args.mCap,
            totalExamples: records.length,
            shards: shardManifests,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      console.log(
        JSON.stringify(
          {
            status: "ok",
            totalExamples: records.length,
            shardsCreated: shardManifests.length,
            manifestPath,
            shards: shardManifests,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (args.action === "inspect") {
      const target = paths[0];
      if (!target || !fs.existsSync(target)) {
        console.error("[msx dataset inspect] Please provide a valid .jsonl shard file path.");
        process.exitCode = 1;
        return;
      }
      const lines = fs
        .readFileSync(target, "utf8")
        .split("\n")
        .filter((l) => l.trim());
      const byDialect: Record<string, number> = {};
      let mMin = Infinity;
      let mMax = 0;
      let totalTokens = 0;
      for (const line of lines) {
        const row = JSON.parse(line) as { dialect: string; m_init: number; token_ids: number[] };
        byDialect[row.dialect] = (byDialect[row.dialect] ?? 0) + 1;
        if (row.m_init < mMin) mMin = row.m_init;
        if (row.m_init > mMax) mMax = row.m_init;
        totalTokens += row.token_ids.length;
      }
      console.log(
        JSON.stringify(
          {
            shardFile: path.resolve(target),
            exampleCount: lines.length,
            totalTokens,
            mMin: lines.length > 0 ? mMin : 0,
            mMax,
            byDialect,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (args.action === "audit") {
      if (paths.length === 0) {
        console.error("[msx dataset audit] Please provide one or more input file, directory, or JSON paths.");
        process.exitCode = 1;
        return;
      }
      const examples: RecipeExampleInput[] = [];
      for (const p of paths) {
        examples.push(...loadRecipeExamplesFromTarget(p, false));
      }
      if (examples.length === 0) {
        console.error("[msx dataset audit] No readable input files found.");
        process.exitCode = 1;
        return;
      }
      const report = analyzeRecipePreFlight(examples, {
        batchSize: args.batchSize,
        mCap: args.mCap,
      });
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (args.action === "diff") {
      const beforePath = paths[0];
      const afterPath = paths[1];
      if (!beforePath || !afterPath) {
        console.error("[msx dataset diff] Usage: msx dataset diff <beforePath> <afterPath>");
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(path.resolve(beforePath))) {
        console.error(`[msx dataset diff] Before path not found: ${beforePath}`);
        process.exitCode = 1;
        return;
      }
      if (!fs.existsSync(path.resolve(afterPath))) {
        console.error(`[msx dataset diff] After path not found: ${afterPath}`);
        process.exitCode = 1;
        return;
      }
      const beforeExamples = loadRecipeExamplesFromTarget(beforePath, true);
      const afterExamples = loadRecipeExamplesFromTarget(afterPath, true);
      const diff = diffDatasetVersions(beforeExamples, afterExamples);
      console.log(JSON.stringify(diff, null, 2));
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. `msx memory <action> [query]`
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryArgs {
  action: string;
  query?: string | undefined;
  api: string;
  pins?: string | undefined;
  dialects?: string | undefined;
  topK: number;
  includeSocial: boolean;
}

export const MemoryCommand: CommandModule<{}, MemoryArgs> = {
  command: "memory <action> [query]",
  describe: "Query or inspect the federated/local DiskANN NVMe Vector Memory API",
  builder: ((y: Argv) =>
    y
      .positional("action", {
        type: "string",
        choices: ["query", "stats"],
        demandOption: true,
        description: "Memory action (query | stats)",
      })
      .positional("query", {
        type: "string",
        description: "Text/symbol query when action === 'query'",
      })
      .option("api", {
        type: "string",
        default: process.env["MODELSCRIPT_API_URL"] || "http://localhost:3001",
        description: "Base URL of the ModelScript DiskANN Memory API",
      })
      .option("pins", {
        type: "string",
        description: "Comma-separated semver package pins (e.g. @ms/thermal-pack@1.0.0)",
      })
      .option("dialects", {
        type: "string",
        description: "Comma-separated dialect filter (e.g. modelica,scad,owl2)",
      })
      .option("top-k", {
        type: "number",
        default: 6,
        description: "Number of chunks to return",
      })
      .option("include-social", {
        type: "boolean",
        default: true,
        description: "Include verified social posts & RLHF Fix-It solutions",
      })) as unknown as CommandModule<{}, MemoryArgs>["builder"],
  handler: async (args) => {
    const base = args.api.replace(/\/+$/, "");
    if (args.action === "stats") {
      const res = await fetch(`${base}/api/v1/memory/stats`);
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
      return;
    }

    if (!args.query?.trim()) {
      console.error("[msx memory query] Query string is required.");
      process.exitCode = 1;
      return;
    }

    let packagePins: Record<string, string> | undefined;
    if (args.pins) {
      packagePins = {};
      for (const pair of args.pins.split(",")) {
        const idx = pair.lastIndexOf("@");
        if (idx > 0) packagePins[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
    }
    const dialects = args.dialects
      ? args.dialects
          .split(",")
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean)
      : undefined;

    const res = await fetch(`${base}/api/v1/memory/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "hybrid",
        textQuery: args.query,
        packagePins,
        dialects,
        includeSocialPosts: args.includeSocial,
        topK: args.topK,
      }),
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
    if (!res.ok) process.exitCode = 1;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. `msx train-llm <action> [target]`
// ─────────────────────────────────────────────────────────────────────────────

interface TrainLlmArgs {
  action: string;
  target?: string | undefined;
  outDir: string;
  gpus: number;
  shards?: string | undefined;
  steps: number;
  mCap: number;
}

export const TrainLlmCommand: CommandModule<{}, TrainLlmArgs> = {
  command: "train-llm <action> [target]",
  describe: "Run Dynamic-m LoRA smoke training, Formal Eval CI promotion gate, or export PyTorch/Slurm HPC bundles",
  builder: ((y: Argv) =>
    y
      .positional("action", {
        type: "string",
        choices: ["smoke", "eval", "export-slurm"],
        demandOption: true,
        description: "Action (smoke | eval | export-slurm)",
      })
      .positional("target", {
        type: "string",
        description: "Eval suite JSON path (for eval) or recipe name (for export-slurm)",
      })
      .option("out-dir", {
        alias: "o",
        type: "string",
        default: ".modelscript/slurm",
        description: "Output directory for export-slurm bundle",
      })
      .option("gpus", {
        type: "number",
        default: 4,
        description: "Number of GPUs requested in Slurm script",
      })
      .option("shards", {
        type: "string",
        description: "Comma-separated SHA-256 shard IDs to pin in Slurm manifest",
      })
      .option("steps", {
        type: "number",
        default: 10,
        description: "Number of LoRA SGD steps for smoke check",
      })
      .option("m-cap", {
        type: "number",
        default: 16,
        description: "Dynamic-m generator safety cap",
      })) as unknown as CommandModule<{}, TrainLlmArgs>["builder"],
  handler: async (args) => {
    if (args.action === "smoke") {
      const record = compileRelationalHypergraph({
        source: "model RC parameter Real R = 100; Real v; equation v = R * 0.5; end RC;",
        dialect: "modelica",
      });
      const runtime = new SmallLlmZonotopeRuntime({
        vocabSize: 64,
        hiddenDim: 16,
        loraRank: 4,
        numLayers: 2,
        retrieverDim: 32,
      });
      const targets = record.tokenIds.map((t) => t % 64);
      const first = runtime.trainStepLora(record, targets, { activeMCap: args.mCap, lr: 0.08 });
      let last = first;
      for (let i = 1; i < Math.max(2, args.steps); i++) {
        last = runtime.trainStepLora(record, targets, { activeMCap: args.mCap, lr: 0.08 });
      }
      console.log(
        JSON.stringify(
          {
            status: last.loss < first.loss ? "converged" : "warning",
            mInit: record.mInit,
            initialLoss: Number(first.loss.toFixed(4)),
            finalLoss: Number(last.loss.toFixed(4)),
            finalMaxSpread: Number(last.maxSpread.toFixed(5)),
            layerTelemetry: last.layerTelemetry,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (args.action === "eval") {
      if (!args.target || !fs.existsSync(args.target)) {
        console.error("[msx train-llm eval] Please provide a valid JSON file of FormalEvalCase[].");
        process.exitCode = 1;
        return;
      }
      const cases = JSON.parse(fs.readFileSync(args.target, "utf8")) as FormalEvalCase[];
      const report = runFormalModelEvalSuite(cases);
      console.log(JSON.stringify(report, null, 2));
      if (!report.promoted) {
        process.exitCode = 1;
      }
      return;
    }

    if (args.action === "export-slurm") {
      const recipeName = args.target || "@modelscript/small-llm-engineering";
      const shardIds = args.shards
        ? args.shards
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const bundle = generatePyTorchSlurmRecipeExport({
        recipeName,
        shardIds,
        gpus: args.gpus,
        dynamicM: { mCap: args.mCap },
      });
      const outDir = path.resolve(args.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      const manifestPath = path.join(outDir, "training-recipe.manifest.json");
      const slurmPath = path.join(outDir, "train_dynamic_m.slurm");
      fs.writeFileSync(manifestPath, bundle.manifestJson, "utf8");
      fs.writeFileSync(slurmPath, bundle.slurmScript, "utf8");
      console.log(JSON.stringify({ status: "exported", manifestPath, slurmPath }, null, 2));
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. `msx model <action> [target]`
// ─────────────────────────────────────────────────────────────────────────────

interface ModelCommandArgs {
  action: string;
  target?: string | undefined;
  api: string;
  token?: string | undefined;
  kind?: string | undefined;
  stage?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
  evalReport?: string | undefined;
}

function buildAuthHeaders(token?: string): Record<string, string> {
  const resolved = token?.trim() || process.env["MODELSCRIPT_API_TOKEN"]?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (resolved) {
    headers["Authorization"] = `Bearer ${resolved}`;
  }
  return headers;
}

function parseModelTargetRef(
  target?: string,
  nameOpt?: string,
  versionOpt?: string,
): { name: string; version: string } | null {
  if (nameOpt?.trim() && versionOpt?.trim()) {
    return { name: nameOpt.trim(), version: versionOpt.trim() };
  }
  if (!target?.trim()) return null;
  const trimmed = target.trim();
  const lastAt = trimmed.lastIndexOf("@");
  if (lastAt > 0) {
    const name = trimmed.slice(0, lastAt).trim();
    const version = trimmed.slice(lastAt + 1).trim();
    if (name && version) return { name, version };
  }
  const colonIdx = trimmed.lastIndexOf(":");
  if (colonIdx > 0) {
    const name = trimmed.slice(0, colonIdx).trim();
    const version = trimmed.slice(colonIdx + 1).trim();
    if (name && version) return { name, version };
  }
  if (versionOpt?.trim()) {
    return { name: trimmed, version: versionOpt.trim() };
  }
  return null;
}

export const ModelCommand: CommandModule<{}, ModelCommandArgs> = {
  command: "model <action> [target]",
  describe: "List, inspect, or formally promote models in the ModelScript Model Registry",
  builder: ((y: Argv) =>
    y
      .positional("action", {
        type: "string",
        choices: ["list", "inspect", "promote"],
        demandOption: true,
        description: "Model Registry action (list | inspect | promote)",
      })
      .positional("target", {
        type: "string",
        description: "Model ref (`name@version`) for inspect/promote, or optional name filter for list",
      })
      .option("api", {
        type: "string",
        default: process.env["MODELSCRIPT_API_URL"] || "http://localhost:3001",
        description: "Base URL of the ModelScript API server",
      })
      .option("token", {
        type: "string",
        description: "Bearer auth token (defaults to MODELSCRIPT_API_TOKEN)",
      })
      .option("kind", {
        type: "string",
        choices: ["model-core", "lora-adapter", "projection-head"],
        description: "Filter models by kind (for list)",
      })
      .option("stage", {
        type: "string",
        choices: ["draft", "staging", "production", "deprecated"],
        description: "Filter by promotionStage (list) or targetStage (promote, defaults to production)",
      })
      .option("name", {
        type: "string",
        description: "Explicit model name",
      })
      .option("version", {
        type: "string",
        description: "Explicit model version",
      })
      .option("eval-report", {
        type: "string",
        description: "Path to FormalModelEvalReport JSON file to attach during promotion",
      })) as unknown as CommandModule<{}, ModelCommandArgs>["builder"],
  handler: async (args) => {
    const base = args.api.replace(/\/+$/, "");
    const headers = buildAuthHeaders(args.token);

    if (args.action === "list") {
      const params = new URLSearchParams();
      if (args.kind) params.set("kind", args.kind);
      if (args.stage) params.set("promotionStage", args.stage);
      const nameFilter = args.name?.trim() || args.target?.trim();
      if (nameFilter) params.set("name", nameFilter);
      const qs = params.toString();
      const res = await fetch(`${base}/api/v1/models${qs ? `?${qs}` : ""}`, { headers });
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
      return;
    }

    const ref = parseModelTargetRef(args.target, args.name, args.version);
    if (!ref) {
      console.error(
        `[msx model ${args.action}] Provide a model reference as <name>@<version> or --name <name> --version <version>.`,
      );
      process.exitCode = 1;
      return;
    }

    const encodedName = encodeURIComponent(ref.name);
    const encodedVersion = encodeURIComponent(ref.version);

    if (args.action === "inspect") {
      const res = await fetch(`${base}/api/v1/models/${encodedName}/${encodedVersion}`, { headers });
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
      return;
    }

    if (args.action === "promote") {
      const targetStage = args.stage || "production";
      let evalReport: unknown;
      if (args.evalReport) {
        const evalPath = path.resolve(args.evalReport);
        if (!fs.existsSync(evalPath)) {
          console.error(`[msx model promote] Eval report file not found: ${args.evalReport}`);
          process.exitCode = 1;
          return;
        }
        evalReport = JSON.parse(fs.readFileSync(evalPath, "utf8"));
      }

      const res = await fetch(`${base}/api/v1/models/${encodedName}/${encodedVersion}/promote`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          targetStage,
          ...(evalReport !== undefined ? { evalReport } : {}),
        }),
      });
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. `msx runs <action> [runUid]`
// ─────────────────────────────────────────────────────────────────────────────

interface RunsCommandArgs {
  action: string;
  runUid?: string | undefined;
  api: string;
  token?: string | undefined;
  status?: string | undefined;
  recipe?: string | undefined;
  backend?: string | undefined;
}

export const RunsCommand: CommandModule<{}, RunsCommandArgs> = {
  command: "runs <action> [runUid]",
  describe: "List or inspect live Dynamic-m training runs and telemetry time-series",
  builder: ((y: Argv) =>
    y
      .positional("action", {
        type: "string",
        choices: ["list", "inspect"],
        demandOption: true,
        description: "Training runs action (list | inspect)",
      })
      .positional("runUid", {
        type: "string",
        description: "Training run UID (required for inspect)",
      })
      .option("api", {
        type: "string",
        default: process.env["MODELSCRIPT_API_URL"] || "http://localhost:3001",
        description: "Base URL of the ModelScript API server",
      })
      .option("token", {
        type: "string",
        description: "Bearer auth token (defaults to MODELSCRIPT_API_TOKEN)",
      })
      .option("status", {
        type: "string",
        choices: ["queued", "running", "paused", "completed", "failed", "cancelled"],
        description: "Filter training runs by status (for list)",
      })
      .option("recipe", {
        type: "string",
        description: "Filter training runs by recipeName (for list)",
      })
      .option("backend", {
        type: "string",
        choices: ["webgpu", "pytorch", "slurm"],
        description: "Filter training runs by backend (for list)",
      })) as unknown as CommandModule<{}, RunsCommandArgs>["builder"],
  handler: async (args) => {
    const base = args.api.replace(/\/+$/, "");
    const headers = buildAuthHeaders(args.token);

    if (args.action === "list") {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.recipe) params.set("recipeName", args.recipe);
      if (args.backend) params.set("backend", args.backend);
      const qs = params.toString();
      const res = await fetch(`${base}/api/v1/runs${qs ? `?${qs}` : ""}`, { headers });
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
      return;
    }

    if (args.action === "inspect") {
      const runUid = args.runUid?.trim();
      if (!runUid) {
        console.error("[msx runs inspect] runUid is required.");
        process.exitCode = 1;
        return;
      }
      const res = await fetch(`${base}/api/v1/runs/${encodeURIComponent(runUid)}`, { headers });
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      if (!res.ok) process.exitCode = 1;
    }
  },
};
