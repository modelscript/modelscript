// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { VerilogACommand } from "../src/commands/verilog-a.js";

const DIODE_VA = `
module diode(a, c);
  inout a, c;
  electrical a, c;
  parameter real Is = 1e-14 from (0:inf);
  real Vd, Id;
  analog begin
    Vd = V(a, c);
    Id = Is * (limexp(Vd / 0.02585) - 1.0);
    I(a, c) <+ Id;
  end
endmodule
`;

test("Verilog-A CLI Commands (msx verilog-a inspect, lint, to-modelica, to-spice, to-dae)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_verilog_a_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const vaFile = path.join(tmpDir, "diode.va");
  fs.writeFileSync(vaFile, DIODE_VA, "utf-8");

  await t.test("msx verilog-a inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (VerilogACommand.handler as any)({
        action: "inspect",
        files: [vaFile],
      });
      assert.ok(logs.some((l) => l.includes("Verilog-A Module: diode")));
      assert.ok(logs.some((l) => l.includes("Ports (2)")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx verilog-a lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (VerilogACommand.handler as any)({
        action: "lint",
        files: [vaFile],
      });
      assert.ok(logs.some((l) => l.includes("[PASS]") && l.includes("0 diagnostics detected.")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx verilog-a to-modelica", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (VerilogACommand.handler as any)({
        action: "to-modelica",
        files: [vaFile],
      });
      assert.ok(logs.some((l) => l.includes("model diode")));
      assert.ok(logs.some((l) => l.includes("PositivePin a;")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx verilog-a to-spice", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (VerilogACommand.handler as any)({
        action: "to-spice",
        files: [vaFile],
      });
      assert.ok(logs.some((l) => l.includes(".SUBCKT diode a c")));
      assert.ok(logs.some((l) => l.includes(".ENDS diode")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx verilog-a to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (VerilogACommand.handler as any)({
        action: "to-dae",
        files: [vaFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered 'diode' to DAEBuilder:")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
    } finally {
      console.log = origLog;
    }
  });
});
