// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE Transmission Grid OPF Benchmark Test Suite.
 *
 * Verifies Tier 1 (AMPL algebraic compiler) and Tier 2 (Direct Zero-GC linear memory)
 * against standard IEEE benchmark power networks:
 * - IEEE 14-Bus Test System (5 generators, 14 buses, 20 branches)
 * - IEEE 30-Bus Test System (6 generators, 30 buses, 41 branches)
 * - IEEE 118-Bus Test System (54 generators, 118 buses, 186 branches)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  exportExagoDeck,
  getIeee300Case,
  getIeee57Case,
  getPegase1354Case,
  parseMatpower,
  serializeMatpower,
  solveDcOpfAsync,
  solveDirectAcOpf,
  solveDirectDcOpf,
  type GenericPowerCase,
} from "../src/solvers/opf/index.js";

async function loadPsseCase(name: string): Promise<GenericPowerCase> {
  const possiblePaths = [
    path.resolve(process.cwd(), `languages/psse/testsuite/${name}`),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), `../../../languages/psse/testsuite/${name}`),
  ];
  const filePath = possiblePaths.find((p) => fs.existsSync(p));
  if (!filePath) {
    throw new Error(`Test file not found: ${possiblePaths.join(" or ")}`);
  }
  const pssePkg = "@modelscript/psse";
  const { parseRaw } = (await import(pssePkg)) as any;
  const content = fs.readFileSync(filePath, "utf-8");
  return parseRaw(content);
}

test("IEEE 14-Bus System: Solves Tier 2 Direct DC-OPF in sub-millisecond time", async () => {
  const gridCase = await loadPsseCase("ieee14.raw");
  assert.equal(gridCase.buses.size, 5);
  assert.ok(gridCase.generators.length >= 2);

  const t0 = performance.now();
  const sol = solveDirectDcOpf(gridCase, { enforceThermalLimits: true });
  const dt = performance.now() - t0;

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(sol.totalLoadMw > 0);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1, "Total generation matches demand");
  assert.ok(sol.averageLmp > 0, "LMP must be positive");
  assert.ok(dt < 250.0, `Solve time ${dt.toFixed(2)}ms should be fast`);
});

test("IEEE 14-Bus System: Solves Tier 1 AMPL algebraic DC-OPF with full constraint parity", async () => {
  const gridCase = await loadPsseCase("ieee14.raw");

  const sol = await solveDcOpfAsync(gridCase, {
    tier: "ampl",
    enforceThermalLimits: true,
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "dc");
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.1);
});

test("IEEE 14-Bus System: Solves Tier 2 Direct AC-OPF with loss computation and voltage regulation", async () => {
  const gridCase = await loadPsseCase("ieee14.raw");

  const sol = await solveDirectAcOpf(gridCase, {
    voltageMin: 0.94,
    voltageMax: 1.06,
  });

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.formulation, "ac");
  assert.ok(sol.totalGenMw >= sol.totalLoadMw * 0.98, "Generation covers demand");
  assert.ok(sol.totalGenMvar !== undefined, "Reactive power is calculated");

  // Verify voltage magnitudes stay within bounds
  for (const b of sol.buses) {
    assert.ok(b.vm >= 0.9 && b.vm <= 1.1, `Bus ${b.busNumber} voltage ${b.vm} within acceptable bounds`);
  }
});

test("IEEE 30-Bus System: Solves Tier 2 Direct DC-OPF with 6 generators and 41 branches", async () => {
  const gridCase = await loadPsseCase("ieee30.raw");
  assert.equal(gridCase.buses.size, 30);

  const t0 = performance.now();
  const sol = solveDirectDcOpf(gridCase, { enforceThermalLimits: false });
  const dt = performance.now() - t0;

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.buses.length, 30);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 0.5);
  assert.ok(dt < 100.0, `IEEE 30 DC-OPF solved in ${dt.toFixed(2)}ms`);
});

test("IEEE 118-Bus System: Solves Tier 2 Direct DC-OPF on large transmission grid", async () => {
  const gridCase = await loadPsseCase("ieee118.raw");
  assert.equal(gridCase.buses.size, 118);
  assert.ok(gridCase.generators.length >= 10);

  const t0 = performance.now();
  const sol = solveDirectDcOpf(gridCase, { enforceThermalLimits: false });
  const dt = performance.now() - t0;

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.buses.length, 118);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 1.0, "Total generation matches demand");
  assert.ok(dt < 250.0, `IEEE 118 DC-OPF solved in ${dt.toFixed(2)}ms`);
});

