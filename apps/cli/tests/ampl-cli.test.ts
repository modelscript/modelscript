// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AmplCommand } from "../src/commands/ampl.js";

const TEST_AMPL_MOD = `
set PRODUCTS;
param Rate{PRODUCTS} >= 0;
param Profit{PRODUCTS} >= 0;
param AvailableHours >= 0;

var Make{p in PRODUCTS} >= 0;

maximize TotalProfit:
  sum{p in PRODUCTS} Profit[p] * Make[p];

subject to ProductionCapacity:
  sum{p in PRODUCTS} (1 / Rate[p]) * Make[p] <= AvailableHours;
`;

const TEST_AMPL_DAT = `
set PRODUCTS := bands coils;

param Rate :=
  bands 200
  coils 140;

param Profit :=
  bands 25
  coils 30;

param AvailableHours := 40;
`;

test("AMPL CLI Commands (msx ampl inspect, lint, solve, to-nl, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_ampl_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const modFile = path.join(tmpDir, "prod.mod");
  const datFile = path.join(tmpDir, "prod.dat");
  fs.writeFileSync(modFile, TEST_AMPL_MOD, "utf-8");
  fs.writeFileSync(datFile, TEST_AMPL_DAT, "utf-8");

  await t.test("msx ampl inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "inspect",
        files: [modFile, datFile],
      });
      assert.ok(logs.some((l) => l.includes("AMPL Mathematical Program: prod.mod")));
      assert.ok(logs.some((l) => l.includes("Sets:        1")));
      assert.ok(logs.some((l) => l.includes("Variables:   1")));
      assert.ok(logs.some((l) => l.includes("LP")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "lint",
        files: [modFile, datFile],
      });
      assert.ok(logs.some((l) => l.includes("No syntax or algebraic specification defects found")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl solve", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "solve",
        files: [modFile, datFile],
      });
      assert.ok(logs.some((l) => l.includes("OPTIMAL")));
      assert.ok(logs.some((l) => l.includes("TotalProfit")));
      assert.ok(logs.some((l) => l.includes("Make[bands]")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl solve --format json", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "solve",
        files: [modFile, datFile],
        format: "json",
      });
      const parsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(parsed.status, "OPTIMAL");
      assert.strictEqual(parsed.classification, "LP");
      assert.ok(parsed.objectiveValue > 0);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl to-nl", async () => {
    const outFile = path.join(tmpDir, "model.nl");
    await (AmplCommand.handler as any)({
      action: "to-nl",
      files: [modFile, datFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const nlText = fs.readFileSync(outFile, "utf-8");
    assert.ok(nlText.startsWith("g3 0 1 0"));
    assert.ok(nlText.includes("O0 1"));
  });

  await t.test("msx ampl to-nl --binary", async () => {
    const outFile = path.join(tmpDir, "model_bin.nl");
    await (AmplCommand.handler as any)({
      action: "to-nl",
      files: [modFile, datFile],
      binary: true,
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const nlBuf = fs.readFileSync(outFile);
    assert.ok(nlBuf.toString("latin1").startsWith("b3 0 1 0"));
  });

  await t.test("msx ampl to-dae", async () => {
    const outFile = path.join(tmpDir, "model.dae");
    await (AmplCommand.handler as any)({
      action: "to-dae",
      files: [modFile, datFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const daeText = fs.readFileSync(outFile, "utf-8");
    assert.ok(daeText.includes("class TotalProfit"));
  });

  await t.test("msx ampl to-modelica", async () => {
    const outFile = path.join(tmpDir, "model.mo");
    await (AmplCommand.handler as any)({
      action: "to-modelica",
      files: [modFile, datFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const moText = fs.readFileSync(outFile, "utf-8");
    assert.ok(moText.includes("model TotalProfit"));
    assert.ok(moText.includes("Real Make_bands"));
  });

  await t.test("msx ampl to-mps", async () => {
    const outFile = path.join(tmpDir, "model.mps");
    await (AmplCommand.handler as any)({
      action: "to-mps",
      files: [modFile, datFile],
      out: outFile,
    });
    assert.ok(fs.existsSync(outFile));
    const mpsText = fs.readFileSync(outFile, "utf-8");
    assert.ok(mpsText.includes("NAME"));
    assert.ok(mpsText.includes("ROWS"));
    assert.ok(mpsText.includes("COLUMNS"));
    assert.ok(mpsText.includes("ENDATA"));
  });

  await t.test("msx ampl solve <problem.mps>", async () => {
    const mpsFile = path.join(tmpDir, "model.mps");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "solve",
        files: [mpsFile],
      });
      assert.ok(logs.some((l) => l.includes("OPTIMAL")));
      assert.ok(logs.some((l) => l.includes("Make[bands]")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl solve --solver=cplex graceful rejection", async () => {
    await assert.rejects(
      async () => {
        await (AmplCommand.handler as any)({
          action: "solve",
          files: [modFile, datFile],
          solver: "cplex",
        });
      },
      /External solver 'cplex' was not found on PATH/,
    );
  });

  await t.test("msx ampl solve --presolve --format json", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "solve",
        files: [modFile, datFile],
        presolve: true,
        format: "json",
      });
      const parsed = JSON.parse(logs.join("\n"));
      assert.strictEqual(parsed.status, "OPTIMAL");
      assert.ok(parsed.duals !== undefined);
      assert.ok(parsed.reducedCosts !== undefined);
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx ampl run <script.run>", async () => {
    const runFile = path.join(tmpDir, "sweep.run");
    fs.writeFileSync(
      runFile,
      [
        "model prod.mod;",
        "data prod.dat;",
        "solve;",
        'printf "OptimalProfit=%.1f\\n", TotalProfit;',
      ].join("\n"),
      "utf-8",
    );

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (AmplCommand.handler as any)({
        action: "run",
        files: [runFile],
      });
      assert.ok(logs.some((l) => l.includes("OptimalProfit=200000.0")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
