// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import { renderMagicDrawDiagramSvg } from "../diagram.js";
import { parseMagicDraw } from "../parser/index.js";
import { extractMagicDrawTables } from "../tabular.js";
import type { MagicDrawDiagramKind } from "../types.js";

export interface MagicDrawPanelProps {
  source: string | Uint8Array;
  fileName?: string | undefined;
  onExportSysml2?: (() => void) | undefined;
  onExportReqif?: (() => void) | undefined;
  onExportModelica?: (() => void) | undefined;
}

/**
 * Multi-diagram browser, containment tree & stereotype/tag inspector for
 * MagicDraw / Cameo (.mdzip, .mdxml, .xmi) models.
 */
export function MagicDrawPanel({
  source,
  fileName,
  onExportSysml2,
  onExportReqif,
  onExportModelica,
}: MagicDrawPanelProps): React.ReactElement {
  const doc = useMemo(() => parseMagicDraw(source), [source]);
  const tables = useMemo(() => extractMagicDrawTables(doc), [doc]);

  const [selectedKind, setSelectedKind] = useState<MagicDrawDiagramKind>("BDD");
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | undefined>(doc.diagrams[0]?.id);
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>(undefined);

  const svg = useMemo(
    () =>
      renderMagicDrawDiagramSvg(doc, {
        diagramId: selectedDiagramId,
        diagramKind: selectedDiagramId ? undefined : selectedKind,
      }),
    [doc, selectedDiagramId, selectedKind],
  );

  const selectedClassifier = selectedElementId ? doc.classifiers.get(selectedElementId) : undefined;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid #cbd5e1",
        }}
      >
        <strong>{doc.metadata.projectName ?? fileName ?? "MagicDraw Model"}</strong>
        <span style={{ color: "#64748b", fontSize: 11 }}>
          ({doc.classifiers.size} elements, {doc.diagrams.length} diagrams)
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {(["BDD", "IBD", "REQ", "PAR", "STM", "ACT", "SEQ"] as MagicDrawDiagramKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setSelectedDiagramId(undefined);
                setSelectedKind(k);
              }}
              style={{
                padding: "3px 8px",
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                background: !selectedDiagramId && selectedKind === k ? "#0f172a" : "#ffffff",
                color: !selectedDiagramId && selectedKind === k ? "#ffffff" : "#0f172a",
                cursor: "pointer",
              }}
            >
              {k}
            </button>
          ))}
          {onExportSysml2 && (
            <button type="button" onClick={onExportSysml2} style={{ padding: "3px 8px" }}>
              Export SysML v2
            </button>
          )}
          {onExportReqif && (
            <button type="button" onClick={onExportReqif} style={{ padding: "3px 8px" }}>
              Export ReqIF
            </button>
          )}
          {onExportModelica && (
            <button type="button" onClick={onExportModelica} style={{ padding: "3px 8px" }}>
              Export Modelica
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside style={{ width: 240, borderRight: "1px solid #cbd5e1", overflowY: "auto", padding: 8 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Containment Tree</div>
          {Array.from(doc.classifiers.values()).map((cls) => (
            <div
              key={cls.id}
              onClick={() => setSelectedElementId(cls.id)}
              style={{
                padding: "4px 6px",
                cursor: "pointer",
                borderRadius: 4,
                background: selectedElementId === cls.id ? "#e2e8f0" : "transparent",
              }}
            >
              <span style={{ color: "#64748b", fontSize: 11, marginRight: 4 }}>«{cls.kind}»</span>
              {cls.name}
            </div>
          ))}
          {doc.diagrams.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Stored Diagrams</div>
              {doc.diagrams.map((d) => (
                <div
                  key={d.id}
                  onClick={() => setSelectedDiagramId(d.id)}
                  style={{
                    padding: "4px 6px",
                    cursor: "pointer",
                    borderRadius: 4,
                    background: selectedDiagramId === d.id ? "#dbeafe" : "transparent",
                  }}
                >
                  [{d.kind}] {d.name}
                </div>
              ))}
            </>
          )}
        </aside>

        <main style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <div dangerouslySetInnerHTML={{ __html: svg }} />
          {selectedClassifier && (
            <div style={{ marginTop: 12, padding: 10, border: "1px solid #cbd5e1", borderRadius: 6 }}>
              <div style={{ fontWeight: 600 }}>
                {selectedClassifier.name} ({selectedClassifier.qualifiedName})
              </div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>
                XMI ID: <code>{selectedClassifier.id}</code> | Stereotypes:{" "}
                {selectedClassifier.stereotypes.map((s) => `«${s.name}»`).join(", ") || "none"}
              </div>
              {selectedClassifier.requirementText && (
                <p style={{ marginTop: 6 }}>{selectedClassifier.requirementText}</p>
              )}
            </div>
          )}
          {tables.requirements.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Requirements ({tables.requirements.length})</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>
                    <th style={{ padding: 4 }}>ID</th>
                    <th style={{ padding: 4 }}>Name</th>
                    <th style={{ padding: 4 }}>Text</th>
                    <th style={{ padding: 4 }}>Satisfied By</th>
                  </tr>
                </thead>
                <tbody>
                  {tables.requirements.map((r) => (
                    <tr key={r.xmiId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: 4 }}>{r.id}</td>
                      <td style={{ padding: 4 }}>{r.name}</td>
                      <td style={{ padding: 4 }}>{r.text}</td>
                      <td style={{ padding: 4 }}>{r.satisfiedBy.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {doc.binaries && doc.binaries.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                Embedded Binary Attachments ({doc.binaries.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {doc.binaries.slice(0, 24).map((b) => {
                  const dataUri = b.kind === "image" || b.kind === "svg" ? b.toDataUri() : null;
                  return (
                    <div
                      key={b.entryName}
                      style={{
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: 8,
                        width: 140,
                        fontSize: 11,
                      }}
                    >
                      {dataUri ? (
                        <img
                          src={dataUri}
                          alt={b.entryName}
                          style={{
                            maxWidth: "100%",
                            maxHeight: 72,
                            objectFit: "contain",
                            display: "block",
                            marginBottom: 4,
                          }}
                        />
                      ) : (
                        <div style={{ padding: "12px 0", textAlign: "center", color: "#64748b", fontWeight: 600 }}>
                          {b.extension.toUpperCase()}
                        </div>
                      )}
                      <div
                        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={b.entryName}
                      >
                        {b.entryName}
                      </div>
                      <div style={{ color: "#64748b" }}>
                        {b.mimeType} ({Math.max(1, Math.round(b.sizeBytes / 1024))} KB)
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default MagicDrawPanel;
