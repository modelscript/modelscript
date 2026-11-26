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
import React, { useMemo, useState } from "react";

type SysmlTabId = "diagram" | "requirements" | "elements" | "traceability";

interface SysmlRequirementRow {
  id: string;
  name: string;
  doc: string;
  satisfiedBy: string[];
  verifiedBy: string[];
  line: number;
}

interface SysmlElementRow {
  kind: string;
  name: string;
  type?: string | undefined;
  line: number;
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderSysmlOverviewSvg(
  requirements: SysmlRequirementRow[],
  elements: SysmlElementRow[],
  theme: "light" | "dark",
): string {
  const isLight = theme === "light";
  const pal = isLight
    ? {
        bg: "#f8fafc",
        grid: "#cbd5e1",
        cardBg: "#ffffff",
        reqStroke: "#0e7490",
        partStroke: "#4f46e5",
        satStroke: "#059669",
        verStroke: "#7c3aed",
        fg: "#0f172a",
        fgMuted: "#475569",
      }
    : {
        bg: "#0b0f19",
        grid: "#1e293b",
        cardBg: "#111827",
        reqStroke: "#22d3ee",
        partStroke: "#818cf8",
        satStroke: "#34d399",
        verStroke: "#a78bfa",
        fg: "#f8fafc",
        fgMuted: "#94a3b8",
      };

  const reqNodes = requirements.slice(0, 24);
  const elNodes = elements.filter((e) => e.kind !== "package").slice(0, 24);
  if (reqNodes.length === 0 && elNodes.length === 0) return "";

  const boxW = 196;
  const boxH = 54;
  const gapX = 28;
  const rowGap = 110;
  const pad = 48;

  const colsReq = Math.max(1, Math.min(4, reqNodes.length));
  const colsEl = Math.max(1, Math.min(4, elNodes.length));
  const maxCols = Math.max(colsReq, colsEl);
  const totalW = Math.max(640, maxCols * (boxW + gapX) - gapX + pad * 2);

  const reqRows = Math.ceil(reqNodes.length / 4);
  const elRows = Math.ceil(elNodes.length / 4);
  const reqSectionH = reqRows > 0 ? reqRows * (boxH + 22) + rowGap : 0;
  const totalH = Math.max(320, pad * 2 + reqSectionH + Math.max(1, elRows) * (boxH + 22));

  const posMap = new Map<string, { x: number; y: number }>();
  let nodesSvg = "";
  let edgesSvg = "";

  reqNodes.forEach((r, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = pad + col * (boxW + gapX);
    const y = pad + row * (boxH + 22);
    posMap.set(r.name, { x, y });
    posMap.set(r.id, { x, y });
    const shortName = r.name.length > 22 ? `${r.name.slice(0, 21)}…` : r.name;
    const shortDoc = (r.doc || r.id).slice(0, 28);
    nodesSvg += `<g data-entity-id="req_${escapeXml(r.id)}" data-entity-kind="requirement" data-line="${r.line}" style="cursor:pointer;">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="${pal.cardBg}" stroke="${pal.reqStroke}" stroke-width="1.6" />
      <text x="${x + boxW / 2}" y="${y + 15}" text-anchor="middle" fill="${pal.reqStroke}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="600">«requirement»</text>
      <text x="${x + boxW / 2}" y="${y + 30}" text-anchor="middle" fill="${pal.fg}" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">${escapeXml(shortName)}</text>
      <text x="${x + boxW / 2}" y="${y + 44}" text-anchor="middle" fill="${pal.fgMuted}" font-family="Inter,system-ui,sans-serif" font-size="9">${escapeXml(shortDoc)}</text>
    </g>\n`;
  });

  elNodes.forEach((el, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = pad + col * (boxW + gapX);
    const y = pad + reqSectionH + row * (boxH + 22);
    posMap.set(el.name, { x, y });
    const shortName = el.name.length > 22 ? `${el.name.slice(0, 21)}…` : el.name;
    const sub = el.type ? `: ${el.type.slice(0, 22)}` : `Line ${el.line}`;
    nodesSvg += `<g data-entity-id="el_${escapeXml(el.name)}" data-entity-kind="${escapeXml(el.kind)}" data-line="${el.line}" style="cursor:pointer;">
      <rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" fill="${pal.cardBg}" stroke="${pal.partStroke}" stroke-width="1.5" />
      <text x="${x + boxW / 2}" y="${y + 15}" text-anchor="middle" fill="${pal.partStroke}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="600">«${escapeXml(el.kind)}»</text>
      <text x="${x + boxW / 2}" y="${y + 30}" text-anchor="middle" fill="${pal.fg}" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="700">${escapeXml(shortName)}</text>
      <text x="${x + boxW / 2}" y="${y + 44}" text-anchor="middle" fill="${pal.fgMuted}" font-family="Inter,system-ui,sans-serif" font-size="9">${escapeXml(sub)}</text>
    </g>\n`;
  });

  // Draw satisfy & verify traceability arrows
  for (const r of reqNodes) {
    const reqPos = posMap.get(r.name) ?? posMap.get(r.id);
    if (!reqPos) continue;
    for (const sat of r.satisfiedBy) {
      const targetName = sat.split(".").pop() ?? sat;
      const elPos = posMap.get(sat) ?? posMap.get(targetName);
      if (!elPos) continue;
      const x1 = elPos.x + boxW / 2;
      const y1 = elPos.y;
      const x2 = reqPos.x + boxW / 2;
      const y2 = reqPos.y + boxH;
      const midY = (y1 + y2) / 2;
      edgesSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${pal.satStroke}" stroke-width="1.6" stroke-dasharray="5 3" marker-end="url(#sysml-sat)" />\n`;
    }
    for (const ver of r.verifiedBy) {
      const targetName = ver.split(".").pop() ?? ver;
      const elPos = posMap.get(ver) ?? posMap.get(targetName);
      if (!elPos) continue;
      const x1 = elPos.x + boxW / 2 + 12;
      const y1 = elPos.y;
      const x2 = reqPos.x + boxW / 2 + 12;
      const y2 = reqPos.y + boxH;
      const midY = (y1 + y2) / 2;
      edgesSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${pal.verStroke}" stroke-width="1.5" stroke-dasharray="3 3" marker-end="url(#sysml-ver)" />\n`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" height="100%" style="background:${pal.bg};">
  <defs>
    <pattern id="sysml-grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="${pal.grid}" stroke-width="0.5" opacity="0.5" />
    </pattern>
    <marker id="sysml-sat" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${pal.satStroke}" />
    </marker>
    <marker id="sysml-ver" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${pal.verStroke}" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${totalW}" height="${totalH}" fill="url(#sysml-grid)" />
  <g>${edgesSvg}</g>
  <g>${nodesSvg}</g>
</svg>`;
}

function scanSysml2(code: string) {
  const lines = code.split(/\r?\n/);
  const requirements: SysmlRequirementRow[] = [];
  const elements: SysmlElementRow[] = [];
  const satisfyMap = new Map<string, string[]>();
  const verifyMap = new Map<string, string[]>();

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;

    const reqMatch = /\brequirement\s+(?:def\s+)?(?:<'([^']+)'>\s*)?([A-Za-z_]\w*)/.exec(trimmed);
    if (reqMatch) {
      let doc = "";
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const docMatch = /doc\s*\/\*([\s\S]*?)\*\//.exec(lines[j]!);
        if (docMatch) {
          doc = docMatch[1]!.trim();
          break;
        }
        if (lines[j]!.includes("}")) break;
      }
      requirements.push({
        id: reqMatch[1] ?? reqMatch[2]!,
        name: reqMatch[2]!,
        doc,
        satisfiedBy: [],
        verifiedBy: [],
        line: lineNum,
      });
      continue;
    }

    const satMatch = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_][\w.:]*)\s+by\s+([A-Za-z_][\w.:]*)/.exec(trimmed);
    if (satMatch) {
      const arr = satisfyMap.get(satMatch[1]!) ?? [];
      arr.push(satMatch[2]!);
      satisfyMap.set(satMatch[1]!, arr);
      continue;
    }

    const verMatch = /\bverify\s+(?:requirement\s+)?([A-Za-z_][\w.:]*)\s+by\s+([A-Za-z_][\w.:]*)/.exec(trimmed);
    if (verMatch) {
      const arr = verifyMap.get(verMatch[1]!) ?? [];
      arr.push(verMatch[2]!);
      verifyMap.set(verMatch[1]!, arr);
      continue;
    }

    const elMatch =
      /\b(package|part\s+def|part|port\s+def|port|action\s+def|action|state\s+def|state|attribute|constraint\s+def|verification\s+def)\s+([A-Za-z_]\w*)(?:\s*:\s*([A-Za-z_][\w.:]*))?/.exec(
        trimmed,
      );
    if (elMatch) {
      elements.push({
        kind: elMatch[1]!.replace(/\s+/g, " "),
        name: elMatch[2]!,
        type: elMatch[3],
        line: lineNum,
      });
    }
  }

  for (const r of requirements) {
    r.satisfiedBy = satisfyMap.get(r.name) ?? satisfyMap.get(r.id) ?? [];
    r.verifiedBy = verifyMap.get(r.name) ?? verifyMap.get(r.id) ?? [];
  }

  return { requirements, elements };
}

export const SysmlPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<SysmlTabId>("diagram");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const canvasTheme = canvasThemeOverride ?? colorMode;

  const scanned = useMemo(() => scanSysml2(code), [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "SysML v2 Requirements & Elements";

  const diagramSvg = useMemo(
    () => renderSysmlOverviewSvg(scanned.requirements, scanned.elements, canvasTheme),
    [scanned.requirements, scanned.elements, canvasTheme],
  );

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const reqs = scanned.requirements.length;
    const satisfied = scanned.requirements.filter((r) => r.satisfiedBy.length > 0).length;
    const verified = scanned.requirements.filter((r) => r.verifiedBy.length > 0).length;
    return [
      { label: "Requirements", value: reqs, tone: "info" },
      {
        label: "Satisfied",
        value: `${satisfied}/${reqs}`,
        tone: satisfied === reqs && reqs > 0 ? "success" : "neutral",
      },
      { label: "Verified", value: `${verified}/${reqs}`, tone: verified === reqs && reqs > 0 ? "success" : "neutral" },
      { label: "Model Elements", value: scanned.elements.length },
    ];
  }, [scanned]);

  const reqColumns = useMemo<PanelDataGridColumn<SysmlRequirementRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (r) => r.id, render: (r) => <strong>{r.id}</strong> },
      { key: "name", label: "Name", sortValue: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
      {
        key: "doc",
        label: "Specification",
        sortValue: (r) => r.doc,
        render: (r) => <span style={{ color: "var(--ms-text-2)" }}>{r.doc || "—"}</span>,
      },
      {
        key: "satisfiedBy",
        label: "Satisfied By",
        mono: true,
        sortValue: (r) => r.satisfiedBy.join(", "),
        render: (r) => (r.satisfiedBy.length > 0 ? r.satisfiedBy.join(", ") : "—"),
      },
      {
        key: "verifiedBy",
        label: "Verified By",
        mono: true,
        sortValue: (r) => r.verifiedBy.join(", "),
        render: (r) => (r.verifiedBy.length > 0 ? r.verifiedBy.join(", ") : "—"),
      },
    ],
    [],
  );

  const elementColumns = useMemo<PanelDataGridColumn<SysmlElementRow>[]>(
    () => [
      {
        key: "kind",
        label: "Kind",
        mono: true,
        sortValue: (e) => e.kind,
        render: (e) => <span style={{ color: "var(--ms-brand)" }}>{e.kind}</span>,
      },
      { key: "name", label: "Name", mono: true, sortValue: (e) => e.name, render: (e) => <strong>{e.name}</strong> },
      {
        key: "type",
        label: "Type",
        mono: true,
        sortValue: (e) => e.type ?? "",
        render: (e) => <span style={{ color: "var(--ms-text-2)" }}>{e.type ?? "—"}</span>,
      },
      {
        key: "line",
        label: "Line",
        align: "right",
        mono: true,
        sortValue: (e) => e.line,
        render: (e) => <span style={{ color: "var(--ms-text-3)" }}>L{e.line}</span>,
      },
    ],
    [],
  );

  const handleExportCsv = () => {
    if (!host.exportFile) return;
    const rows = [
      ["ID", "Name", "Documentation", "SatisfiedBy", "VerifiedBy", "Line"].join(","),
      ...scanned.requirements.map((r) =>
        [
          JSON.stringify(r.id),
          JSON.stringify(r.name),
          JSON.stringify(r.doc),
          JSON.stringify(r.satisfiedBy.join("; ")),
          JSON.stringify(r.verifiedBy.join("; ")),
          String(r.line),
        ].join(","),
      ),
    ];
    host.exportFile("sysml-requirements.csv", rows.join("\n"), "text/csv");
  };

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="SysML v2 MBSE Studio"
        badge={{ label: "SysML v2", tone: "info" }}
        actions={
          <>
            {activeTab === "diagram" && host.exportFile && diagramSvg && (
              <PanelButton onClick={() => host.exportFile?.("sysml2-architecture.svg", diagramSvg, "image/svg+xml")}>
                Export SVG
              </PanelButton>
            )}
            {host.exportFile && scanned.requirements.length > 0 && (
              <PanelButton onClick={handleExportCsv}>Export CSV</PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "sysml2", title)}
              >
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<SysmlTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "diagram", label: "Architecture Graph" },
          { id: "requirements", label: "Requirements Matrix", count: scanned.requirements.length },
          { id: "elements", label: "Element Table", count: scanned.elements.length },
          { id: "traceability", label: "Traceability" },
        ]}
      />

      {activeTab === "diagram" && (
        <PanelSvgStage
          svg={diagramSvg}
          canvasTheme={canvasTheme}
          onToggleCanvasTheme={() =>
            setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
          }
          onRevealLine={host.onRevealLine}
          emptyMessage="Add SysML v2 requirements, parts, or actions to visualize the Architecture & Traceability Graph."
        />
      )}

      {activeTab === "requirements" && (
        <PanelDataGrid
          rows={scanned.requirements}
          columns={reqColumns}
          rowKey={(r) => `${r.id}-${r.line}`}
          searchPlaceholder="Filter requirements by ID, name, or specification…"
          onRowClick={(r) => host.onRevealLine?.(r.line, r.name)}
          emptyMessage="No SysML v2 requirements declared in this model."
        />
      )}

      {activeTab === "elements" && (
        <PanelDataGrid
          rows={scanned.elements}
          columns={elementColumns}
          rowKey={(el, idx) => `${el.name}-${el.line}-${idx}`}
          searchPlaceholder="Filter SysML elements by name, kind, or type…"
          onRowClick={(el) => host.onRevealLine?.(el.line, el.name)}
          emptyMessage="No SysML v2 elements found."
        />
      )}

      {activeTab === "traceability" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {scanned.requirements.map((r) => {
            const covered = r.satisfiedBy.length > 0 && r.verifiedBy.length > 0;
            return (
              <div
                key={`tr-${r.id}-${r.line}`}
                onClick={() => host.onRevealLine?.(r.line, r.name)}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: `1px solid ${covered ? "var(--ms-status-pass-border)" : "var(--ms-border)"}`,
                  cursor: host.onRevealLine ? "pointer" : "default",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <strong>{r.id}</strong> — {r.name}
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: covered ? "var(--ms-success)" : "var(--ms-warning)",
                  }}
                >
                  {covered ? "COVERED" : "GAP"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </PanelShell>
  );
};

export default SysmlPanel;
