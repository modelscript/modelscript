// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Relap5Command } from "../src/commands/relap5.js";

const CLI_RELAP5_DECK = `100 PWR Primary Circuit CLI Test
101 new transnt
201 10.0 1.0e-5 0.01
1000000 Core pipe
1000101 4.5 3.8 17.1
1000501 1.55e7 580.0
1100000 Plenum branch
1100101 8.0 2.5 20.0
1100501 1.54e7 595.0
1050000 CoreToPlenum snglj
1050101 100 110 4.5
1050102 0.1 0.2
6000000 point 2.0e-5 0.0065 3000.0e6
6000001 0.0124 0.000215
6000002 0.0305 0.001424
6000003 0.1110 0.001274
6000004 0.3010 0.002568
6000005 1.1400 0.000748
6000006 3.0100 0.000271
. end`;

test("RELAP5 CLI Commands (msx relap5 inspect, lint, kinetics, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_relap5_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const deckFile = path.join(tmpDir, "pwr.i");
  fs.writeFileSync(deckFile, CLI_RELAP5_DECK, "utf-8");

  await t.test("msx relap5 inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (Relap5Command.handler as any)({
        action: "inspect",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("RELAP5 Deck Summary")));
      assert.ok(logs.some((l) => l.includes("PWR Primary Circuit CLI Test")));
      assert.ok(logs.some((l) => l.includes("Volumes:        2")));
      assert.ok(logs.some((l) => l.includes("Junctions:      1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx relap5 lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (Relap5Command.handler as any)({
        action: "lint",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("Clean deck: 0 diagnostics")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx relap5 kinetics", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (Relap5Command.handler as any)({
        action: "kinetics",
        files: [deckFile],
        duration: 2.0,
      });
      assert.ok(logs.some((l) => l.includes("Reactor Point Kinetics Simulation")));
      assert.ok(logs.some((l) => l.includes("Initial Power:")));
      assert.ok(logs.some((l) => l.includes("Peak Fuel Temp:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx relap5 to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (Relap5Command.handler as any)({
        action: "to-dae",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("RELAP5 DAE Lowering")));
      assert.ok(logs.some((l) => l.includes("Arena Variables:")));
      assert.ok(logs.some((l) => l.includes("Arena Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx relap5 to-modelica", async () => {
    const moFile = path.join(tmpDir, "pwr.mo");
    await (Relap5Command.handler as any)({
      action: "to-modelica",
      files: [deckFile],
      out: moFile,
    });
    assert.ok(fs.existsSync(moFile));
    const moContent = fs.readFileSync(moFile, "utf-8");
    assert.ok(moContent.includes("model pwr"));
    assert.ok(moContent.includes("P_100"));
    assert.ok(moContent.includes("mf_105"));
  });
});
