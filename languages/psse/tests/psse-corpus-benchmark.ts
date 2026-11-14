// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * On-demand PSS/E Corpus Benchmark Runner (`testsuite/` + `.cache/psse-corpora/`).
 *
 * Usage:
 *   npx tsx languages/psse/tests/psse-corpus-benchmark.ts [--andes] [--dir=<path>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateShortCircuit,
  calculateSotaDiscrepancy,
  ensureBuiltInPsseLibraryRegistered,
  lintPsse,
  parseDyr,
  parseRaw,
  parseSeq,
  simulatePsseTransient,
  solvePowerFlowAsync,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTSUITE_DIR = path.resolve(__dirname, "../testsuite");
const CACHE_DIR = path.resolve(__dirname, "../../../.cache/psse-corpora");

const PUBLIC_CORPORA: Array<{ file: string; url: string }> = [
  {
    file: "andes_ieee39.raw",
    url: "https://raw.githubusercontent.com/CURENT/andes/master/andes/cases/ieee39/ieee39.raw",
  },
  {
    file: "andes_kundur.raw",
    url: "https://raw.githubusercontent.com/CURENT/andes/master/andes/cases/kundur/kundur.raw",
  },
  {
    file: "andes_kundur.dyr",
    url: "https://raw.githubusercontent.com/CURENT/andes/master/andes/cases/kundur/kundur_full.dyr",
  },
  {
    file: "powsybl_ieee14_v35.raw",
    url: "https://raw.githubusercontent.com/powsybl/powsybl-core/main/psse/psse-model/src/test/resources/IEEE_14_bus_completed_rev35.raw",
  },
];

async function fetchPublicCorpora(): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (const item of PUBLIC_CORPORA) {
    const dest = path.join(CACHE_DIR, item.file);
    if (fs.existsSync(dest)) continue;
    try {
      const resp = await fetch(item.url);
      if (!resp.ok) {
        console.warn(`[fetch] HTTP ${resp.status} for ${item.url}`);
        continue;
      }
      const text = await resp.text();
      fs.writeFileSync(dest, text, "utf-8");
      console.log(`[fetch] Cached ${item.file} (${text.length} bytes)`);
    } catch (err) {
      console.warn(`[fetch] Failed ${item.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useAndes = args.includes("--andes");
  const shouldFetch = args.includes("--fetch");
  if (shouldFetch) {
    await fetchPublicCorpora();
  }
  const dirArg = args.find((a) => a.startsWith("--dir="))?.slice("--dir=".length);
  const dirs = [TESTSUITE_DIR];
  if (dirArg) dirs.push(path.resolve(dirArg));
  if (fs.existsSync(CACHE_DIR)) dirs.push(CACHE_DIR);

  await ensureBuiltInPsseLibraryRegistered();

  console.log("Case                 | Buses | Parse(ms) | LintErr | PF Iter | MaxΔV(pu) | Trans(ms) | Status");
  console.log("---------------------+-------+-----------+---------+---------+-----------+-----------+--------");

  for (const dir of dirs) {
    const rawFiles = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".raw"))
      .sort();

    for (const rawFile of rawFiles) {
      const rawPath = path.join(dir, rawFile);
      const t0 = performance.now();
      const parsed = parseRaw(fs.readFileSync(rawPath, "utf-8"));
      const dyrPath = rawPath.replace(/\.raw$/i, ".dyr");
      if (fs.existsSync(dyrPath)) {
        parsed.dyr = parseDyr(fs.readFileSync(dyrPath, "utf-8"));
      }
      const parseMs = performance.now() - t0;

      const lintErrs = lintPsse(parsed).filter((d) => d.severity === "error").length;
      const pf = await solvePowerFlowAsync(parsed, { maxIterations: 30, tolerance: 1e-4 });

      let maxDv = 0;
      for (const b of pf.buses) {
        const refBus = parsed.buses.get(b.busNumber);
        if (refBus) maxDv = Math.max(maxDv, Math.abs(b.vm - refBus.vm));
      }

      const seqPath = rawPath.replace(/\.raw$/i, ".seq");
      if (fs.existsSync(seqPath)) {
        const seqCase = parseSeq(fs.readFileSync(seqPath, "utf-8"));
        calculateShortCircuit(parsed, { seq: seqCase });
      }

      const tSim0 = performance.now();
      const sim = simulatePsseTransient(parsed, {
        stopTime: useAndes ? 1.0 : 0.4,
        timeStep: useAndes ? 0.01 : 0.02,
        ...(useAndes ? { faultSusceptancePu: 0 } : {}),
      });
      const simMs = performance.now() - tSim0;

      let andesStatus = "";
      if (useAndes && fs.existsSync(dyrPath)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const outCsv = path.join(CACHE_DIR, `${rawFile}.andes.csv`);
        try {
          const cacheVenvPython = path.resolve(__dirname, "../../../.cache/andes-venv/bin/python");
          const venvPython = path.resolve(__dirname, "../../../.venv/bin/python");
          const pythonBin = fs.existsSync(cacheVenvPython)
            ? cacheVenvPython
            : fs.existsSync(venvPython)
              ? venvPython
              : "python3";
          execFileSync(pythonBin, [path.join(__dirname, "andes-ref-runner.py"), rawPath, dyrPath, outCsv], {
            stdio: "pipe",
          });
          if (fs.existsSync(outCsv)) {
            const lines = fs.readFileSync(outCsv, "utf-8").trim().split(/\r?\n/);
            const headers = lines[0]!.split(",");
            const rows = lines.slice(1).map((l) => l.split(",").map(Number));
            const col1 = headers[1]?.trim();
            const busId = col1?.replace(/^vt_/, "");
            const simSeries = col1
              ? (sim.variables[col1] ?? (busId ? sim.variables[`Vm_Bus${busId}_pu`] : undefined))
              : undefined;
            if (simSeries && rows.length > 0) {
              const n = Math.min(simSeries.length, rows.length);
              const m = calculateSotaDiscrepancy(
                new Float64Array(simSeries.slice(0, n)),
                new Float64Array(rows.slice(0, n).map((r) => r[1]!)),
              );
              andesStatus = ` ANDES:${m.nrmsePercent.toFixed(2)}%`;
            }
          }
        } catch (err) {
          const stderr = (err as { stderr?: Buffer })?.stderr?.toString("utf-8") ?? "";
          const tag = stderr.includes("Length mismatch")
            ? "dyr-cols"
            : stderr.includes("IndexError")
              ? "raw-fmt"
              : "err";
          andesStatus = ` ANDES:skip(${tag})`;
        }
      }

      const ok = lintErrs === 0 && pf.converged && sim.t.length >= 10;
      console.log(
        `${rawFile.padEnd(20)} | ${String(parsed.buses.size).padStart(5)} | ${parseMs
          .toFixed(1)
          .padStart(9)} | ${String(lintErrs).padStart(7)} | ${String(pf.iterations).padStart(7)} | ${maxDv
          .toExponential(1)
          .padStart(9)} | ${simMs.toFixed(1).padStart(9)} | ${ok ? "PASS" : "FAIL"}${andesStatus}`,
      );
    }
  }
}

void main();
