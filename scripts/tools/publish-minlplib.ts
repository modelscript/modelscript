// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Publish MINLPLib as a hybrid polyglot package on Ansatz.
 *
 * Packages the MINLPLib formats currently supported by ModelScript:
 *   - .mod (AMPL)
 *   - .gms (GAMS)
 *   - .lp  (CPLEX LP)
 *   - .nl  (AMPL NL)
 *
 * Enriches each model's leading comment block with MINLPLib properties
 * (problem type, convexity, variable/constraint counts, primal/dual bounds,
 * source/reference) so Ansatz's polyglot indexer populates each model page.
 *
 * Usage:
 *   npx tsx scripts/tools/publish-minlplib.ts --input /path/to/minlplib --name MINLPLib --version 1.0.0 --token $ANSATZ_TOKEN
 *   npx tsx scripts/tools/publish-minlplib.ts --download --limit 25 --dry-run --out ./minlplib-sample.zip
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SUPPORTED_FORMATS = ["mod", "gms", "lp", "nl"] as const;
type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

interface CliArgs {
  inputDir?: string | undefined;
  cacheDir?: string | undefined;
  download: boolean;
  formats: SupportedFormat[];
  limit?: number | undefined;
  name: string;
  version: string;
  registry: string;
  token?: string | undefined;
  outZip?: string | undefined;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const defaultCacheDir = path.resolve(process.cwd(), ".cache/minlplib");
  const args: CliArgs = {
    cacheDir: process.env["MINLPLIB_CACHE_DIR"] || (fs.existsSync(defaultCacheDir) ? defaultCacheDir : undefined),
    download: false,
    formats: [...SUPPORTED_FORMATS],
    name: "MINLPLib",
    version: "1.0.0",
    registry: process.env["ANSATZ_REGISTRY_URL"] || "http://localhost:3001/api/publish",
    token: process.env["ANSATZ_TOKEN"],
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const [flag, inlineVal] = a.split("=", 2);
    const nextVal = () => inlineVal ?? argv[++i] ?? "";
    switch (flag) {
      case "--input":
        args.inputDir = nextVal();
        break;
      case "--cache":
        args.cacheDir = nextVal();
        break;
      case "--download":
        args.download = true;
        break;
      case "--formats":
        args.formats = nextVal()
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is SupportedFormat => (SUPPORTED_FORMATS as readonly string[]).includes(s));
        break;
      case "--limit":
        args.limit = Number(nextVal()) || undefined;
        break;
      case "--name":
        args.name = nextVal();
        break;
      case "--version":
        args.version = nextVal();
        break;
      case "--registry":
        args.registry = nextVal().replace(/\/$/, "");
        break;
      case "--token":
        args.token = nextVal();
        break;
      case "--out":
        args.outZip = nextVal();
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
    }
  }
  return args;
}

interface InstanceProps {
  name: string;
  [key: string]: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === "," || ch === ";") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseInstanceDataCsv(csvText: string): Map<string, InstanceProps> {
  const map = new Map<string, InstanceProps>();
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return map;

  const headers = parseCsvLine(lines[0]!);
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]!);
    const name = cols[0];
    if (!name) continue;
    const props: InstanceProps = { name };
    for (let c = 1; c < headers.length; c++) {
      const h = headers[c];
      const v = cols[c];
      if (h && v !== undefined && v !== "") {
        props[h] = v;
      }
    }
    map.set(name, props);
  }
  return map;
}

