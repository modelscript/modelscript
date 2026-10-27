// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { EngineeringDataGrid, type DataGridColumn } from "./shared/index.js";

const vscode = (window as any).acquireVsCodeApi?.();

export interface TableColumnDef {
  id: string;
  title: string;
  editable?: boolean;
}

export interface TablePayload {
  metaclass: string;
  columns: TableColumnDef[];
  rows: Record<string, any>[];
}

const METACLASS_TABS = [
  { id: "part", label: "Parts" },
  { id: "action", label: "Actions" },
  { id: "port", label: "Ports" },
  { id: "state", label: "States" },
  { id: "attribute", label: "Attributes" },
];

export function ElementTableApp() {
  const [activeMetaclass, setActiveMetaclass] = useState<string>("part");
  const [table, setTable] = useState<TablePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      switch (msg.type) {
        case "setData":
          if (msg.table) {
            setTable(msg.table);
            if (msg.metaclass) {
              setActiveMetaclass(msg.metaclass);
            }
            setError(null);
          }
          break;

        case "setError":
          setError(msg.message || "An unknown error occurred");
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    vscode?.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleTabChange = (meta: string) => {
    setActiveMetaclass(meta);
    vscode?.postMessage({ type: "changeMetaclass", metaclass: meta });
  };

  const handleCellEdit = (item: Record<string, any>, key: string, newValue: string) => {
    vscode?.postMessage({
      type: "updateAttribute",
      qualifiedName: item.qualifiedName || item.name,
      attributeName: key,
      newValue,
    });
  };

  const handleGoToSource = (item: Record<string, any>) => {
    vscode?.postMessage({
      type: "goToSource",
      startOffset: item.startOffset ?? 0,
      endOffset: item.endOffset ?? item.startOffset ?? 0,
    });
  };

  const columns = useMemo<DataGridColumn<Record<string, any>>[]>(() => {
    if (!table?.columns) return [];

    return table.columns.map((c) => ({
      key: c.id,
      header: c.title,
      sortable: true,
      editable: c.editable !== false,
      render: (item: Record<string, any>) => {
        const val = item[c.id];
        if (c.id === "name" || c.id === "qualifiedName") {
          return (
            <span
              onClick={() => handleGoToSource(item)}
              style={{
                color: "var(--vscode-textLink-foreground, #3794ff)",
                cursor: "pointer",
                textDecoration: "underline",
                fontWeight: 600,
              }}
              title="Click to navigate to source in editor"
            >
              {String(val ?? "")}
            </span>
          );
        }
        return String(val ?? "");
      },
    }));
  }, [table]);

  const rows = useMemo(() => table?.rows ?? [], [table]);

  const exportCsv = () => {
    if (!table?.columns || !rows.length) return;
    const cols = table.columns;
    const lines = [cols.map((c) => `"${c.title}"`).join(",")];
    for (const r of rows) {
      lines.push(cols.map((c) => `"${r[c.id] ?? ""}"`).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeMetaclass}_elements.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "var(--vscode-editor-background, #1e1e1e)",
        color: "var(--vscode-editor-foreground, #d4d4d4)",
        fontFamily: "var(--vscode-font-family, sans-serif)",
        boxSizing: "border-box",
      }}
    >
      {/* Ribbon Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 16px",
          borderBottom: "1px solid var(--vscode-panel-border, #3c3c3c)",
          backgroundColor: "var(--vscode-editorGroupHeader-tabsBackground, #252526)",
        }}
      >
        <div style={{ display: "flex", gap: "6px" }}>
          {METACLASS_TABS.map((tab) => {
            const isActive = activeMetaclass === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "4px",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: isActive ? "var(--vscode-button-background, #0e639c)" : "rgba(255, 255, 255, 0.06)",
                  color: isActive ? "#ffffff" : "var(--vscode-editor-foreground, #ccc)",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => vscode?.postMessage({ type: "refresh" })}
            style={{
              padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              borderRadius: "4px",
              color: "var(--vscode-editor-foreground, #ccc)",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            🔄 Refresh
          </button>
          <button
            onClick={exportCsv}
            style={{
              padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--vscode-panel-border, #3c3c3c)",
              borderRadius: "4px",
              color: "var(--vscode-editor-foreground, #ccc)",
              cursor: "pointer",
              fontSize: "11px",
            }}
          >
            📊 Export CSV
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          style={{
            padding: "8px 16px",
            backgroundColor: "rgba(244, 67, 54, 0.15)",
            color: "#f48771",
            borderBottom: "1px solid #f44336",
            fontSize: "12px",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Grid Container */}
      <div style={{ flex: 1, padding: "12px 16px", overflow: "hidden" }}>
        {!table ? (
          <div style={{ padding: "32px", textAlign: "center", opacity: 0.7 }}>Loading {activeMetaclass} elements…</div>
        ) : (
          <EngineeringDataGrid
            columns={columns}
            data={rows}
            keyExtractor={(item, idx) => item.qualifiedName || item.name || idx}
            onCellEdit={handleCellEdit}
            searchPlaceholder={`Filter ${activeMetaclass} records…`}
            emptyMessage={`No ${activeMetaclass} elements found.`}
            pageSize={50}
          />
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<ElementTableApp />);
}
