// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";

type SysmlTabId = "requirements" | "elements" | "traceability";

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
  const [activeTab, setActiveTab] = useState<SysmlTabId>("requirements");
  const [filter, setFilter] = useState("");

  const scanned = useMemo(() => scanSysml2(code), [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "SysML v2 Requirements & Elements";

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

  const filteredElements = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scanned.elements.slice(0, 250);
    return scanned.elements
      .filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.kind.toLowerCase().includes(q) ||
          (e.type ?? "").toLowerCase().includes(q),
      )
      .slice(0, 250);
  }, [scanned.elements, filter]);

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
            {host.exportFile && scanned.requirements.length > 0 && (
              <PanelButton onClick={handleExportCsv}>Export CSV</PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "sysml2", title)}>
                Open in Morsel
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
          { id: "requirements", label: "Requirements Matrix", count: scanned.requirements.length },
          { id: "elements", label: "Element Table", count: scanned.elements.length },
          { id: "traceability", label: "Traceability" },
        ]}
      />

      {activeTab === "requirements" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {scanned.requirements.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No SysML v2 requirements declared in this model.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>ID</th>
                  <th style={{ padding: "5px 6px" }}>Name</th>
                  <th style={{ padding: "5px 6px" }}>Specification</th>
                  <th style={{ padding: "5px 6px" }}>Satisfied By</th>
                  <th style={{ padding: "5px 6px" }}>Verified By</th>
                </tr>
              </thead>
              <tbody>
                {scanned.requirements.map((r) => (
                  <tr
                    key={`${r.id}-${r.line}`}
                    onClick={() => host.onRevealLine?.(r.line, r.name)}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      cursor: host.onRevealLine ? "pointer" : "default",
                    }}
                  >
                    <td style={{ padding: "5px 6px", fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{r.id}</td>
                    <td style={{ padding: "5px 6px", fontWeight: 600 }}>{r.name}</td>
                    <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>{r.doc || "—"}</td>
                    <td style={{ padding: "5px 6px", fontFamily: "var(--ms-font-mono)" }}>
                      {r.satisfiedBy.length > 0 ? r.satisfiedBy.join(", ") : "—"}
                    </td>
                    <td style={{ padding: "5px 6px", fontFamily: "var(--ms-font-mono)" }}>
                      {r.verifiedBy.length > 0 ? r.verifiedBy.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "elements" && (
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
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter SysML elements by name, kind, or type..."
            style={{
              padding: "5px 8px",
              borderRadius: "5px",
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg-soft)",
              color: "var(--ms-text-1)",
              fontSize: "12px",
            }}
          />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Kind</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Line</th>
              </tr>
            </thead>
            <tbody>
              {filteredElements.map((el, idx) => (
                <tr
                  key={`${el.name}-${el.line}-${idx}`}
                  onClick={() => host.onRevealLine?.(el.line, el.name)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", color: "var(--ms-brand)" }}>{el.kind}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{el.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{el.type ?? "—"}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-3)" }}>L{el.line}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