function formatPropertyHeader(props: InstanceProps | undefined, fmt: SupportedFormat, modelName: string): string {
  if (!props) return "";
  const commentPrefix = fmt === "lp" ? "\\ " : fmt === "gms" ? "* " : "# ";
  const fields: [string, string | undefined][] = [
    ["Model", modelName],
    ["Problem type", props["probtype"] ?? props["type"] ?? props["problemtype"]],
    ["Convexity", props["convex"] ?? props["convexity"]],
    ["Variables", props["nvars"]],
    ["Binary variables", props["nbinvars"]],
    ["Integer variables", props["nintvars"]],
    ["Equations", props["ncons"] ?? props["nequ"]],
    ["Nonzeros", props["nnz"]],
    ["Best primal bound", props["primalbound"] ?? props["bestprimal"]],
    ["Best dual bound", props["dualbound"] ?? props["bestdual"]],
    ["Source", props["source"]],
    ["Reference", `https://www.minlplib.org/${modelName}.html`],
  ];

  const lines = fields.filter(([, val]) => Boolean(val)).map(([label, val]) => `${commentPrefix}${label}: ${val}`);
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function collectModels(args: CliArgs, workDir: string): Promise<{ count: number; formatsUsed: Set<string> }> {
  let propMap = new Map<string, InstanceProps>();
  const formatsUsed = new Set<string>();
  let count = 0;

  if (args.inputDir) {
    const csvPath = path.join(args.inputDir, "instancedata.csv");
    if (fs.existsSync(csvPath)) {
      propMap = parseInstanceDataCsv(fs.readFileSync(csvPath, "utf-8"));
    }

    for (const fmt of args.formats) {
      const fmtDir = path.join(args.inputDir, fmt);
      if (!fs.existsSync(fmtDir)) continue;
      const files = fs
        .readdirSync(fmtDir)
        .filter((f) => f.toLowerCase().endsWith(`.${fmt}`))
        .sort();
      const slice = args.limit ? files.slice(0, args.limit) : files;
      const outFmtDir = path.join(workDir, fmt);
      fs.mkdirSync(outFmtDir, { recursive: true });

      for (const file of slice) {
        const modelName = path.basename(file, `.${fmt}`);
        const raw = fs.readFileSync(path.join(fmtDir, file), "utf-8");
        const header = formatPropertyHeader(propMap.get(modelName), fmt, modelName);
        fs.writeFileSync(path.join(outFmtDir, file), header ? `${header}\n${raw}` : raw, "utf-8");
        formatsUsed.add(fmt);
        count++;
      }
    }
  } else if (!args.download && args.cacheDir && fs.existsSync(args.cacheDir)) {
    const csvPath = path.join(args.cacheDir, "instancedata.csv");
    if (fs.existsSync(csvPath)) {
      propMap = parseInstanceDataCsv(fs.readFileSync(csvPath, "utf-8"));
    }

    const extractRoot = path.join(path.dirname(workDir), "cache-extract");
    fs.mkdirSync(extractRoot, { recursive: true });

    for (const fmt of args.formats) {
      const archivePath = path.join(args.cacheDir, `minlplib_${fmt}.zip`);
      if (!fs.existsSync(archivePath)) continue;
      console.log(`Extracting ${archivePath}...`);
      execFileSync("unzip", ["-oq", archivePath, "-d", extractRoot]);

      const candidateDir = fs.existsSync(path.join(extractRoot, "minlplib", fmt))
        ? path.join(extractRoot, "minlplib", fmt)
        : path.join(extractRoot, fmt);
      if (!fs.existsSync(candidateDir)) continue;

      const files = fs
        .readdirSync(candidateDir)
        .filter((f) => f.toLowerCase().endsWith(`.${fmt}`))
        .sort();
      const slice = args.limit ? files.slice(0, args.limit) : files;
      const outFmtDir = path.join(workDir, fmt);
      fs.mkdirSync(outFmtDir, { recursive: true });

      for (const file of slice) {
        const modelName = path.basename(file, `.${fmt}`);
        const raw = fs.readFileSync(path.join(candidateDir, file), "utf-8");
        const header = formatPropertyHeader(propMap.get(modelName), fmt, modelName);
        fs.writeFileSync(path.join(outFmtDir, file), header ? `${header}\n${raw}` : raw, "utf-8");
        formatsUsed.add(fmt);
        count++;
      }
    }
  } else if (args.download) {
    console.log("Fetching MINLPLib instancedata.csv...");
    const csvText = await fetchText("https://www.minlplib.org/instancedata.csv");
    if (!csvText) {
      throw new Error("Failed to download https://www.minlplib.org/instancedata.csv");
    }
    propMap = parseInstanceDataCsv(csvText);
    const names = Array.from(propMap.keys()).sort();
    const selected = args.limit ? names.slice(0, args.limit) : names;
    console.log(`Downloading ${selected.length} instances across [${args.formats.join(", ")}]...`);

    for (const fmt of args.formats) {
      fs.mkdirSync(path.join(workDir, fmt), { recursive: true });
    }

    for (const modelName of selected) {
      for (const fmt of args.formats) {
        const url = `https://www.minlplib.org/${fmt}/${modelName}.${fmt}`;
        const raw = await fetchText(url);
        if (!raw) continue;
        const header = formatPropertyHeader(propMap.get(modelName), fmt, modelName);
        fs.writeFileSync(path.join(workDir, fmt, `${modelName}.${fmt}`), header ? `${header}\n${raw}` : raw, "utf-8");
        formatsUsed.add(fmt);
        count++;
      }
    }
  } else {
    throw new Error("Specify either --input <local-minlplib-dir> or --download.");
  }

  // Hybrid package manifest & README
  const manifest = {
    name: args.name,
    version: args.version,
    description:
      "MINLPLib mixed-integer nonlinear programming benchmark library (hybrid AMPL/GAMS/CPLEX-LP/NL package)",
    keywords: ["minlplib", "optimization", "minlp", "nlp", "milp", "ampl", "gams", "cplex-lp"],
    modelscript: {
      packageKind: "hybrid",
      defaultTab: "optimization",
      formats: Array.from(formatsUsed),
    },
  };
  fs.writeFileSync(path.join(workDir, "package.json"), JSON.stringify(manifest, null, 2), "utf-8");
  fs.writeFileSync(
    path.join(workDir, "README.md"),
    [
      `# ${args.name} (${args.version})`,
      "",
      "Hybrid optimization benchmark package sourced from [MINLPLib](https://www.minlplib.org/).",
      "",
      `Included formats: ${Array.from(formatsUsed)
        .map((f) => `\`.${f}\``)
        .join(", ")}`,
      `Total indexed model files: ${count}`,
      "",
      "Open any model and switch to the **Optimization** tab to solve interactively in the browser using WASM (CLP, CBC, IPOPT, Bonmin, Couenne, HiGHS), pure-JS (Simplex, B&B, L-BFGS-B), or metaheuristic (DE, CMA-ES, PSO) solvers.",
      "",
    ].join("\n"),
    "utf-8",
  );

  return { count, formatsUsed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "minlplib-hybrid-"));
  const stagingDir = path.join(tmpRoot, "pkg");
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    const { count, formatsUsed } = await collectModels(args, stagingDir);
    console.log(`Staged ${count} model files (${Array.from(formatsUsed).join(", ")}) in ${stagingDir}`);

    const zipPath = args.outZip ? path.resolve(args.outZip) : path.join(tmpRoot, `${args.name}-${args.version}.zip`);
    execFileSync("zip", ["-rq", zipPath, "."], { cwd: stagingDir });
    console.log(`Built hybrid package archive: ${zipPath}`);

    if (args.dryRun) {
      console.log("Dry run complete; skipping upload.");
      return;
    }

    if (!args.token) {
      throw new Error("Missing publish token. Pass --token <token> or set ANSATZ_TOKEN.");
    }

    const bytes = fs.readFileSync(zipPath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/zip" }), path.basename(zipPath));

    const url = `${args.registry}/${encodeURIComponent(args.name)}/${encodeURIComponent(args.version)}`;
    console.log(`Publishing to ${url}...`);
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}` },
      body: form,
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`Publish failed (${res.status}): ${body}`);
    }
    console.log(`Published ${args.name}@${args.version}: ${body}`);
  } finally {
    if (!args.outZip) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
