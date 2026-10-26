// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { EpanetCommand } from "../src/commands/epanet.js";

const SAMPLE_INP = `[TITLE]
Small Municipal Water Distribution Network

[JUNCTIONS]
;ID Elevation Demand Pattern
J1 50.0 10.0
J2 45.0 15.0

[RESERVOIRS]
;ID Head Pattern
R1 100.0

[PIPES]
;ID Node1 Node2 Length Diameter Roughness MinorLoss Status
P1 R1 J1 1000.0 200.0 100.0 0.0 Open
P2 J1 J2 500.0 150.0 100.0 0.0 Open

[OPTIONS]
Units LPS
Headloss H-W
`;

test("EPANET CLI Commands (msx epanet inspect, lint, solve, to-modelica, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "languages/epanet/tests/scratch_epanet_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const inpFile = path.join(tmpDir, "network.inp");
  fs.writeFileSync(inpFile, SAMPLE_INP, "utf-8");

  await t.test("msx epanet inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EpanetCommand.handler as any)({
        action: "inspect",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("Small Municipal Water Distribution Network")));
      assert.ok(logs.some((l) => l.includes("Junctions: 2")));
      assert.ok(logs.some((l) => l.includes("Reservoirs: 1")));
      assert.ok(logs.some((l) => l.includes("Pipes: 2")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx epanet lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EpanetCommand.handler as any)({
        action: "lint",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics reported")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx epanet solve", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EpanetCommand.handler as any)({
        action: "solve",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("Todini Global Gradient Hydraulic Solution")));
      assert.ok(logs.some((l) => l.includes("Status: CONVERGED")));
      assert.ok(logs.some((l) => l.includes("Node 'J1'")));
      assert.ok(logs.some((l) => l.includes("Link 'P1'")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx epanet to-modelica", async () => {
    const outFile = path.join(tmpDir, "network.mo");

    await (EpanetCommand.handler as any)({
      action: "to-modelica",
      files: [inpFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("model Small_Municipal_Water_Distribution_Network"));
    assert.ok(content.includes("Modelica.Fluid"));
    assert.ok(content.includes("pipe_P1"));
  });

  await t.test("msx epanet to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (EpanetCommand.handler as any)({
        action: "to-dae",
        files: [inpFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered EPANET water distribution network into linear DAE arena:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
