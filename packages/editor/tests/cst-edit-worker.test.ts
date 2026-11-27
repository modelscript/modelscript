// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CstIncrementalParser } from "@modelscript/dsl/unparser";
import { getXmlWasmParser } from "@modelscript/dsl/xml";
import { getPsseWasmParser } from "@modelscript/psse";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";
import { CstEditWorkerCore } from "../src/workbench/util/cst-edit-worker-core.js";

function applyEdits(
  text: string,
  edits: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }[],
): string {
  const lines = text.split("\n");
  const toOffset = (pos: { line: number; character: number }) =>
    lines.slice(0, pos.line).reduce((acc, l) => acc + l.length + 1, 0) + pos.character;
  let out = text;
  const sorted = [...edits].sort((a, b) => toOffset(b.range.start) - toOffset(a.range.start));
  for (const e of sorted) {
    out = out.slice(0, toOffset(e.range.start)) + e.newText + out.slice(toOffset(e.range.end));
  }
  return out;
}

describe("CstEditWorkerCore (Dedicated Lightweight CST Edit Worker)", () => {
  const BASE_PSCX = [
    `<project name="WorkerTest" version="5.0.2">`,
    `  <definitions>`,
    `    <Definition name="Main" classid="UserCmpDefn">`,
    `      <schematic classid="UserCanvas">`,
    `        <User classid="UserCmp" id="101" name="master:resistor" defn="master:resistor" x="180" y="180" w="54" h="36" orient="0" disable="false">`,
    `          <paramlist link="-1" name="" crc="0">`,
    `            <param name="Name" value="R1" />`,
    `            <param name="R" value="10" />`,
    `          </paramlist>`,
    `        </User>`,
    `      </schematic>`,
    `    </Definition>`,
    `  </definitions>`,
    `</project>`,
    "",
  ].join("\n");

  it("maintains live incremental CST via open + delta and plans surgical PSCAD edits in < 5ms", () => {
    const core = new CstEditWorkerCore();
    const xmlParser = getXmlWasmParser() as unknown as CstIncrementalParser | null;
    core.setXmlParser(xmlParser);

    const uri = "file:///WorkerTest.pscx";
    core.handleMessage({ type: "open", uri, langId: "pscad", text: BASE_PSCX, version: 1 });

    // Stream an O(1) incremental delta simulating user typing R="25" in Monaco
    const idx10 = BASE_PSCX.indexOf('value="10"');
    const updatedAfterType = BASE_PSCX.slice(0, idx10 + 7) + "25" + BASE_PSCX.slice(idx10 + 9);
    core.handleMessage({
      type: "delta",
      uri,
      langId: "pscad",
      version: 2,
      deltas: [{ rangeOffset: idx10 + 7, rangeLength: 2, text: "25" }],
    });
    assert.equal(core.getSession(uri)?.text, updatedAfterType);
    assert.equal(core.getSession(uri)?.version, 2);

    // Move component via CST Edit Worker
    const t0 = performance.now();
    const moveRes = core.handleMessage({
      type: "applyActions",
      id: 1,
      uri,
      langId: "pscad",
      version: 2,
      actions: [{ type: "move", items: [{ name: "cmp_101", x: 360, y: 216, width: 54, height: 36 }] }],
    });
    const elapsedMs = performance.now() - t0;

    assert.ok(moveRes && moveRes.handled, "move should be handled by CST Edit Worker");
    assert.equal(moveRes.version, 2);
    assert.equal(moveRes.renderHint, "immediate");
    assert.ok(moveRes.edits.length >= 2);
    const afterMove = applyEdits(updatedAfterType, moveRes.edits);
    assert.match(afterMove, /id="101"[^>]*x="387" y="234"/);
    assert.ok(afterMove.includes('value="25"'), "previously streamed incremental edit must be preserved");
    assert.ok(elapsedMs < 200, `expected fast edit planning, got ${elapsedMs.toFixed(2)}ms`);

    core.dispose();
  });

  it("handles cross-language foreign drops using cached foreignSymbols with zero LSP roundtrip", () => {
    const core = new CstEditWorkerCore();
    core.setXmlParser(getXmlWasmParser() as unknown as CstIncrementalParser | null);

    const uri = "file:///ForeignDrop.pscx";
    core.handleMessage({ type: "open", uri, langId: "pscad", text: BASE_PSCX, version: 1 });
    core.handleMessage({
      type: "setForeignSymbols",
      symbols: {
        "Modelica.Electrical.Analog.Basic.Capacitor": {
          cleanName: "Modelica.Electrical.Analog.Basic.Capacitor",
          shortName: "Capacitor",
          sourceLanguage: "modelica",
          explicitLanguage: "modelica",
          ports: [
            { name: "p", side: "left", mode: "Electrical", dim: 1 },
            { name: "n", side: "right", mode: "Electrical", dim: 1 },
          ],
          params: [{ name: "C", defaultValue: "1e-6" }],
        },
      },
    });

    const dropRes = core.handleMessage({
      type: "applyActions",
      id: 2,
      uri,
      langId: "pscad",
      version: 1,
      actions: [
        {
          type: "addComponent",
          className: "Modelica.Electrical.Analog.Basic.Capacitor",
          x: 420,
          y: 180,
        },
      ],
    });
    assert.ok(dropRes && dropRes.handled, "cached foreign symbol drop should be handled with zero LSP");
    assert.equal(dropRes.renderHint, "immediate");
    const afterDrop = applyEdits(BASE_PSCX, dropRes.edits);
    assert.match(afterDrop, /Capacitor/);

    core.dispose();
  });

  it("recovers cleanly and edits healthy elements when sibling XML is malformed", () => {
    const core = new CstEditWorkerCore();
    core.setXmlParser(getXmlWasmParser() as unknown as CstIncrementalParser | null);

    const brokenXml = BASE_PSCX.replace(
      "      </schematic>",
      `        <User classid="UserCmp" id="999" attr="unterminated\n`,
    );
    const uri = "file:///BrokenWorker.pscx";
    core.handleMessage({ type: "open", uri, langId: "pscad", text: brokenXml, version: 5 });

    const paramRes = core.handleMessage({
      type: "applyActions",
      id: 3,
      uri,
      langId: "pscad",
      version: 5,
      actions: [{ type: "updateParameter", name: "cmp_101", parameter: "R", value: "42.5" }],
    });
    assert.ok(paramRes && paramRes.handled, "parameter update on healthy sibling should succeed");
    const afterParam = applyEdits(brokenXml, paramRes.edits);
    assert.ok(afterParam.includes('name="R" value="42.5"'));
    assert.ok(afterParam.includes('attr="unterminated'), "broken sibling must stay untouched");

    core.dispose();
  });

  it("plans surgical PSS/E .raw column-level edits and @pos moves without re-serializing untouched columns", () => {
    const core = new CstEditWorkerCore();
    core.setLanguageParser("psse", getPsseWasmParser() as unknown as CstIncrementalParser);

    const raw = [
      `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0`,
      `TEST CASE`,
      ``,
      `101, 'BUS 101     ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000 / custom user note`,
      `102, 'BUS 102     ', 230.000, 1, 1, 1, 1, 0.9900, -2.5000`,
      `0 / END OF BUS DATA`,
      `Q`,
      "",
    ].join("\n");

    const uri = "file:///case.raw";
    core.handleMessage({ type: "open", uri, langId: "psse", text: raw, version: 1 });

    const editRes = core.handleMessage({
      type: "applyActions",
      id: 4,
      uri,
      langId: "psse",
      version: 1,
      actions: [
        { type: "updateProperty", name: "bus_101", key: "vm", value: 1.025 },
        { type: "move", items: [{ name: "bus_101", x: 200, y: 120, width: 156, height: 40 }] },
      ],
    });

    assert.ok(editRes && editRes.handled, "PSS/E optimistic edits should be handled in CST Edit Worker");
    const updated = applyEdits(raw, editRes.edits);
    assert.ok(updated.includes("1.0250"), "vm column should be surgically updated");
    assert.ok(updated.includes("custom user note"), "user trailing comment must be preserved verbatim");
    assert.ok(updated.includes("@pos(278, 140)"), "@pos tag should be appended after user comment");

    // Structural connect + deleteComponents directly via CstTransaction in the worker
    const structRaw = [
      `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0`,
      `TEST CASE`,
      ``,
      `101, 'BUS 101     ', 230.000, 3, 1, 1, 1, 1.0000, 0.0000`,
      `102, 'BUS 102     ', 230.000, 1, 1, 1, 1, 0.9900, -2.5000`,
      `0 / END OF BUS DATA`,
      `0 / END OF LOAD DATA`,
      `0 / END OF FIXED SHUNT DATA`,
      `0 / END OF GENERATOR DATA`,
      `101, 102, '1 ', 0.01, 0.05, 0.0, 100.0, 100.0, 100.0, 0, 0, 0, 0, 1, 1, 0, 1, 1.0`,
      `0 / END OF BRANCH DATA`,
      `Q`,
      "",
    ].join("\n");
    const structUri = "file:///case_struct.raw";
    core.handleMessage({ type: "open", uri: structUri, langId: "psse", text: structRaw, version: 1 });

    const connectRes = core.handleMessage({
      type: "applyActions",
      id: 5,
      uri: structUri,
      langId: "psse",
      version: 1,
      actions: [{ type: "connect", source: "bus_101", target: "bus_102" }],
    });
    assert.ok(connectRes && connectRes.handled, "PSS/E connect should be handled in CST Edit Worker");
    assert.equal(connectRes.renderHint, "immediate");
    const afterConnect = applyEdits(structRaw, connectRes.edits);
    assert.ok(
      afterConnect.includes("101, 102, '2 '"),
      "new parallel circuit '2 ' should be inserted before branch terminator",
    );

    core.handleMessage({ type: "syncText", uri: structUri, langId: "psse", text: afterConnect, version: 2 });
    const delRes = core.handleMessage({
      type: "applyActions",
      id: 6,
      uri: structUri,
      langId: "psse",
      version: 2,
      actions: [{ type: "deleteComponents", names: ["bus_102"] }],
    });
    assert.ok(delRes && delRes.handled, "PSS/E deleteComponents should be handled in CST Edit Worker");
    assert.equal(delRes.renderHint, "immediate");
    const afterDel = applyEdits(afterConnect, delRes.edits);
    assert.ok(!afterDel.includes("'BUS 102"), "deleted bus record should be removed");
    assert.ok(!afterDel.includes("101, 102,"), "branches attached to deleted bus should be removed");
    assert.ok(afterDel.includes("'BUS 101"), "remaining bus must stay untouched");

    core.dispose();
  });

  it("plans surgical off-main-thread edits for Simulink XML, OpenDRIVE, SSP, and SPICE", () => {
    const core = new CstEditWorkerCore();
    core.setXmlParser(getXmlWasmParser() as unknown as CstIncrementalParser | null);

    // 1. Simulink XML
    const slxXml = `<System Name="Ctrl">\n  <Block BlockType="Gain" Name="G1">\n    <P Name="Gain">2.0</P>\n  </Block>\n</System>\n`;
    core.handleMessage({ type: "open", uri: "file:///ctrl.xml", langId: "simulink", text: slxXml, version: 1 });
    const slxRes = core.handleMessage({
      type: "applyActions",
      id: 10,
      uri: "file:///ctrl.xml",
      langId: "simulink",
      version: 1,
      actions: [{ type: "updateParameter", name: "G1", parameter: "Gain", value: "5.5" }],
    });
    assert.ok(slxRes && slxRes.handled);
    assert.ok(applyEdits(slxXml, slxRes.edits).includes('<P Name="Gain">5.5</P>'));

    // 2. OpenDRIVE
    const xodr = `<OpenDRIVE>\n  <road name="MainSt" length="100.0" id="1" junction="-1" />\n</OpenDRIVE>\n`;
    core.handleMessage({ type: "open", uri: "file:///road.xodr", langId: "opendrive", text: xodr, version: 1 });
    const xodrRes = core.handleMessage({
      type: "applyActions",
      id: 11,
      uri: "file:///road.xodr",
      langId: "opendrive",
      version: 1,
      actions: [{ type: "updateName", oldName: "road_1", newName: "Highway1" }],
    });
    assert.ok(xodrRes && xodrRes.handled);
    assert.ok(applyEdits(xodr, xodrRes.edits).includes('name="Highway1"'));

    // 3. SSP (.ssd)
    const ssd = `<ssd:SystemStructureDescription name="Sys">\n  <ssd:System name="Root">\n    <ssd:Elements>\n      <ssd:Component name="Plant" type="application/x-fmu-sharedlibrary" source="resources/Plant.fmu" />\n    </ssd:Elements>\n  </ssd:System>\n</ssd:SystemStructureDescription>\n`;
    core.handleMessage({ type: "open", uri: "file:///SystemStructure.ssd", langId: "ssp", text: ssd, version: 1 });
    const sspRes = core.handleMessage({
      type: "applyActions",
      id: 12,
      uri: "file:///SystemStructure.ssd",
      langId: "ssp",
      version: 1,
      actions: [{ type: "updateName", oldName: "Plant", newName: "MotorPlant" }],
    });
    assert.ok(sspRes && sspRes.handled);
    assert.ok(applyEdits(ssd, sspRes.edits).includes('name="MotorPlant"'));

    // 4. SPICE
    const cir = `* RC Filter\nR1 in out 1k ; user comment\nC1 out 0 1u\n.END\n`;
    core.handleMessage({ type: "open", uri: "file:///rc.cir", langId: "spice", text: cir, version: 1 });
    const cirRes = core.handleMessage({
      type: "applyActions",
      id: 13,
      uri: "file:///rc.cir",
      langId: "spice",
      version: 1,
      actions: [
        { type: "updateParameter", name: "R1", parameter: "value", value: "4.7k" },
        { type: "move", items: [{ name: "R1", x: 120, y: 80, width: 60, height: 24 }] },
      ],
    });
    assert.ok(cirRes && cirRes.handled);
    const updatedCir = applyEdits(cir, cirRes.edits);
    assert.ok(updatedCir.includes("R1 in out 4.7k"));
    assert.ok(updatedCir.includes("user comment"));
    assert.ok(updatedCir.includes("@pos(120, 80)"));

    // 5. Native addComponent in Simulink XML, SPICE, and PSS/E
    const slxAdd = core.handleMessage({
      type: "applyActions",
      id: 14,
      uri: "file:///ctrl.xml",
      langId: "simulink",
      version: 1,
      actions: [{ type: "addComponent", className: "Integrator", x: 140, y: 80 }],
    });
    assert.ok(slxAdd && slxAdd.handled);
    assert.ok(applyEdits(slxXml, slxAdd.edits).includes('BlockType="Integrator"'));

    const cirAdd = core.handleMessage({
      type: "applyActions",
      id: 15,
      uri: "file:///rc.cir",
      langId: "spice",
      version: 1,
      actions: [{ type: "addComponent", className: "Resistor", x: 200, y: 100 }],
    });
    assert.ok(cirAdd && cirAdd.handled);
    assert.ok(applyEdits(cir, cirAdd.edits).includes("R2 0 0 1k ; @pos(200, 100)"));

    // 6. Modelica off-main-thread parameter & connect edits
    const mo = [
      `model RC`,
      `  Modelica.Electrical.Analog.Basic.Resistor R1(R=10) annotation(Placement(transformation(extent={{-10,-10},{10,10}})));`,
      `  Modelica.Electrical.Analog.Basic.Capacitor C1(C=1e-6) annotation(Placement(transformation(extent={{30,-10},{50,10}})));`,
      `equation`,
      `end RC;`,
      "",
    ].join("\n");
    core.handleMessage({ type: "open", uri: "file:///RC.mo", langId: "modelica", text: mo, version: 1 });
    const moRes = core.handleMessage({
      type: "applyActions",
      id: 16,
      uri: "file:///RC.mo",
      langId: "modelica",
      version: 1,
      className: "RC",
      actions: [
        { type: "updateParameter", name: "R1", parameter: "R", value: "250" },
        { type: "connect", source: "R1.n", target: "C1.p" },
      ],
    });
    assert.ok(moRes && moRes.handled, "Modelica parameter + connect should be handled in CST Edit Worker");
    const updatedMo = applyEdits(mo, moRes.edits);
    assert.ok(updatedMo.includes("R=250"));
    assert.ok(updatedMo.includes("connect(R1.n, C1.p)"));

    // 7. SysML v2 off-main-thread addComponent + connect
    const sysml = `package Vehicle {\n  part engine;\n  part wheels;\n}\n`;
    core.handleMessage({ type: "open", uri: "file:///vehicle.sysml", langId: "sysml2", text: sysml, version: 1 });
    const sysmlRes = core.handleMessage({
      type: "applyActions",
      id: 17,
      uri: "file:///vehicle.sysml",
      langId: "sysml2",
      version: 1,
      actions: [{ type: "connect", source: "engine", target: "wheels" }],
    });
    assert.ok(sysmlRes && sysmlRes.handled, "SysML2 connect should be handled in CST Edit Worker");
    assert.ok(applyEdits(sysml, sysmlRes.edits).includes("connect engine to wheels;"));

    // 8. OWL 2 off-main-thread connect (OWL/XML & Functional)
    const owl = `Ontology(<http://example.org/test>\n  Declaration(Class(:Dog))\n  Declaration(Class(:Animal))\n)\n`;
    core.handleMessage({ type: "open", uri: "file:///test.ofn", langId: "owl2", text: owl, version: 1 });
    const owlRes = core.handleMessage({
      type: "applyActions",
      id: 18,
      uri: "file:///test.ofn",
      langId: "owl2",
      version: 1,
      actions: [{ type: "connect", source: "Dog", target: "Animal", edgeType: "subClassOf" }],
    });
    assert.ok(owlRes && owlRes.handled, "OWL2 connect should be handled in CST Edit Worker");
    assert.ok(applyEdits(owl, owlRes.edits).includes("SubClassOf(:Dog :Animal)"));

    core.dispose();
  });

  it("disposeCstEditWorker terminates active worker, rejects pending requests, and resets fallback core", async () => {
    interface MockWorkerInstance {
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: Event) => void) | null;
      terminated: boolean;
      postedMessages: unknown[];
      postMessage(msg: unknown): void;
      terminate(): void;
    }

    const createdWorkers: MockWorkerInstance[] = [];
    const globalWithMock = globalThis as typeof globalThis & {
      __MOCK_CST_EDIT_WORKERS__?: MockWorkerInstance[];
      Worker?: unknown;
    };
    globalWithMock.__MOCK_CST_EDIT_WORKERS__ = createdWorkers;

    const hooks = registerHooks({
      load(url, context, nextLoad) {
        if (url.includes("cst-edit.worker") && url.includes("?worker")) {
          return {
            format: "module",
            shortCircuit: true,
            source: `
              export default class MockCstEditWorker {
                constructor() {
                  this.onmessage = null;
                  this.onerror = null;
                  this.terminated = false;
                  this.postedMessages = [];
                  globalThis.__MOCK_CST_EDIT_WORKERS__?.push(this);
                }
                postMessage(msg) { this.postedMessages.push(msg); }
                terminate() { this.terminated = true; }
              }
            `,
          };
        }
        return nextLoad(url, context);
      },
    });

    const originalWorker = globalWithMock.Worker;
    try {
      const { applyDiagramActionsViaCstWorker, disposeCstEditWorker, notifyCstWorkerOpen } =
        await import("../src/workbench/util/cst-edit-client.js");

      // 1. Safe no-op when no worker or fallback core is active
      disposeCstEditWorker();

      // 2. Fallback core path (Worker undefined in Node): resets sessions cleanly
      delete globalWithMock.Worker;
      const uri = "file:///dispose-test.cir";
      const cir = "* RC\nR1 in out 1k\n.END\n";
      notifyCstWorkerOpen(uri, "spice", cir, 1);
      const resBefore = await applyDiagramActionsViaCstWorker({
        uri,
        langId: "spice",
        version: 1,
        actions: [{ type: "updateParameter", name: "R1", parameter: "value", value: "2.2k" }],
      });
      assert.ok(resBefore.handled, "expected edit to be handled by fallback core before disposal");

      disposeCstEditWorker();

      const resAfter = await applyDiagramActionsViaCstWorker({
        uri,
        langId: "spice",
        version: 1,
        actions: [{ type: "updateParameter", name: "R1", parameter: "value", value: "3.3k" }],
      });
      assert.equal(resAfter.handled, false, "disposed fallback core must not retain prior document sessions");
      disposeCstEditWorker();

      // 3. Worker path: terminates worker, clears handlers, and rejects in-flight requests
      globalWithMock.Worker = class {};
      const pendingPromise = applyDiagramActionsViaCstWorker({
        uri,
        langId: "spice",
        version: 2,
        actions: [{ type: "updateParameter", name: "R1", parameter: "value", value: "4.7k" }],
      });
      assert.equal(createdWorkers.length, 1, "expected one worker instance to be spawned");
      const activeWorker = createdWorkers[0]!;
      assert.equal(activeWorker.terminated, false);
      assert.equal(typeof activeWorker.onmessage, "function");
      assert.equal(typeof activeWorker.onerror, "function");

      disposeCstEditWorker();

      assert.equal(activeWorker.terminated, true, "disposeCstEditWorker must terminate the worker");
      assert.equal(activeWorker.onmessage, null, "disposeCstEditWorker must clear onmessage");
      assert.equal(activeWorker.onerror, null, "disposeCstEditWorker must clear onerror");
      await assert.rejects(pendingPromise, /CST edit worker disposed/);

      // Idempotent second disposal
      disposeCstEditWorker();
    } finally {
      hooks.deregister();
      delete globalWithMock.__MOCK_CST_EDIT_WORKERS__;
      if (originalWorker === undefined) {
        delete globalWithMock.Worker;
      } else {
        globalWithMock.Worker = originalWorker;
      }
    }
  });
});
