// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AdamsCommand } from "../src/commands/adams.js";

const FOUR_BAR_DECK = `! Four Bar Linkage
ADAMS/
PART/1, GROUND
PART/2, MASS = 2.0, IP = 0.05, 0.05, 0.05
PART/3, MASS = 3.0, IP = 0.10, 0.10, 0.10
PART/4, MASS = 2.5, IP = 0.08, 0.08, 0.08
MARKER/1, PART = 1, QP = 0, 0, 0
MARKER/2, PART = 2, QP = 0, 0, 0
MARKER/3, PART = 2, QP = 1, 0, 0
MARKER/4, PART = 3, QP = 1, 0, 0
MARKER/5, PART = 3, QP = 2, 0, 0
MARKER/6, PART = 4, QP = 2, 0, 0
MARKER/7, PART = 4, QP = 0, 0, 0
MARKER/8, PART = 1, QP = 0, 0, 0
JOINT/1, REVOLUTE, I = 1, J = 2
JOINT/2, REVOLUTE, I = 3, J = 4
JOINT/3, REVOLUTE, I = 5, J = 6
JOINT/4, REVOLUTE, I = 7, J = 8
SPRINGDAMPER/1, TRANSLATIONAL, I = 3, J = 5, K = 1500, C = 50
SIMULATE/DYNAMIC, END = 1.0, DTOUT = 0.01
END
`;

test("MSC Adams CLI Commands (msx adams lint, mobility, to-modelica, to-simpack, simulate)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_adams_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const deckFile = path.join(tmpDir, "four_bar.adm");
  fs.writeFileSync(deckFile, FOUR_BAR_DECK, "utf-8");

  await t.test("msx adams lint and mobility", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // 1. Lint
      await (AdamsCommand.handler as any)({
        action: "lint",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("four_bar.adm")));

      // 2. Mobility
      logs.length = 0;
      await (AdamsCommand.handler as any)({
        action: "mobility",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("Grübler-Kutzbach Mobility Analysis")));
      assert.ok(logs.some((l) => l.includes("Moving Rigid Bodies")));
      assert.ok(logs.some((l) => l.includes("Total Joint Constraints")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx adams to-modelica export", async () => {
    const moOut = path.join(tmpDir, "four_bar.mo");
    await (AdamsCommand.handler as any)({
      action: "to-modelica",
      files: [deckFile],
      out: moOut,
    });

    assert.ok(fs.existsSync(moOut));
    const content = fs.readFileSync(moOut, "utf-8");
    assert.ok(content.includes("model four_bar"));
    assert.ok(content.includes("MultiBody.World world"));
  });

  await t.test("msx adams to-simpack export", async () => {
    const spckOut = path.join(tmpDir, "four_bar_spck.json");
    await (AdamsCommand.handler as any)({
      action: "to-simpack",
      files: [deckFile],
      out: spckOut,
    });

    assert.ok(fs.existsSync(spckOut));
    const content = fs.readFileSync(spckOut, "utf-8");
    const json = JSON.parse(content);
    assert.ok(json.bodies);
    assert.ok(json.joints);
  });

  await t.test("msx adams dynamic simulation", async () => {
    const csvOut = path.join(tmpDir, "trajectory.csv");
    await (AdamsCommand.handler as any)({
      action: "simulate",
      files: [deckFile],
      "stop-time": 0.1,
      step: 0.01,
      out: csvOut,
    });

    assert.ok(fs.existsSync(csvOut));
    const lines = fs.readFileSync(csvOut, "utf-8").trim().split("\n");
    assert.ok(lines.length > 2);
  });

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
