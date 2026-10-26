// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Spice } from "../src/commands/spice.js";

const VALID_SPICE_NETLIST = `* RC Low-Pass Filter Benchmark
V1 in 0 DC 5 AC 1
R1 in out 1k
C1 out 0 1u
.OP
.TRAN 10u 5m
.END
`;

const FLOATING_NODE_NETLIST = `* Floating Netlist
V1 in 0 5
R1 in out 1k
R2 float_node 0 1k
.END
`;

test("SPICE CLI Commands (msx spice simulate, lint, to-modelica, to-ecad)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_spice_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const validFile = path.join(tmpDir, "filter.cir");
  const floatingFile = path.join(tmpDir, "floating.cir");
  fs.writeFileSync(validFile, VALID_SPICE_NETLIST, "utf-8");
  fs.writeFileSync(floatingFile, FLOATING_NODE_NETLIST, "utf-8");

  await t.test("msx spice simulate should compute DC Operating Point and Transient", async () => {
    // Intercept console.log
    let logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const capturedCommands: any[] = [];
      const mockYargs: any = {
        command: (cmd: any) => {
          capturedCommands.push(cmd);
          return mockYargs;
        },
        demandCommand: () => mockYargs,
      };
      (Spice.builder as any)(mockYargs);

      const simCmd = capturedCommands.find((c) => c.command.startsWith("simulate"));
      assert.ok(simCmd, "Must find simulate command");

      const jsonOut = path.join(tmpDir, "op_result.json");

      // 1. Run DC OP simulation
      logs = [];
      await simCmd.handler({
        file: validFile,
        analysis: "op",
        format: "json",
        out: jsonOut,
      });

      assert.ok(fs.existsSync(jsonOut), "Should write op_result.json");
      const opData = JSON.parse(fs.readFileSync(jsonOut, "utf-8"));
      assert.equal(opData.converged, true);
      assert.ok(opData.nodeVoltages["OUT"] !== undefined || opData.nodeVoltages["out"] !== undefined);

      // 2. Run Transient simulation with CSV output
      const csvOut = path.join(tmpDir, "tran_result.csv");
      await simCmd.handler({
        file: validFile,
        analysis: "tran",
        format: "csv",
        out: csvOut,
      });

      assert.ok(fs.existsSync(csvOut), "Should write tran_result.csv");
      const csvContent = fs.readFileSync(csvOut, "utf-8");
      assert.ok(csvContent.startsWith("time,"));
      assert.ok(csvContent.includes("V(OUT)") || csvContent.includes("V(out)"));

      // 3. Lint clean netlist
      const lintCmd = capturedCommands.find((c) => c.command.startsWith("lint"));
      assert.ok(lintCmd, "Must find lint command");

      logs = [];
      await lintCmd.handler({
        file: validFile,
        format: "pretty",
      });
      assert.ok(logs.some((l) => l.includes("No structural or electrical violations found")));

      // 4. Translate to Modelica
      const toModelicaCmd = capturedCommands.find((c) => c.command.startsWith("to-modelica"));
      assert.ok(toModelicaCmd, "Must find to-modelica command");

      const moOut = path.join(tmpDir, "Filter.mo");
      await toModelicaCmd.handler({
        file: validFile,
        out: moOut,
      });

      assert.ok(fs.existsSync(moOut), "Should write Filter.mo");
      const moContent = fs.readFileSync(moOut, "utf-8");
      assert.ok(moContent.includes("model "));
      assert.ok(moContent.includes("Modelica.Electrical.Analog.Basic.Resistor R1"));

      // 5. Translate to ECAD NetlistGraph
      const toEcadCmd = capturedCommands.find((c) => c.command.startsWith("to-ecad"));
      assert.ok(toEcadCmd, "Must find to-ecad command");

      const ecadOut = path.join(tmpDir, "netlist.json");
      await toEcadCmd.handler({
        file: validFile,
        out: ecadOut,
      });

      assert.ok(fs.existsSync(ecadOut), "Should write netlist.json");
      const ecadData = JSON.parse(fs.readFileSync(ecadOut, "utf-8"));
      assert.ok(Array.isArray(ecadData.components));
      assert.ok(ecadData.components.length >= 2);

      // 6. Synchronize from modified Modelica
      const syncCmd = capturedCommands.find((c) => c.command.startsWith("sync"));
      assert.ok(syncCmd, "Must find sync command");

      const modifiedMo = `model RcFilter
  Modelica.Electrical.Analog.Basic.Resistor R1(R=4700);
  Modelica.Electrical.Analog.Basic.Capacitor C1(C=2.2e-6);
  Modelica.Electrical.Analog.Sources.ConstantVoltage V1(V=12.0);
end RcFilter;`;
      const moFile = path.join(tmpDir, "RcFilter_mod.mo");
      fs.writeFileSync(moFile, modifiedMo, "utf-8");

      const syncedCir = path.join(tmpDir, "filter_synced.cir");
      await syncCmd.handler({
        file: validFile,
        fromModelica: moFile,
        out: syncedCir,
      });

      assert.ok(fs.existsSync(syncedCir), "Should write filter_synced.cir");
      const syncedContent = fs.readFileSync(syncedCir, "utf-8");
      assert.ok(syncedContent.includes("4700"), "Must update R1 to 4700");
      assert.ok(syncedContent.includes("12"), "Must update V1 to 12");
      assert.ok(syncedContent.includes(".TRAN 10u 5m"), "Must preserve directives");

      // 7. Inspect / Summary
      const inspectCmd = capturedCommands.find(
        (c) =>
          (typeof c.command === "string" && (c.command.startsWith("inspect") || c.command.startsWith("summary"))) ||
          (Array.isArray(c.command) && c.command.some((cmdStr: string) => cmdStr.startsWith("inspect"))),
      );
      assert.ok(inspectCmd, "Must find inspect command");

      logs = [];
      await inspectCmd.handler({
        file: validFile,
        format: "pretty",
      });
      assert.ok(logs.some((l) => l.includes("SPICE Netlist Summary:")));
      assert.ok(logs.some((l) => l.includes("Components:")));

      const summaryOut = path.join(tmpDir, "summary.json");
      await inspectCmd.handler({
        file: validFile,
        format: "json",
        out: summaryOut,
      });
      assert.ok(fs.existsSync(summaryOut));
      const summaryData = JSON.parse(fs.readFileSync(summaryOut, "utf-8"));
      assert.equal(summaryData.componentsCount, 3);
      assert.ok(summaryData.componentsByKind["R"] === 1);
      assert.ok(summaryData.nodeCount >= 3);

      // 8. Lower to DAE arena
      const toDaeCmd = capturedCommands.find((c) => c.command.startsWith("to-dae"));
      assert.ok(toDaeCmd, "Must find to-dae command");

      logs = [];
      const daeOut = path.join(tmpDir, "dae_meta.json");
      await toDaeCmd.handler({
        file: validFile,
        format: "json",
        out: daeOut,
      });
      assert.ok(fs.existsSync(daeOut));
      const daeMeta = JSON.parse(fs.readFileSync(daeOut, "utf-8"));
      assert.ok(daeMeta.varCount >= 3);
      assert.ok(daeMeta.eqCount >= 3);

      // 9. Generate Schematic Diagram (SVG)
      const diagramCmd = capturedCommands.find((c) => c.command.startsWith("diagram"));
      assert.ok(diagramCmd, "Must find diagram command");

      const svgOut = path.join(tmpDir, "schematic.svg");
      await diagramCmd.handler({
        file: validFile,
        format: "svg",
        out: svgOut,
      });
      assert.ok(fs.existsSync(svgOut));
      const svgContent = fs.readFileSync(svgOut, "utf-8");
      assert.ok(svgContent.includes("<svg"));
      assert.ok(svgContent.includes("R1"));
      assert.ok(svgContent.includes("C1"));

      // 10. Generate Schematic Diagram (JSON graph)
      const graphOut = path.join(tmpDir, "diagram.json");
      await diagramCmd.handler({
        file: validFile,
        format: "json",
        out: graphOut,
      });
      assert.ok(fs.existsSync(graphOut));
      const graphData = JSON.parse(fs.readFileSync(graphOut, "utf-8"));
      assert.ok(Array.isArray(graphData.cells));
      assert.ok(graphData.cells.length > 0);
    } finally {
      console.log = origLog;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
