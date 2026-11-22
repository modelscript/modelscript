// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  KiCadFromIpc2581Command,
  KiCadLintCommand,
  KiCadParasiticsCommand,
  KiCadToIdxCommand,
  KiCadToIpc2581Command,
  KiCadToSpecctraCommand,
} from "../src/commands/kicad.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRATCH_DIR = path.resolve(__dirname, ".scratch-kicad-cli");

const SAMPLE_PCB = `(kicad_pcb
  (version 20240108)
  (setup
    (stackup
      (layer "F.Cu" (type "copper") (thickness 0.035))
      (layer "dielectric 1" (type "prepreg") (thickness 0.2) (material "FR4") (epsilon_r 4.3))
      (layer "B.Cu" (type "copper") (thickness 0.035))
    )
  )
  (net 0 "")
  (net 1 "RF_OUT")
  (footprint "Resistor_SMD:R_0603" (layer "F.Cu") (at 10 10)
    (property "Reference" "R1") (property "Value" "50")
    (pad "1" smd rect (at -0.8 0) (size 0.9 0.9) (layers "F.Cu") (net 1 "RF_OUT"))
  )
  (gr_rect (start 0 0) (end 40 30) (layer "Edge.Cuts") (width 0.1))
  (segment (start 9.2 10) (end 30 10) (width 0.35) (layer "F.Cu") (net 1))
)`;

describe("@modelscript/cli — KiCad ECAD Subcommands", () => {
  it("runs lint, parasitics, to-ipc2581, and from-ipc2581 end-to-end", async () => {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const pcbFile = path.join(SCRATCH_DIR, "board.kicad_pcb");
    const ipcFile = path.join(SCRATCH_DIR, "board.ipc2581.xml");
    const roundTripFile = path.join(SCRATCH_DIR, "roundtrip.kicad_pcb");
    fs.writeFileSync(pcbFile, SAMPLE_PCB, "utf-8");

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));

    try {
      await KiCadLintCommand.handler({ file: pcbFile, format: "json", _: [], $0: "msx" });
      const lintOut = JSON.parse(logs.pop()!) as { kind: string; diagnostics: unknown[] };
      assert.strictEqual(lintOut.kind, "kicad_pcb");
      assert.strictEqual(lintOut.diagnostics.length, 0);

      await KiCadParasiticsCommand.handler({ file: pcbFile, tempRise: 10, format: "json", _: [], $0: "msx" });
      const paraOut = JSON.parse(logs.pop()!) as { nets: Record<string, { totalLengthMm: number }> };
      assert(paraOut.nets.RF_OUT!.totalLengthMm > 20);

      await KiCadToIpc2581Command.handler({ file: pcbFile, out: ipcFile, _: [], $0: "msx" });
      assert(fs.existsSync(ipcFile));
      assert(fs.readFileSync(ipcFile, "utf-8").includes("<IPC-2581"));

      await KiCadFromIpc2581Command.handler({ file: ipcFile, out: roundTripFile, _: [], $0: "msx" });
      assert(fs.existsSync(roundTripFile));
      assert(fs.readFileSync(roundTripFile, "utf-8").includes("(kicad_pcb"));

      const idxFile = path.join(SCRATCH_DIR, "board.idx");
      await KiCadToIdxCommand.handler({ file: pcbFile, out: idxFile, _: [], $0: "msx" });
      assert(fs.existsSync(idxFile));
      assert(fs.readFileSync(idxFile, "utf-8").includes("<EDMDDataSet"));

      const dsnFile = path.join(SCRATCH_DIR, "board.dsn");
      await KiCadToSpecctraCommand.handler({ file: pcbFile, out: dsnFile, _: [], $0: "msx" });
      assert(fs.existsSync(dsnFile));
      assert(fs.readFileSync(dsnFile, "utf-8").includes("(pcb board"));
    } finally {
      console.log = origLog;
      fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
    }
  });
});
