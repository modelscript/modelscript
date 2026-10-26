// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { CCommand } from "../src/commands/c.js";

const CLI_SAMPLE_HEADER = `
struct FilterState {
  double x;
  double y;
};

extern double filter_step(double u, const struct FilterState* s);
`;

const CLI_SAMPLE_C = `
dx[0] = -2.0 * x[0] + 1.0;
y = x[0] * 5.0;
`;

describe("C CLI Commands (msx c inspect, lint, to-dae, to-modelica, step)", () => {
  const tmpDir = path.join(os.tmpdir(), "modelscript_c_cli_test_" + Date.now());

  test("msx c inspect / summary", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const headerPath = path.join(tmpDir, "filter.h");
    fs.writeFileSync(headerPath, CLI_SAMPLE_HEADER, "utf-8");

    let logged = "";
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logged += args.join(" ") + "\n";
    };

    try {
      await CCommand.handler({
        action: "inspect",
        files: [headerPath],
        $0: "msx",
        _: ["c"],
      } as any);
      assert.ok(logged.includes("Functions: 1"));
      assert.ok(logged.includes("Structs: 1"));
      assert.ok(logged.includes("FilterState"));
    } finally {
      console.log = origLog;
    }
  });

  test("msx c lint", async () => {
    const cFile = path.join(tmpDir, "bad.c");
    fs.writeFileSync(cFile, "double x = 10.0 / 0.0;\n", "utf-8");

    let logged = "";
    const origLog = console.log;
    const origExitCode = process.exitCode;
    process.exitCode = 0;
    console.log = (...args: any[]) => {
      logged += args.join(" ") + "\n";
    };

    try {
      await CCommand.handler({
        action: "lint",
        files: [cFile],
        $0: "msx",
        _: ["c"],
      } as any);
      assert.ok(logged.includes("M8402/constant-division-by-zero"));
    } finally {
      console.log = origLog;
      process.exitCode = origExitCode;
    }
  });

  test("msx c to-modelica", async () => {
    const headerPath = path.join(tmpDir, "filter.h");
    const outMo = path.join(tmpDir, "filter.mo");

    await CCommand.handler({
      action: "to-modelica",
      files: [headerPath],
      out: outMo,
      $0: "msx",
      _: ["c"],
    } as any);

    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("function filter_step"));
    assert.ok(content.includes('external "C"'));
    assert.ok(content.includes("record FilterState"));
  });

  test("msx c to-dae", async () => {
    const cFile = path.join(tmpDir, "model.c");
    fs.writeFileSync(cFile, CLI_SAMPLE_C, "utf-8");

    let logged = "";
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logged += args.join(" ") + "\n";
    };

    try {
      await CCommand.handler({
        action: "to-dae",
        files: [cFile],
        $0: "msx",
        _: ["c"],
      } as any);
      assert.ok(logged.includes("2 equations"));
      assert.ok(logged.includes("1 state variables"));
    } finally {
      console.log = origLog;
    }
  });

  test("msx c step", async () => {
    const cFile = path.join(tmpDir, "step.c");
    fs.writeFileSync(cFile, "$Out = $In * 2.0;\n", "utf-8");

    let logged = "";
    const origLog = console.log;
    console.log = (...args: any[]) => {
      logged += args.join(" ") + "\n";
    };

    try {
      await CCommand.handler({
        action: "step",
        files: [cFile],
        $0: "msx",
        _: ["c"],
      } as any);
      assert.ok(logged.includes("Referenced ports: In"));
      assert.ok(logged.includes("Assigned ports: Out"));
    } finally {
      console.log = origLog;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
