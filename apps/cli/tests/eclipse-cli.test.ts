// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { EclipseCommand } from "../src/commands/eclipse.js";

const CLI_ECLIPSE_DECK = `RUNSPEC
TITLE
  Brent Reservoir Study CLI Test
/

DIMENS
  10 10 3 /

FIELD

OIL
WATER

START
  1 'JAN' 2025 /

GRID
DX
  300*120.0 /
DY
  300*120.0 /
DZ
  300*25.0 /
TOPS
  100*7800.0 /
PORO
  300*0.24 /
PERMX
  300*180.0 /
PERMY
  300*180.0 /
PERMZ
  300*40.0 /

PROPS
DENSITY
  51.0 62.4 0.055 /

PVDO
  1000.0 1.12 1.40
  2000.0 1.18 1.25
  3000.0 1.24 1.10 /

SWOF
  0.20 0.00 0.90 5.0
  0.50 0.18 0.35 1.5
  0.80 0.75 0.00 0.0 /

SOLUTION
PRESSURE
  300*3900.0 /

SCHEDULE
WELSPECS
  'PROD_CLI' 'G1' 2 3 7900.0 'OIL' /
/

COMPDAT
  'PROD_CLI' 2 3 1 3 'OPEN' 1* 15.0 0.5 /
/

WCONPROD
  'PROD_CLI' 'OPEN' 'ORAT' 2200.0 1* 1* 1* 1900.0 /
/

TSTEP
  30.0 60.0 90.0 /

END
`;

test("ECLIPSE CLI Commands (msx eclipse inspect, lint, solve, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_eclipse_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const deckFile = path.join(tmpDir, "brent.data");
  fs.writeFileSync(deckFile, CLI_ECLIPSE_DECK, "utf-8");

  await t.test("msx eclipse inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EclipseCommand.handler as any)({
        action: "inspect",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("ECLIPSE Reservoir Deck Summary")));
      assert.ok(logs.some((l) => l.includes("Brent Reservoir Study CLI Test")));
      assert.ok(logs.some((l) => l.includes("10 x 10 x 3")));
      assert.ok(logs.some((l) => l.includes("PROD_CLI")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx eclipse lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EclipseCommand.handler as any)({
        action: "lint",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("passed all pre-flight checks")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx eclipse solve", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EclipseCommand.handler as any)({
        action: "solve",
        files: [deckFile],
        days: 90.0,
      });
      assert.ok(logs.some((l) => l.includes("ECLIPSE Reservoir Depletion Results")));
      assert.ok(logs.some((l) => l.includes("STOIIP:")));
      assert.ok(logs.some((l) => l.includes("Cum Oil Produced:")));
      assert.ok(logs.some((l) => l.includes("Recovery Factor:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx eclipse to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EclipseCommand.handler as any)({
        action: "to-dae",
        files: [deckFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered DAE Summary")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx eclipse to-modelica", async () => {
    const outFile = path.join(tmpDir, "brent.mo");

    await (EclipseCommand.handler as any)({
      action: "to-modelica",
      files: [deckFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const mo = fs.readFileSync(outFile, "utf-8");
    assert.ok(mo.includes("model brent"));
    assert.ok(mo.includes("P_avg"));
    assert.ok(mo.includes("der(Np) = Q_oil_total;"));
    assert.ok(mo.includes("end brent;"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
