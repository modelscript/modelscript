// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import { renderPscadSvg, type PscadProjectLike } from "@modelscript/diagram/pscad-diagram-builder";
import React, { useCallback, useMemo, useState } from "react";
import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import { parsePscx } from "../parser/pscx-parser.js";

type PscadTabId = "schematic" | "netlist" | "components" | "wires" | "definitions" | "simulate";

interface EmtNetlistRow {
  key: string;
  id: string;
  category: string;
  attachment: string;
  spec: string;
}

export const PscadPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  documentUri,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<PscadTabId>("schematic");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const [selectedModule, setSelectedModule] = useState<string>("");
  const [isRunningEmt, setIsRunningEmt] = useState(false);
  const [emtResult, setEmtResult] = useState<Record<string, unknown> | null>(null);
  const [emtError, setEmtError] = useState<string | null>(null);
  const canvasTheme = canvasThemeOverride ?? colorMode;

  const handleRunEmtAndIeee2800 = useCallback(async () => {
    if (!host.requestLsp) return;
    setIsRunningEmt(true);
    setEmtError(null);
    setActiveTab("simulate");
    try {
      const res = await host.requestLsp<Record<string, unknown>>("modelscript/executeAction", {
        actionId: "simulate_hybrid_emt",
        languageId: "pscad",
        uri: documentUri ?? "file:///project.pscx",
        documentText: code,
        verifyIeee2800: true,
        allowSyntheticFallback: true,
      });
      setEmtResult(res ?? null);
    } catch (err) {
      setEmtError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningEmt(false);
    }
  }, [code, documentUri, host]);

  const computed = useMemo(() => {
    if (!code.trim()) return { project: null, netlist: null, error: undefined as string | undefined };
    try {
      const project = parsePscx(code);
      let netlist: ReturnType<typeof extractEmtNetlist> | null = null;
      try {
        netlist = extractEmtNetlist(project);
      } catch {
        netlist = null;
      }
      return { project, netlist, error: undefined };
    } catch (err) {
      return { project: null, netlist: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.project?.name ||
    "PSCAD EMT Schematic";

  const moduleNames = useMemo(() => {
    if (!computed.project?.definitions) return [];
    const names: string[] = [];
    for (const [key, def] of computed.project.definitions.entries()) {
      const d = def as unknown as { classType?: string; name?: string };
      if (d.classType === "module" || key === "Main") {
        names.push(d.name ?? key);
      }
    }
    return names;
  }, [computed.project]);

  const mainMod = computed.project?.rootModule ?? null;
  const components = mainMod?.components ?? [];
  const wires = mainMod?.wires ?? [];

  const netlistRows = useMemo<EmtNetlistRow[]>(() => {
    const net = computed.netlist;
    if (!net) return [];
    const rows: EmtNetlistRow[] = [];
    for (const src of net.sources ?? []) {
      rows.push({
        key: `src-${src.id}`,
        id: src.id,
        category: "Source",
        attachment: src.bus,
        spec: `${src.vPeakKv.toFixed(1)} kVpk · ${src.frequencyHz} Hz`,
      });
    }
    for (const sm of net.synchronousMachines ?? []) {
      rows.push({
        key: `sm-${sm.id}`,
        id: sm.id,
        category: "Sync Machine",
        attachment: sm.bus,
        spec: `${sm.ratedMva} MVA · ${sm.ratedKvLL} kV`,
      });
    }
    for (const fmu of net.fmuInstances ?? []) {
      rows.push({
        key: `fmu-${fmu.id}`,
        id: fmu.id,
        category: "IBR / FMU",
        attachment: fmu.busConnection,
        spec: `${fmu.ratedMva} MVA · ${fmu.ratedKv} kV`,
      });
    }
    for (const ln of net.transmissionLines ?? []) {
      rows.push({
        key: `line-${ln.id}`,
        id: ln.id,
        category: "Transmission Line",
        attachment: `${ln.fromBus} ↔ ${ln.toBus}`,
        spec: `${ln.lengthKm} km (${ln.modelType})`,
      });
    }
    for (const vdl of net.voltageDependentLoads ?? []) {
      rows.push({
        key: `load-${vdl.id}`,
        id: vdl.id,
        category: "Dynamic Load",
        attachment: vdl.busId,
        spec: `${vdl.p0Mw} MW / ${vdl.q0Mvar} Mvar`,
      });
    }
    return rows;
  }, [computed.netlist]);

  type CompRow = (typeof components)[number];
  type WireRow = (typeof wires)[number];

  const netlistColumns = useMemo<PanelDataGridColumn<EmtNetlistRow>[]>(
    () => [
      { key: "id", label: "Element", mono: true, sortValue: (r) => r.id, render: (r) => <strong>{r.id}</strong> },
      {
        key: "category",
        label: "Category",
        sortValue: (r) => r.category,
        render: (r) => (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "999px",
              background: "var(--ms-status-info-bg)",
              color: "var(--ms-status-info-fg)",
            }}
          >
            {r.category}
          </span>
        ),
      },
      {
        key: "attachment",
        label: "Bus / Nodes",
        mono: true,
        sortValue: (r) => r.attachment,
        render: (r) => r.attachment,
      },
      {
        key: "spec",
        label: "Rating / Spec",
        mono: true,
        sortValue: (r) => r.spec,
        render: (r) => <span style={{ color: "var(--ms-text-2)" }}>{r.spec}</span>,
      },
    ],
    [],
  );

  const compColumns = useMemo<PanelDataGridColumn<CompRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (c) => String(c.id), render: (c) => <strong>{c.id}</strong> },
      {
        key: "name",
        label: "Name",
        mono: true,
        sortValue: (c) => c.instanceName ?? c.definitionName ?? "",
        render: (c) => c.instanceName ?? c.definitionName,
      },
      {
        key: "pos",
        label: "Position",
        mono: true,
        sortValue: (c) => c.position.x,
        render: (c) => (
          <span style={{ color: "var(--ms-text-2)" }}>
            ({c.position.x}, {c.position.y})
          </span>
        ),
      },
    ],
    [],
  );

  const wireColumns = useMemo<PanelDataGridColumn<WireRow>[]>(
    () => [
      {
        key: "id",
        label: "Wire ID",
        mono: true,
        sortValue: (w) => String(w.id),
        render: (w) => <strong>#{w.id}</strong>,
      },
      {
        key: "origin",
        label: "Start",
        mono: true,
        sortValue: (w) => w.vertices[0]?.x ?? 0,
        render: (w) => `(${w.vertices[0]?.x ?? 0}, ${w.vertices[0]?.y ?? 0})`,
      },
      {
        key: "vertices",
        label: "Vertices",
        align: "right",
        mono: true,
        sortValue: (w) => w.vertices.length,
        render: (w) => w.vertices.length,
      },
    ],
    [],
  );

  const svg = useMemo(() => {
    if (!computed.project) return "";
    try {
      return renderPscadSvg(computed.project as unknown as PscadProjectLike, {
        theme: canvasTheme,
        ...(selectedModule ? { moduleName: selectedModule } : {}),
      });
    } catch {
      return "";
    }
  }, [computed.project, canvasTheme, selectedModule]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const defCount = computed.project?.definitions?.size ?? 0;
    return [
      { label: "Definitions", value: defCount, tone: "info" },
      { label: "Components", value: components.length },
      { label: "Wires", value: wires.length },
      { label: "EMT Elements", value: netlistRows.length, tone: netlistRows.length > 0 ? "success" : "neutral" },
    ];
  }, [computed.project, components.length, wires.length, netlistRows.length]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="PSCAD / EMTDC Schematic"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "PSCAD", tone: "info" }}
        actions={
          <>
            {host.requestLsp && (
              <PanelButton variant="primary" onClick={() => void handleRunEmtAndIeee2800()} disabled={isRunningEmt}>
                {isRunningEmt ? "Simulating…" : "Run EMT + IEEE 2800"}
              </PanelButton>
            )}
            {activeTab === "schematic" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("pscad-schematic.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "pscad", title)}>
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<PscadTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "EMT Schematic" },
          { id: "netlist", label: "EMT Netlist", count: netlistRows.length },
          { id: "components", label: "Components", count: components.length },
          { id: "wires", label: "Wires", count: wires.length },
          { id: "definitions", label: "Definitions & Scripts", count: computed.project?.definitions?.size ?? 0 },
          { id: "simulate", label: "EMT & IEEE 2800" },
        ]}
      />

      {activeTab === "schematic" && (
        <PanelSvgStage
          svg={svg}
          canvasTheme={canvasTheme}
          onToggleCanvasTheme={() =>
            setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
          }
          onRevealLine={host.onRevealLine}
          hudExtra={
            moduleNames.length > 1 ? (
              <select
                aria-label="Select PSCAD module page"
                value={selectedModule}
                onChange={(e) => setSelectedModule(e.target.value)}
                style={{
                  fontSize: "11px",
                  padding: "2px 6px",
                  borderRadius: "5px",
                  border: "1px solid var(--ms-border)",
                  background: "var(--ms-bg-soft)",
                  color: "var(--ms-text-1)",
                }}
              >
                <option value="">Main Canvas</option>
                {moduleNames.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : undefined
          }
          emptyMessage={computed.error ?? "Load a PSCAD (.pscx / .pslx) project to view the EMT schematic."}
        />
      )}

      {activeTab === "netlist" && (
        <PanelDataGrid
          rows={netlistRows}
          columns={netlistColumns}
          rowKey={(r) => r.key}
          searchPlaceholder="Filter EMT netlist by element, category, or bus…"
          emptyMessage="No electrical EMT netlist elements extracted."
        />
      )}

      {activeTab === "components" && (
        <PanelDataGrid
          rows={components}
          columns={compColumns}
          rowKey={(inst, idx) => `${inst.id}-${idx}`}
          searchPlaceholder="Filter PSCAD components by ID or name…"
          emptyMessage="No PSCAD components parsed."
        />
      )}

      {activeTab === "wires" && (
        <PanelDataGrid
          rows={wires}
          columns={wireColumns}
          rowKey={(w, idx) => `${w.id}-${idx}`}
          searchPlaceholder="Filter PSCAD wires by ID…"
          emptyMessage="No PSCAD wires parsed."
        />
      )}

      {activeTab === "definitions" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          {computed.project?.definitions && computed.project.definitions.size > 0 ? (
            Array.from(computed.project.definitions.entries()).map(([key, def]) => {
              const d = def as unknown as {
                name?: string;
                classType?: string;
                scripts?: Record<string, string>;
              };
              const scriptEntries = Object.entries(d.scripts ?? {}).filter(([, body]) => body.trim().length > 0);
              return (
                <div
                  key={key}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: "var(--ms-bg-alt)",
                    border: "1px solid var(--ms-border)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600 }}>
                    <span style={{ fontFamily: "var(--ms-font-mono)" }}>{d.name ?? key}</span>
                    <span style={{ color: "var(--ms-text-2)", fontSize: "11px" }}>
                      {d.classType ?? "component"} · {scriptEntries.length} script segment(s)
                    </span>
                  </div>
                  {scriptEntries.map(([segName, segBody]) => (
                    <details key={segName} style={{ marginTop: "6px" }}>
                      <summary style={{ cursor: "pointer", fontSize: "11px", fontWeight: 600 }}>{segName}</summary>
                      <pre
                        style={{
                          margin: "4px 0 0",
                          padding: "8px",
                          borderRadius: "4px",
                          background: "var(--ms-bg-soft)",
                          fontFamily: "var(--ms-font-mono)",
                          fontSize: "11px",
                          overflowX: "auto",
                        }}
                      >
                        {segBody}
                      </pre>
                    </details>
                  ))}
                </div>
              );
            })
          ) : (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
              No PSCAD definitions or script segments found.
            </div>
          )}
        </div>
      )}

      {activeTab === "simulate" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {emtError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #ef4444",
                color: "#ef4444",
                fontSize: "12px",
              }}
            >
              {emtError}
            </div>
          )}
          {!emtResult ? (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
              Click <strong>Run EMT + IEEE 2800</strong> to execute the hybrid Dommel EMT simulation and IEEE 2800-2022
              IBR compliance verification via the language server.
            </div>
          ) : (
            <pre
              style={{
                margin: 0,
                padding: "10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "11px",
                overflowX: "auto",
              }}
            >
              {JSON.stringify(emtResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default PscadPanel;