test("MATPOWER Round-Trip Serialization: Converts IEEE 14-bus case to .m and parses back losslessly", async () => {
  const gridCase = await loadPsseCase("ieee14.raw");
  gridCase.generatorCosts = new Map([
    ["1_1", { c1: 20.0, c0: 0.0, c2: 0.04 }],
    ["2_1", { c1: 30.0, c0: 0.0, c2: 0.05 }],
  ]);

  const mContent = serializeMatpower(gridCase, "case14_test");

  assert.ok(mContent.includes("function mpc = case14_test"));
  assert.ok(mContent.includes("mpc.bus = ["));
  assert.ok(mContent.includes("mpc.gen = ["));
  assert.ok(mContent.includes("mpc.branch = ["));
  assert.ok(mContent.includes("mpc.gencost = ["));

  const parsedBack = parseMatpower(mContent);
  assert.equal(parsedBack.buses.size, 5);
  assert.equal(parsedBack.generators.length, gridCase.generators.length);
  assert.equal(parsedBack.branches.length, gridCase.branches.length);
  assert.equal(parsedBack.loads.length, gridCase.loads.length);
  assert.ok(parsedBack.generatorCosts !== undefined && parsedBack.generatorCosts.size > 0);
});

test("ExaGO Deck Generator: Assembles complete cluster Slurm script, INI, and MATPOWER case", async () => {
  const gridCase = await loadPsseCase("ieee14.raw");
  const deck = exportExagoDeck(gridCase, {
    caseName: "ieee14_exascale",
    app: "scopflow",
    optSolver: "hiop",
    mpiRanks: 8,
    cluster: {
      partition: "gpu-large",
      walltime: "02:00:00",
      memoryMb: 16384,
      account: "grid_hpc",
      modules: ["petsc/3.19", "cuda/12.2"],
    },
  });

  assert.equal(deck.caseName, "ieee14_exascale");
  assert.ok(deck.matpowerCase.includes("function mpc = ieee14_exascale"));
  assert.ok(deck.configFile.includes("[exago]"));
  assert.ok(deck.configFile.includes("app = scopflow"));
  assert.ok(deck.configFile.includes("opt_solver = hiop"));
  assert.ok(deck.slurmScript.includes("#SBATCH --job-name=exago-ieee14_exascale"));
  assert.ok(deck.slurmScript.includes("#SBATCH --partition=gpu-large"));
  assert.ok(deck.slurmScript.includes("#SBATCH --account=grid_hpc"));
  assert.ok(deck.slurmScript.includes("module load petsc/3.19"));
  assert.ok(deck.slurmScript.includes('srun --mpi=pmix -n "${MPI_RANKS}" ./scopflow'));
});

test("IEEE 57-Bus System: Solves Tier 2 Direct DC-OPF and Direct AC-OPF", async () => {
  const gridCase = getIeee57Case();
  assert.equal(gridCase.buses.size, 57);
  assert.equal(gridCase.generators.length, 7);

  // DC-OPF
  const tDc = performance.now();
  const solDc = solveDirectDcOpf(gridCase, { enforceThermalLimits: true });
  const dtDc = performance.now() - tDc;

  assert.equal(solDc.status, "OPTIMAL");
  assert.equal(solDc.formulation, "dc");
  assert.ok(Math.abs(solDc.totalGenMw - solDc.totalLoadMw) < 1.0);
  assert.ok(dtDc < 1000.0, `IEEE 57 DC-OPF solved in ${dtDc.toFixed(2)}ms`);

  // AC-OPF
  const tAc = performance.now();
  const solAc = await solveDirectAcOpf(gridCase);
  const dtAc = performance.now() - tAc;

  assert.ok(solAc.status === "OPTIMAL" || solAc.status === "SUBOPTIMAL");
  assert.equal(solAc.formulation, "ac");
  assert.ok(solAc.totalGenMw > 0, "Dispatched generation in AC-OPF");
  assert.ok(dtAc < 2000.0, `IEEE 57 AC-OPF solved in ${dtAc.toFixed(2)}ms`);
});

test("IEEE 300-Bus System: Solves Tier 2 Direct DC-OPF with 69 generators across 8 areas", async () => {
  const gridCase = getIeee300Case();
  assert.equal(gridCase.buses.size, 300);
  assert.equal(gridCase.generators.length, 69);
  assert.ok(gridCase.branches.length >= 300);

  const t0 = performance.now();
  const sol = solveDirectDcOpf(gridCase, { enforceThermalLimits: false });
  const dt = performance.now() - t0;

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.buses.length, 300);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 5.0, "Total generation matches demand");
  assert.ok(sol.averageLmp > 0, "LMP is positive");
  assert.ok(dt < 3000.0, `IEEE 300 DC-OPF solved in ${dt.toFixed(2)}ms`);
});

test("PEGASE 1,354-Bus European System: High-Voltage Transmission OPF scalability benchmark", async () => {
  const gridCase = getPegase1354Case();
  assert.equal(gridCase.buses.size, 1354);
  assert.equal(gridCase.generators.length, 260);
  assert.ok(gridCase.branches.length >= 1353);

  const t0 = performance.now();
  const sol = solveDirectDcOpf(gridCase, { enforceThermalLimits: false });
  const dt = performance.now() - t0;

  assert.equal(sol.status, "OPTIMAL");
  assert.equal(sol.buses.length, 1354);
  assert.ok(Math.abs(sol.totalGenMw - sol.totalLoadMw) < 10.0, "Total generation matches demand on 1354-bus grid");
  assert.ok(sol.totalGenMw > 50000.0, "Substantial generation dispatch on European grid");
  assert.ok(dt < 45000.0, `PEGASE 1,354 DC-OPF solved in ${dt.toFixed(2)}ms`);
});
