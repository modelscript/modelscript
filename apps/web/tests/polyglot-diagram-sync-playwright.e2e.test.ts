// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildAutosarDiagram,
  buildMolecularDiagramFromSmiles,
  buildOlgaDiagram,
  buildOpenDssDiagram,
  buildOpenScenarioDiagram,
  buildOscalDiagram,
  buildPlcopenDiagram,
  buildPolyglotDiagram,
  buildPscadDiagram,
  buildPsseDiagram,
  buildRelap5Diagram,
  buildRocetsDiagram,
  buildSbmlDiagram,
  buildSimulinkDiagram,
  buildSpiceDiagram,
  buildSwmmDiagram,
  buildTouchstoneDiagram,
  buildVerilogADiagram,
  cellsToDiagramData,
  type DiagramData,
  type DiagramEditAction,
} from "@modelscript/diagram";
import { computeOWL2ElementInsert } from "@modelscript/owl2";
import { parsePscx, planDiagramActions } from "@modelscript/pscad";
import { computeSysML2ElementInsert } from "@modelscript/sysml2";
import react from "@vitejs/plugin-react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type Alias, type Plugin, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { buildDiagramData } from "../../../languages/modelica/src/diagram/data.js";
import {
  buildFallbackClassInstance,
  computeConnectInsert,
  computePlacementEdits,
} from "../../../languages/modelica/src/diagram/edits.js";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const VIRTUAL_ENTRY_URL = "/__polyglot_diagram_e2e_entry.tsx";
const VIRTUAL_ENTRY_RESOLVED = path.join(WEB_ROOT, "__polyglot_diagram_e2e_entry.tsx");
const CHROMIUM_CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"] as const;

function applyLspEdits(
  text: string,
  edits: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }[],
): string {
  const lines = text.split("\n");
  const off = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  let out = text;
  for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))) {
    out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  }
  return out;
}

