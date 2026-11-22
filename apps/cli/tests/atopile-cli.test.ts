// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AtopileLintCommand,
  AtopileNetlistCommand,
  AtopileToIpc2581Command,
  AtopileUqCommand,
} from "../src/commands/atopile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIR = path.resolve(__dirname, ".scratch-atopile-cli");

const SAMPLE_ATO = `
module Filter:
    signal vin
    signal vout
    signal gnd

    r1 = new Resistor
    c1 = new Capacitor
    r1.resistance = 10kohm +/- 1%
    c1.capacitance = 100nF
    assert r1.resistance within 9.8kohm to 10.2kohm

    vin ~> r1 ~> vout
    vout ~> c1 ~> gnd
`;

describe("@modelscript/cli — atopile Subcommands", () => {
  it("runs lint, netlist, and to-ipc2581 end-to-end", async () => {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const atoFile = path.join(SCRATCH_DIR, "filter.ato");
    const ipcFile = path.join(SCRATCH_DIR, "filter.ipc2581.xml");
    fs.writeFileSync(atoFile, SAMPLE_ATO, "utf-8");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      await AtopileLintCommand.handler({ file: atoFile, format: "json", _: [], $0: "msx" });
      const lintOut = JSON.parse(logs.pop()!) as { diagnostics: unknown[] };
      assert.strictEqual(lintOut.diagnostics.length, 0);

      await AtopileNetlistCommand.handler({ file: atoFile, _: [], $0: "msx" });
      const netOut = JSON.parse(logs.pop()!) as { entryModule: string; netlist: { nets: unknown[] } };
      assert.strictEqual(netOut.entryModule, "Filter");
      assert.strictEqual(netOut.netlist.nets.length, 3);

      await AtopileToIpc2581Command.handler({ file: atoFile, out: ipcFile, _: [], $0: "msx" });
      assert(fs.existsSync(ipcFile));
      assert(fs.readFileSync(ipcFile, "utf-8").includes('<LogicalNet name="vout">'));

      await AtopileUqCommand.handler({ file: atoFile, samples: 200, seed: 7, format: "json", _: [], $0: "msx" });
      const uqOut = JSON.parse(logs.pop()!) as { metrics: { name: string }[] };
      assert(uqOut.metrics.some((m) => m.name === "rc_cutoff_freq"));
    } finally {
      console.log = origLog;
      fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
    }
  });
});
