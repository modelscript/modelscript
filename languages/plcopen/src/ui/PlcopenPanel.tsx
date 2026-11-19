// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parsePlcopen } from "../parser/index.js";

type PlcTab = "pous" | "tasks";

export const PlcopenPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<PlcTab>("pous");

  const { project, error } = useMemo(() => {
    try {
      return { project: parsePlcopen(code || ""), error: null as string | null };
    } catch (e) {
      return { project: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const pous = project?.pous ?? [];
  const tasks = useMemo(
    () => (project?.configurations ?? []).flatMap((c) => c.resources.flatMap((r) => r.tasks)),
    [project],
  );
  const totalVars = useMemo(() => pous.reduce((acc, p) => acc + p.variables.length, 0), [pous]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={project?.contentHeader?.name ? `PLCopen: ${project.contentHeader.name}` : "IEC 61131-3 PLCopen Studio"}
        subtitle={`${pous.length} POUs · ${totalVars} variables · ${tasks.length} tasks`}
      />
      {error && <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>Parse error: {error}</div>}
      <PanelKpiStrip
        items={[
          { label: "POUs", value: pous.length },
          { label: "Variables", value: totalVars },
          { label: "Data Types", value: project?.dataTypes.length ?? 0 },
          { label: "Tasks", value: tasks.length },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as PlcTab)}
        tabs={[
          { id: "pous", label: `POUs (${pous.length})` },
          { id: "tasks", label: `Tasks (${tasks.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "pous" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>POU</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Variables</th>
              </tr>
            </thead>
            <tbody>
              {pous.map((p) => (
                <tr key={p.name} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{p.name}</td>
                  <td style={{ padding: "5px 8px" }}>{p.pouType}</td>
                  <td style={{ padding: "5px 8px" }}>{p.variables.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "tasks" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Task</th>
                <th style={{ padding: "6px 8px" }}>Priority</th>
                <th style={{ padding: "6px 8px" }}>Interval</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.name} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{t.name}</td>
                  <td style={{ padding: "5px 8px" }}>{t.priority}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{t.interval ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
};

export default PlcopenPanel;