function findChromiumExecutable(): string | null {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function buildNodeShimAliases(webRoot: string): Alias[] {
  const nodeUrlShim = path.resolve(webRoot, "src/util/node-url-shim.ts");
  const nodeShims = path.resolve(webRoot, "src/util/node-shims.ts");
  return [
    { find: /^node:url$/, replacement: nodeUrlShim },
    { find: /^url$/, replacement: nodeUrlShim },
    { find: /^node:child_process$/, replacement: nodeShims },
    { find: /^child_process$/, replacement: nodeShims },
    { find: /^node:fs\/promises$/, replacement: nodeShims },
    { find: /^fs\/promises$/, replacement: nodeShims },
    { find: /^node:fs$/, replacement: nodeShims },
    { find: /^fs$/, replacement: nodeShims },
    { find: /^node:os$/, replacement: nodeShims },
    { find: /^os$/, replacement: nodeShims },
    { find: /^node:path$/, replacement: nodeShims },
    { find: /^path$/, replacement: nodeShims },
    { find: /^node:readline\/promises$/, replacement: nodeShims },
    { find: /^readline\/promises$/, replacement: nodeShims },
    { find: /^node:readline$/, replacement: nodeShims },
    { find: /^readline$/, replacement: nodeShims },
    { find: /^node:zlib$/, replacement: nodeShims },
    { find: /^zlib$/, replacement: nodeShims },
    { find: /^node:crypto$/, replacement: nodeShims },
    { find: /^crypto$/, replacement: nodeShims },
    { find: /^node:net$/, replacement: nodeShims },
    { find: /^net$/, replacement: nodeShims },
    { find: /^node:events$/, replacement: nodeShims },
    { find: /^events$/, replacement: nodeShims },
    { find: /^node:module$/, replacement: nodeShims },
    { find: /^module$/, replacement: nodeShims },
    { find: /^node:worker_threads$/, replacement: nodeShims },
    { find: /^worker_threads$/, replacement: nodeShims },
  ];
}

function buildVirtualEntrySource(): string {
  return `
import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import DiagramEditor from "@modelscript/editor/workbench/Diagram.tsx";
import type { DiagramEditorHandle } from "@modelscript/editor/workbench/Diagram.tsx";
import type { DiagramData } from "@modelscript/diagram";

function Harness(): React.ReactElement {
  const editorRef = useRef<DiagramEditorHandle | null>(null);
  const [data, setData] = useState<DiagramData>({
    className: "Loading",
    nodes: [],
    edges: [],
  });
  const actionsRef = useRef<unknown[]>([]);

  (window as unknown as Record<string, unknown>).__polyglotDiagramHarness = {
    setDiagramData: (next: DiagramData) => {
      setData(next);
    },
    clearActions: () => {
      actionsRef.current = [];
    },
    getActions: () => actionsRef.current,
    getHandle: () => editorRef.current,
    getDomSummary: () => {
      const nodeEls = Array.from(document.querySelectorAll(".ms-nodes-layer > g[data-cell-id]"));
      const edgeEls = Array.from(document.querySelectorAll(".ms-edges-layer > g[data-cell-id]"));
      const selBoxes = Array.from(document.querySelectorAll(".ms-selection-box[data-cell-id]"));
      return {
        nodeCount: nodeEls.length,
        edgeCount: edgeEls.length,
        nodeIds: nodeEls.map((el) => el.getAttribute("data-cell-id") ?? ""),
        selectedIds: selBoxes.map((el) => el.getAttribute("data-cell-id") ?? ""),
      };
    },
  };

  return (
    <div style={{ width: "1200px", height: "800px", position: "relative" }}>
      <DiagramEditor
        ref={editorRef}
        diagramData={data}
        diagramClassName={data.className ?? "Main"}
        theme="light"
        onAction={(action) => {
          actionsRef.current.push(action);
        }}
      />
    </div>
  );
}

const mount = document.getElementById("root")!;
createRoot(mount).render(<Harness />);
`;
}

const VIRTUAL_LANGUAGE_UI_ID = "virtual:modelscript-language-ui";
const VIRTUAL_LANGUAGE_UI_RESOLVED = `\0${VIRTUAL_LANGUAGE_UI_ID}`;

function createVirtualEntryPlugin(): Plugin {
  return {
    name: "polyglot-diagram-e2e-virtual-entry",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY_URL || id === VIRTUAL_ENTRY_RESOLVED) return VIRTUAL_ENTRY_RESOLVED;
      if (id === VIRTUAL_LANGUAGE_UI_ID || id === VIRTUAL_LANGUAGE_UI_RESOLVED) return VIRTUAL_LANGUAGE_UI_RESOLVED;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ENTRY_RESOLVED) return buildVirtualEntrySource();
      if (id === VIRTUAL_LANGUAGE_UI_RESOLVED) {
        return `
export const LANGUAGE_PANEL_META = [];
export const MORSEL_PANEL_LOADERS = {};
export const ARTIFACT_PANEL_LOADERS = {};
export const LANGUAGE_STENCILS = {};
export const LANGUAGE_SIMULATION_CARDS = [];
export const LANGUAGE_TOOLBAR_BUTTONS = {};
`;
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url === "/__polyglot-diagram-e2e.html") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Polyglot Diagram E2E</title></head>
  <body style="margin:0;padding:0;background:#ffffff;overflow:hidden;">
    <div id="root"></div>
    <script type="module" src="${VIRTUAL_ENTRY_URL}"></script>
  </body>
</html>`);
          return;
        }
        next();
      });
    },
  };
}

describe("Polyglot Diagram & Icon E2E Suite (Chromium)", () => {
  test("verifies Tier 1 editable languages (Modelica diagram/icon, PSCAD, SysML2, OWL2) and Tier 2 polyglot diagram viewers", async (t) => {
    const executablePath = findChromiumExecutable();
    if (!executablePath) {
      t.skip("No Chromium binary found");
      return;
    }

    let viteServer: ViteDevServer | null = null;
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      viteServer = await createServer({
        root: WEB_ROOT,
        cacheDir: path.resolve(WEB_ROOT, "node_modules/.vite-canvas-e2e"),
        configFile: false,
        logLevel: "error",
        define: {
          "process.env": {},
          "process.browser": true,
          "process.versions": {},
          __AVAILABLE_FILE_ICONS__: JSON.stringify({}),
        },
        server: { port: 0, strictPort: false, host: "127.0.0.1", hmr: false, watch: null },
        resolve: {
          alias: [...buildNodeShimAliases(WEB_ROOT), { find: "@", replacement: path.resolve(WEB_ROOT, "src") }],
          dedupe: ["react", "react-dom", "react-router-dom", "styled-components", "@primer/react"],
        },
        plugins: [createVirtualEntryPlugin(), react(), tsconfigPaths({ root: WEB_ROOT })],
      });
      await viteServer.listen();
      const address = viteServer.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Failed to bind Vite test server");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
      const page: Page = await context.newPage();

      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.goto(`${baseUrl}/__polyglot-diagram-e2e.html`, { waitUntil: "networkidle" });
      await page.waitForFunction(() =>
        Boolean((window as unknown as Record<string, unknown>).__polyglotDiagramHarness),
      );

      const loadDiagramInBrowser = async (diag: DiagramData) => {
        const expectedNodeId = diag.nodes.find((n) => !String(n.id).startsWith("__"))?.id;
        await page.evaluate((d) => {
          const h = (
            window as unknown as {
              __polyglotDiagramHarness: {
                setDiagramData: (x: unknown) => void;
                clearActions: () => void;
                getHandle: () => { zoomToFit?: () => void } | null;
              };
            }
          ).__polyglotDiagramHarness;
          h.clearActions();
          h.setDiagramData(d);
        }, diag);
        if (expectedNodeId) {
          await page.waitForSelector(`.ms-nodes-layer > g[data-cell-id="${expectedNodeId}"]`, {
            state: "attached",
            timeout: 10000,
          });
        } else {
          await page.waitForSelector(".ms-nodes-layer > g[data-cell-id]", { state: "attached", timeout: 10000 });
        }
        await page.evaluate(() => {
          (
            window as unknown as {
              __polyglotDiagramHarness: { getHandle: () => { zoomToFit?: () => void } | null };
            }
          ).__polyglotDiagramHarness
            .getHandle()
            ?.zoomToFit?.();
        });
        await page.waitForTimeout(80);
      };

      // ── TIER 1A: Modelica Diagram + Icon + Code Writeback ──
      let moCode = `model PolyCircuit
  Real r1 annotation(Placement(transformation(origin={-40, 0}, extent={{-10,-10},{10,10}})));
  Real r2 annotation(Placement(transformation(origin={40, 0}, extent={{-10,-10},{10,10}})));
  annotation(Icon(graphics={Rectangle(extent={{-80,-80},{80,80}}), Text(extent={{-60,-20},{60,20}}, textString="%name")}));
equation
end PolyCircuit;`;
      const ci1 = buildFallbackClassInstance(moCode, "PolyCircuit")!;
      const moDiag = await buildDiagramData(ci1 as never);
      await loadDiagramInBrowser(moDiag as unknown as DiagramData);

      const r1Box = await page.locator('[data-cell-id="r1"]').boundingBox();
      assert.ok(r1Box, "Modelica r1 must render in Chromium");
      await page.mouse.move(r1Box.x + r1Box.width / 2, r1Box.y + r1Box.height / 2);
      await page.mouse.down();
      await page.mouse.move(r1Box.x + r1Box.width / 2 + 40, r1Box.y + r1Box.height / 2 - 20, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          (
            window as unknown as { __polyglotDiagramHarness: { getActions: () => { type: string }[] } }
          ).__polyglotDiagramHarness
            .getActions()
            .some((a) => a.type === "move"),
        undefined,
        { timeout: 5000 },
      );
      const moMove = (
        await page.evaluate(() =>
          (
            window as unknown as { __polyglotDiagramHarness: { getActions: () => DiagramEditAction[] } }
          ).__polyglotDiagramHarness.getActions(),
        )
      ).find((a) => a.type === "move") as Extract<DiagramEditAction, { type: "move" }>;
      const moEdits = computePlacementEdits(moCode, ci1, moMove.items);
      assert.ok(moEdits.length > 0, "Modelica computePlacementEdits must produce code edits");
      moCode = applyLspEdits(moCode, moEdits);
      const connectEdits = computeConnectInsert(moCode, "r1", "r2");
      if (connectEdits.length > 0) {
        moCode = applyLspEdits(moCode, connectEdits);
      }
      const ci1Updated = buildFallbackClassInstance(moCode, "PolyCircuit")!;
      const moDiagUpdated = await buildDiagramData(ci1Updated as never);
      await loadDiagramInBrowser(moDiagUpdated as unknown as DiagramData);

      // Modelica Icon mode rendering check
      const moIconDiag = await buildDiagramData(ci1Updated as never, undefined, undefined, "icon");
      await loadDiagramInBrowser(moIconDiag as unknown as DiagramData);
      const iconCount = await page.locator(".ms-nodes-layer svg rect, .ms-nodes-layer svg text").count();
      assert.ok(iconCount >= 1, "Modelica icon mode must render icon primitives in Chromium");

      // ── TIER 1B: PSCAD Drag + XML Writeback + Re-render Sync ──
      let pscadXml = `<project name="PscadE2E" version="5.0.1"><definitions><definition name="Main"><schematic>
        <User classid="UserCmp" id="u1" name="master:source_3" x="126" y="180"><paramlist><param name="Name" value="Grid"/></paramlist></User>
        <User classid="UserCmp" id="u2" name="master:tline" x="252" y="180"><paramlist><param name="Name" value="Line1"/></paramlist></User>
        <Wire classid="WireOrthogonal" id="w1" x="162" y="180"><vertex x="0" y="0"/><vertex x="54" y="0"/></Wire>
      </schematic></definition></definitions></project>`;
      const toPscadDiag = (xml: string) =>
        cellsToDiagramData(buildPscadDiagram(parsePscx(xml)) as never, { className: "Main" });
      const pscadInitial = toPscadDiag(pscadXml);
      const pscadNodeId = pscadInitial.nodes.find(
        (n) => n.id.includes("u2") || (n.data as { name?: string })?.name === "Line1",
      )!.id;
      await loadDiagramInBrowser(pscadInitial as unknown as DiagramData);
      const pscadBox = await page.locator(`[data-cell-id="${pscadNodeId}"]`).boundingBox();
      assert.ok(pscadBox, "PSCAD Line1 must render");
      await page.mouse.move(pscadBox.x + pscadBox.width / 2, pscadBox.y + pscadBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(pscadBox.x + pscadBox.width / 2, pscadBox.y + pscadBox.height / 2 - 40, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          (
            window as unknown as { __polyglotDiagramHarness: { getActions: () => { type: string }[] } }
          ).__polyglotDiagramHarness
            .getActions()
            .some((a) => a.type === "move"),
        undefined,
        { timeout: 5000 },
      );
      const pscadMove = (
        await page.evaluate(() =>
          (
            window as unknown as { __polyglotDiagramHarness: { getActions: () => DiagramEditAction[] } }
          ).__polyglotDiagramHarness.getActions(),
        )
      ).find((a) => a.type === "move") as Extract<DiagramEditAction, { type: "move" }>;
      const pscadPlan = planDiagramActions(pscadXml, [pscadMove]);
      assert.equal(pscadPlan.unresolved.length, 0);
      pscadXml = applyLspEdits(pscadXml, pscadPlan.edits);
      await loadDiagramInBrowser(toPscadDiag(pscadXml) as unknown as DiagramData);

      // ── TIER 1C: SysML v2 + OWL 2 Edit Sync ──
      let sysmlCode = `package P {\n  part def Vehicle;\n  part def Engine;\n}\n`;
      const sysmlEdits = computeSysML2ElementInsert(sysmlCode, "part def", "Wheel", "P");
      if (sysmlEdits.length > 0) sysmlCode = applyLspEdits(sysmlCode, sysmlEdits);
      assert.ok(sysmlCode.includes("Wheel"), "SysML2 element insert writeback must update source");

      let owlCode = `Prefix(:=<http://example.org/>)\nOntology(<http://example.org/ont>\nDeclaration(Class(:Sensor))\n)\n`;
      const owlEdits = computeOWL2ElementInsert(owlCode, "Class", "Actuator");
      if (owlEdits.length > 0) owlCode = applyLspEdits(owlCode, owlEdits);
      assert.ok(owlCode.includes("Actuator"), "OWL2 element insert writeback must update source");

      // ── TIER 2: Parameterized Polyglot Diagram Viewer & Interactive Selection Verification ──
      const polyglotCases: Array<{ lang: string; build: () => DiagramData }> = [
        {
          lang: "spice",
          build: () =>
            cellsToDiagramData(
              buildSpiceDiagram({
                title: "RC",
                components: [
                  { id: "R1", kind: "R", name: "R1", value: "1k", nodes: ["in", "out"] },
                  { id: "C1", kind: "C", name: "C1", value: "1u", nodes: ["out", "0"] },
                ],
                nets: ["in", "out", "0"],
              } as never) as never,
              { className: "RC" },
            ) as unknown as DiagramData,
        },
        {
          lang: "simulink",
          build: () =>
            cellsToDiagramData(
              buildSimulinkDiagram({
                name: "Sim",
                blocks: [
                  { name: "Step", type: "Step", sid: "1", position: [40, 40, 80, 70] },
                  { name: "Gain", type: "Gain", sid: "2", position: [180, 40, 220, 70] },
                ],
                lines: [{ srcBlock: "Step", srcPort: 1, dstBlock: "Gain", dstPort: 1 }],
              } as never) as never,
              { className: "Sim" },
            ) as unknown as DiagramData,
        },
        {
          lang: "psse",
          build: () =>
            cellsToDiagramData(
              buildPsseDiagram({
                buses: [
                  { number: 1, name: "Bus1", baseKv: 230, type: 3 },
                  { number: 2, name: "Bus2", baseKv: 230, type: 1 },
                ],
                branches: [{ fromBus: 1, toBus: 2, id: "1", r: 0.01, x: 0.1 }],
                generators: [{ bus: 1, id: "1", pGen: 100 }],
                loads: [{ bus: 2, id: "1", pLoad: 95 }],
              } as never) as never,
              { className: "PSSE" },
            ) as unknown as DiagramData,
        },
        {
          lang: "opendss",
          build: () =>
            cellsToDiagramData(
              buildOpenDssDiagram({
                circuitName: "Feeder",
                buses: [{ name: "B1" }, { name: "B2" }],
                lines: [{ name: "L1", bus1: "B1", bus2: "B2", length: 1.5 }],
                loads: [{ name: "Load1", bus1: "B2", kw: 500 }],
              } as never) as never,
              { className: "Feeder" },
            ) as unknown as DiagramData,
        },
        {
          lang: "swmm",
          build: () =>
            cellsToDiagramData(
              buildSwmmDiagram({
                title: "Drainage",
                junctions: [{ name: "J1", invertElevation: 10, maxDepth: 4 }],
                outfalls: [{ name: "O1", invertElevation: 8 }],
                conduits: [{ name: "C1", inletNode: "J1", outletNode: "O1", length: 100 }],
              } as never) as never,
              { className: "Drainage" },
            ) as unknown as DiagramData,
        },
        {
          lang: "sbml",
          build: () =>
            cellsToDiagramData(
              buildSbmlDiagram({
                id: "Pathway",
                compartments: [{ id: "cell", name: "Cell" }],
                species: [
                  { id: "S1", name: "A", compartment: "cell" },
                  { id: "S2", name: "B", compartment: "cell" },
                ],
                reactions: [
                  {
                    id: "R1",
                    reactants: [{ species: "S1", stoichiometry: 1 }],
                    products: [{ species: "S2", stoichiometry: 1 }],
                  },
                ],
              } as never) as never,
              { className: "Pathway" },
            ) as unknown as DiagramData,
        },
        {
          lang: "plcopen",
          build: () => {
            const res = buildPlcopenDiagram({
              name: "PLC",
              pous: [
                {
                  name: "Main",
                  pouType: "program",
                  bodyType: "FBD",
                  variables: [],
                  body: { st: "Done := Start;" },
                  blocks: [{ localId: 1, typeName: "TON", position: { x: 80, y: 80 } }],
                  inVariables: [{ localId: 2, expression: "Start", position: { x: 20, y: 80 } }],
                  outVariables: [{ localId: 3, expression: "Done", position: { x: 200, y: 80 } }],
                  connections: [],
                },
              ],
            } as never) as unknown as { diagram?: DiagramData } & DiagramData;
            return (res.diagram ?? res) as DiagramData;
          },
        },
        {
          lang: "relap5",
          build: () =>
            cellsToDiagramData(
              buildRelap5Diagram({
                title: "Loop",
                volumes: [
                  { number: 100, name: "Pipe", type: "pipe" },
                  { number: 200, name: "Pump", type: "pump" },
                ],
                components: [
                  { number: "100", name: "Pipe", type: "pipe" },
                  { number: "200", name: "Pump", type: "pump" },
                ],
                junctions: [{ number: "150", fromComponent: "100", toComponent: "200" }],
              } as never) as never,
              { className: "Loop" },
            ) as unknown as DiagramData,
        },
        {
          lang: "olga",
          build: () =>
            cellsToDiagramData(
              buildOlgaDiagram({
                caseName: "Pipeline",
                nodes: [
                  { name: "Well", type: "SOURCE", x: 0, y: 0 },
                  { name: "Separator", type: "TERMINAL", x: 300, y: 0 },
                ],
                branches: [{ name: "Flowline", from: "Well", to: "Separator", length: 5000 }],
              } as never) as never,
              { className: "Pipeline" },
            ) as unknown as DiagramData,
        },
        {
          lang: "oscal",
          build: () =>
            cellsToDiagramData(
              buildOscalDiagram({
                title: "SSP",
                components: [{ uuid: "c1", title: "Firewall", type: "software" }],
                implementedRequirements: [{ uuid: "r1", controlId: "AC-2" }],
              } as never) as never,
              { className: "SSP" },
            ) as unknown as DiagramData,
        },
        {
          lang: "verilog-a",
          build: () =>
            cellsToDiagramData(
              buildVerilogADiagram({
                name: "res",
                ports: ["p", "n"],
                branches: [
                  {
                    id: "br1",
                    node1: "p",
                    node2: "n",
                    nature: "I",
                    category: "resistive",
                    expression: "V(p,n)/1000",
                  },
                ],
              } as never) as never,
              { className: "res" },
            ) as unknown as DiagramData,
        },
        {
          lang: "touchstone",
          build: () =>
            cellsToDiagramData(
              buildTouchstoneDiagram({
                numPorts: 2,
                frequencies: [1e9, 2e9],
                matrix: [],
              } as never) as never,
              { className: "S2P" },
            ) as unknown as DiagramData,
        },
        {
          lang: "rocets",
          build: () =>
            cellsToDiagramData(
              buildRocetsDiagram({
                name: "Engine",
                components: [
                  { id: "Pump", type: "pump" },
                  { id: "Chamber", type: "chamber" },
                ],
                connections: [{ from: "Pump", to: "Chamber", fluid: "LOX" }],
              } as never) as never,
              { className: "Engine" },
            ) as unknown as DiagramData,
        },
        {
          lang: "openscenario",
          build: () =>
            cellsToDiagramData(
              buildOpenScenarioDiagram({
                entities: [{ name: "Ego", category: "car" }],
                acts: [{ name: "Act1", maneuvers: [{ name: "LaneChange" }] }],
              } as never) as never,
              { className: "XOSC" },
            ) as unknown as DiagramData,
        },
        {
          lang: "molecular",
          build: () => {
            const mol = buildMolecularDiagramFromSmiles("CCO", { title: "Ethanol" });
            return {
              className: "Ethanol",
              nodes: mol.atoms.map((a) => ({
                id: a.id,
                shape: "circle",
                x: a.x - 14,
                y: a.y - 14,
                width: 28,
                height: 28,
                attrs: { body: { fill: "#1e293b", stroke: "#38bdf8" }, label: { text: a.element } },
              })),
              edges: mol.bonds.map((b) => ({
                id: b.id,
                source: b.fromId,
                target: b.toId,
              })),
            } as unknown as DiagramData;
          },
        },
        {
          lang: "autosar",
          build: () => {
            const res = buildAutosarDiagram({
              components: [
                { name: "SensorSwc", kind: "ApplicationSwComponentType", ports: [{ name: "Out", direction: "P" }] },
                { name: "CtrlSwc", kind: "ApplicationSwComponentType", ports: [{ name: "In", direction: "R" }] },
              ],
              connectors: [{ provider: "SensorSwc", providerPort: "Out", requester: "CtrlSwc", requesterPort: "In" }],
            } as never) as unknown as { cells?: unknown[]; nodes?: unknown[] };
            if (Array.isArray(res.cells)) {
              return cellsToDiagramData(res as never, { className: "AUTOSAR" }) as unknown as DiagramData;
            }
            if (Array.isArray(res.nodes)) {
              return res as unknown as DiagramData;
            }
            return buildPolyglotDiagram({
              language: "autosar",
              entities: [
                { id: "SensorSwc", label: "SensorSwc", kind: "swc" },
                { id: "CtrlSwc", label: "CtrlSwc", kind: "swc" },
              ],
              relations: [{ from: "SensorSwc", to: "CtrlSwc", label: "sig" }],
            } as never) as unknown as DiagramData;
          },
        },
        {
          lang: "polyglot-sysml2",
          build: () =>
            buildPolyglotDiagram(
              {
                symbols: new Map([
                  ["Veh", { id: "Veh", name: "Vehicle", kind: "part_def", parentId: null }],
                  ["Eng", { id: "Eng", name: "Engine", kind: "part", parentId: "Veh" }],
                ]),
                byName: new Map([
                  ["Vehicle", ["Veh"]],
                  ["Engine", ["Eng"]],
                ]),
                childrenOf: new Map([
                  [null, ["Veh"]],
                  ["Veh", ["Eng"]],
                ]),
              } as never,
              "sysml2",
            ) as unknown as DiagramData,
        },
      ];

      for (const tc of polyglotCases) {
        const diag = tc.build();
        await loadDiagramInBrowser(diag);
        const summary = await page.evaluate(() => {
          return (
            window as unknown as {
              __polyglotDiagramHarness: { getDomSummary: () => { nodeCount: number; nodeIds: string[] } };
            }
          ).__polyglotDiagramHarness.getDomSummary();
        });
        assert.ok(
          summary.nodeCount >= 1,
          `[${tc.lang}] Expected >= 1 rendered node in Chromium, got ${summary.nodeCount}`,
        );
        const firstId = summary.nodeIds.find((id) => !id.startsWith("__"));
        if (firstId) {
          const box = await page.locator(`.ms-nodes-layer > g[data-cell-id="${firstId}"]`).boundingBox();
          if (!box || box.width <= 0 || box.height <= 0) {
            const html = await page
              .locator(`.ms-nodes-layer > g[data-cell-id="${firstId}"]`)
              .evaluate((el) => el.outerHTML);
            assert.fail(
              `[${tc.lang}] Node ${firstId} must have non-zero bbox, got ${JSON.stringify(box)}, html=${html}`,
            );
          }
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
      }

      assert.deepEqual(pageErrors, [], `Unexpected Chromium page errors: ${pageErrors.join(" | ")}`);
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
      if (viteServer) await viteServer.close();
    }
  });
});
