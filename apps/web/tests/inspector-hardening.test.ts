// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelicaPanel } from "../../../languages/modelica/src/ui/ModelicaPanel.js";
import { PscadPanel } from "../../../languages/pscad/src/ui/PscadPanel.js";
import { PssePanel } from "../../../languages/psse/src/ui/PssePanel.js";
import { SysmlPanel } from "../../../languages/sysml2/src/ui/SysmlPanel.js";
import {
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  type PanelDataGridColumn,
} from "../../../packages/design-tokens/src/components/LanguagePanelPrimitives.js";
import {
  InspectorErrorBoundary,
  InspectorLoadingSkeleton,
} from "../../../packages/editor/src/workbench/panels/InspectorErrorBoundary.js";

describe("Inspector View Hardening & UI Primitives", () => {
  it("PanelSvgStage v2 renders Fit, Map, Zoom HUD, and optional theme toggle", () => {
    const html = renderToStaticMarkup(
      React.createElement(PanelSvgStage, {
        svg: '<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>',
        canvasTheme: "light",
        onToggleCanvasTheme: () => {},
      }),
    );
    assert.match(html, /role="region"/);
    assert.match(html, /Fit/);
    assert.match(html, /Map/);
    assert.match(html, /100%/);
    assert.match(html, /Scroll to zoom/);
    assert.match(html, /background:#f8fafc/);
  });

  it("PanelDataGrid renders search bar, sortable headers, and pagination without silent truncation", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1, name: `Bus_${i + 1}` }));
    const columns: PanelDataGridColumn<(typeof rows)[number]>[] = [
      { key: "id", label: "ID", mono: true, sortValue: (r) => r.id, render: (r) => r.id },
      { key: "name", label: "Name", sortValue: (r) => r.name, render: (r) => r.name },
    ];
    const html = renderToStaticMarkup(
      React.createElement(PanelDataGrid, {
        rows,
        columns,
        rowKey: (r) => String(r.id),
        pageSize: 100,
      }),
    );
    assert.match(html, /1–100 of 250/);
    assert.match(html, /Prev/);
    assert.match(html, /Next/);
    assert.match(html, /position:sticky/);
  });

  it("PanelShell and PanelKpiStrip respect light/dark fallback theme and tabular-nums", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        PanelShell,
        { mode: "inspector", colorMode: "light" },
        React.createElement(PanelKpiStrip, {
          items: [
            { label: "Buses", value: 10, tone: "info" },
            { label: "AC Power Flow", value: "OK (3 it)", tone: "success" },
          ],
        }),
      ),
    );
    assert.match(html, /data-theme="light"/);
    assert.match(html, /tabular-nums/);
    assert.match(html, /OK \(3 it\)/);
  });

  it("InspectorLoadingSkeleton renders accessible status indicator", () => {
    const html = renderToStaticMarkup(React.createElement(InspectorLoadingSkeleton, { label: "Loading PSS/E…" }));
    assert.match(html, /role="status"/);
    assert.match(html, /Loading PSS\/E…/);
  });

  it("InspectorErrorBoundary renders children cleanly when healthy", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        InspectorErrorBoundary,
        { panelName: "PSS/E Inspector" },
        React.createElement("div", null, "Healthy panel content"),
      ),
    );
    assert.match(html, /Healthy panel content/);
  });

  it("PssePanel renders consolidated workbench tabs including Studies and solver selector", () => {
    const html = renderToStaticMarkup(
      React.createElement(PssePanel, {
        code: "",
        dialect: "psse",
        colorMode: "light",
        mode: "inspector",
        host: {},
      }),
    );
    assert.match(html, /Single-Line Diagram/);
    assert.match(html, /Branches &amp; Xfmrs/);
    assert.match(html, /Studies/);
    assert.match(html, /Newton-Raphson/);
    assert.match(html, /Fast Decoupled/);
  });

  it("PscadPanel renders EMT Schematic, EMT Netlist tab, and light theme parity", () => {
    const html = renderToStaticMarkup(
      React.createElement(PscadPanel, {
        code: "",
        dialect: "pscad",
        colorMode: "light",
        mode: "inspector",
        host: {},
      }),
    );
    assert.match(html, /data-theme="light"/);
    assert.match(html, /EMT Schematic/);
    assert.match(html, /EMT Netlist/);
    assert.match(html, /Components/);
  });

  it("SysmlPanel renders Architecture Graph SVG with satisfy edges, light theme, and data-line attributes", () => {
    const sysmlCode = [
      "package Powertrain {",
      "  requirement <'REQ-1'> ThermalLimit {",
      "    doc /* Keep battery under 60 C */",
      "  }",
      "  part def BatteryPack;",
      "  part battery : BatteryPack;",
      "  satisfy ThermalLimit by battery;",
      "}",
    ].join("\n");
    const html = renderToStaticMarkup(
      React.createElement(SysmlPanel, {
        code: sysmlCode,
        dialect: "sysml2",
        colorMode: "light",
        mode: "inspector",
        host: {},
      }),
    );
    assert.match(html, /Architecture Graph/);
    assert.match(html, /background:#f8fafc/);
    assert.match(html, /data-line="2"/);
    assert.match(html, /«requirement»/);
    assert.match(html, /marker-end="url\(#sysml-sat\)"/);
  });

  it("ModelicaPanel renders diagram stage with canvas theme toggle and Edit Properties shortcut", () => {
    const moCode = [
      "model SimpleRC",
      "  parameter Real R = 100;",
      "  Real v(start = 1);",
      "equation",
      "  der(v) = -v / R;",
      "end SimpleRC;",
    ].join("\n");
    const html = renderToStaticMarkup(
      React.createElement(ModelicaPanel, {
        code: moCode,
        dialect: "modelica",
        colorMode: "light",
        mode: "inspector",
        host: {},
      }),
    );
    assert.match(html, /data-theme="light"/);
    assert.match(html, /Edit Properties/);
    assert.match(html, /Toggle schematic canvas theme/);
  });
});
