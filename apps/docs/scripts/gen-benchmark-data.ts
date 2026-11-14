// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates `docs/.vitepress/theme/data/benchmarks.generated.json` from:
//   - testsuite/benchmarks/polyglot-baseline.json (empirical timings, parity & provenance)
//   - packages/exchange/src/catalog/benchmarks.catalog.json (upstream suite metadata)
//   - docs/.vitepress/theme/data/languages.js (documented language ordering)
//
// Usage:
//   npx tsx scripts/gen-benchmark-data.ts           # write output
//   npx tsx scripts/gen-benchmark-data.ts --check   # fail if output is stale

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";

import { getBenchmarkCatalog, type PolyglotBenchmarkBaseline } from "@modelscript/exchange/catalog";
import { LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const docsRoot = path.resolve(here, "../docs");
const baselinePath = path.join(repoRoot, "testsuite/benchmarks/polyglot-baseline.json");
const outPath = path.join(docsRoot, ".vitepress/theme/data/benchmarks.generated.json");

export interface DocsBenchmarkCatalogMeta {
  id: string;
  name: string;
  version: string;
  license: string;
  referenceTool: string;
  metricTarget: string;
  threshold: number;
  description: string;
}

export interface DocsBenchmarksPayload {
  schemaVersion: string;
  provenance: PolyglotBenchmarkBaseline["provenance"];
  aggregate: PolyglotBenchmarkBaseline["aggregate"];
  catalogById: Record<string, DocsBenchmarkCatalogMeta>;
  languages: PolyglotBenchmarkBaseline["languages"];
}

function buildPayload(): DocsBenchmarksPayload {
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Missing ${path.relative(repoRoot, baselinePath)}. Run 'npm run bench:languages:record' first.`);
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as PolyglotBenchmarkBaseline;
  const catalog = getBenchmarkCatalog();
  const catalogById: Record<string, DocsBenchmarkCatalogMeta> = {};

  for (const entry of catalog.benchmarks) {
    catalogById[entry.id] = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      license: entry.license,
      referenceTool: entry.referenceTool,
      metricTarget: entry.parityMetric.targetMetric,
      threshold: entry.parityMetric.threshold,
      description: entry.parityMetric.description,
    };
  }

  const order = new Map(LANGUAGES.map((l, i) => [l.slug, i]));
  const documentedSlugs = new Set(LANGUAGES.map((l) => l.slug));
  const langPagesDir = path.join(docsRoot, "languages");
  if (fs.existsSync(langPagesDir)) {
    for (const f of fs.readdirSync(langPagesDir)) {
      if (f.endsWith(".md") && f !== "overview.md") {
        documentedSlugs.add(f.replace(/\.md$/, ""));
      }
    }
  }

  const languages = baseline.languages
    .filter((l) => documentedSlugs.has(l.slug))
    .sort((a, b) => (order.get(a.slug) ?? 999) - (order.get(b.slug) ?? 999));

  return {
    schemaVersion: baseline.schemaVersion,
    provenance: baseline.provenance,
    aggregate: baseline.aggregate,
    catalogById,
    languages,
  };
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const payload = buildPayload();
  const formatted = await prettier.format(JSON.stringify(payload, null, 2), { parser: "json" });

  if (check) {
    const existing = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf8") : "";
    if (existing !== formatted) {
      console.error(
        `[gen-benchmark-data] ${path.relative(repoRoot, outPath)} is out of date. Run 'npm run gen:benchmarks --workspace=@modelscript/docs'.`,
      );
      process.exit(1);
    }
    console.log(`[gen-benchmark-data] OK (${payload.languages.length} languages in sync).`);
    return;
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, formatted, "utf8");
  console.log(
    `[gen-benchmark-data] Wrote ${path.relative(repoRoot, outPath)} (${payload.languages.length} languages).`,
  );
}

main();
