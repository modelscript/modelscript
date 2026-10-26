// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SimaCommand } from "../src/commands/sima.js";

const SAMPLE_SIMO_DECK = `! SIMO / RIFLEX Benchmark: OC4 Semi-Submersible Floating Offshore Wind
SYS 200.0 1025.0 9.81
BODY semi_hull OC4_Semi 13444000 13989 0.0 0.0 -13.46 32.0 32.0 34.0 4.5 5.0
FAIRLEAD fl_1 semi_hull 40.868 0.0 -14.0
FAIRLEAD fl_2 semi_hull -20.434 35.393 -14.0
FAIRLEAD fl_3 semi_hull -20.434 -35.393 -14.0

CRS chain_type 0.137 385.5 3200 1.25e9 1.0e5 1.8e7 1.2 2.0
LINE line_1 catenary fl_1 837.6 0.0 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_2 catenary fl_2 -418.8 725.4 -200.0
SEGM chain_type 835.5 1.8e7
LINE line_3 catenary fl_3 -418.8 -725.4 -200.0
SEGM chain_type 835.5 1.8e7

WAVE JONSWAP 8.0 12.5 3.3 0.0
WIND 20.0 0.0
CURR 1.2 0.0
TIME 0.05 3600.0
`;

test("SIMA CLI Commands (msx sima inspect, lint, verify, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_sima_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const inpFile = path.join(tmpDir, "oc4_semi.inp");
  fs.writeFileSync(inpFile, SAMPLE_SIMO_DECK, "utf-8");

  await t.test("msx sima inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimaCommand.handler as any)({
        action: "inspect",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("Water Depth: 200 m")));
      assert.ok(logs.some((l) => l.includes("Vessels (1)")));
      assert.ok(logs.some((l) => l.includes("Mooring Lines (3)")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sima lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimaCommand.handler as any)({
        action: "lint",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("Linting oc4_semi.inp")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sima verify", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SimaCommand.handler as any)({
        action: "verify",
        files: [inpFile],
        "consequence-class": 2,
      });
      assert.ok(logs.some((l) => l.includes("DNV-OS-E301")));
      assert.ok(logs.some((l) => l.includes("line_1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sima to-dae", async () => {
    const outDae = path.join(tmpDir, "sima_dae.json");
    await (SimaCommand.handler as any)({
      action: "to-dae",
      files: [inpFile],
      out: outDae,
    });

    assert.ok(fs.existsSync(outDae));
    const meta = JSON.parse(fs.readFileSync(outDae, "utf-8"));
    assert.ok(meta.varCount > 20);
    assert.ok(meta.eqCount > 15);
  });

  await t.test("msx sima to-modelica", async () => {
    const outMo = path.join(tmpDir, "oc4_semi.mo");
    await (SimaCommand.handler as any)({
      action: "to-modelica",
      files: [inpFile],
      out: outMo,
    });

    assert.ok(fs.existsSync(outMo));
    const content = fs.readFileSync(outMo, "utf-8");
    assert.ok(content.includes("model oc4_semi"));
    assert.ok(content.includes("Real surge"));
  });
});
