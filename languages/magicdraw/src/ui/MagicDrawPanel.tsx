// SPDX-License-Identifier: AGPL-3.0-or-later

import { PanelButton, PanelShell, PanelToolbar, type LanguagePanelProps } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { renderMagicDrawDiagramSvg } from "../diagram.js";
import { parseMagicDraw } from "../parser/index.js";
import { extractMagicDrawTables } from "../tabular.js";
import type { MagicDrawDiagramKind, MagicDrawDocument } from "../types.js";

export interface MagicDrawPanelProps extends Partial<LanguagePanelProps> {
  /** Legacy/direct prop alias for `code` (also accepts binary `.mdzip` bytes). */
  source?: string | Uint8Array | undefined;
  fileName?: string | undefined;
  onExportSysml2?: (() => void) | undefined;
  onExportReqif?: (() => void) | undefined;
  onExportModelica?: (() => void) | undefined;
}

const DIAGRAM_KINDS: MagicDrawDiagramKind[] = ["BDD", "IBD", "REQ", "PAR", "STM", "ACT", "SEQ"];

function deriveFileName(fileName?: string, documentUri?: string): string | undefined {
  if (fileName) return fileName;
  if (!documentUri) return undefined;
  const clean = documentUri.split(/[?#]/)[0] ?? "";
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

/**
 * Multi-diagram browser, containment tree & stereotype/tag inspector for
 * MagicDraw / Cameo (.mdzip, .mdxml, .xmi) models.
 */
export function MagicDrawPanel({
  code,
  dialect,
  colorMode = "light",
  mode = "inspector",
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
  source,
  fileName,
  onExportSysml2,
  onExportReqif,
  onExportModelica,
}: MagicDrawPanelProps): React.ReactElement {
  const effectiveSource: string | Uint8Array = source ?? code ?? "";
  const isDark = colorMode === "dark";

  const parsed = useMemo<{ doc: MagicDrawDocument | null; error?: string }>(() => {
    const isEmpty =
      typeof effectiveSource === "string" ? effectiveSource.trim().length === 0 : effectiveSource.byteLength === 0;
    if (isEmpty) {
      return { doc: null };
    }
    try {
      return { doc: parseMagicDraw(effectiveSource) };
    } catch (err) {
      return {
        doc: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [effectiveSource]);

  const doc = parsed.doc;
  const tables = useMemo(() => {
    if (!doc) return { requirements: [] };
    try {
      return extractMagicDrawTables(doc);
    } catch {
      return { requirements: [] };
    }
  }, [doc]);

  const [selectedKind, setSelectedKind] = useState<MagicDrawDiagramKind>("BDD");
  const [selectedDiagramId, setSelectedDiagramId] = useState<string | undefined>(undefined);
  const [hasExplicitDiagramSelection, setHasExplicitDiagramSelection] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | undefined>(undefined);

  const activeDiagramId = useMemo(() => {
    if (!doc) return undefined;
    if (hasExplicitDiagramSelection) {
      if (!selectedDiagramId) return undefined;
      return doc.diagrams.some((d) => d.id === selectedDiagramId) ? selectedDiagramId : doc.diagrams[0]?.id;
    }
    return doc.diagrams[0]?.id;
  }, [doc, hasExplicitDiagramSelection, selectedDiagramId]);

  const svg = useMemo(() => {
    if (!doc) return "";
    try {
      return renderMagicDrawDiagramSvg(doc, {
        diagramId: activeDiagramId,
        diagramKind: activeDiagramId ? undefined : selectedKind,
      });
    } catch {
      return "";
    }
  }, [doc, activeDiagramId, selectedKind]);

  const selectedClassifier = doc && selectedElementId ? doc.classifiers.get(selectedElementId) : undefined;
  const resolvedName =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    doc?.metadata.projectName ||
    deriveFileName(fileName, documentUri) ||
    "MagicDraw Model";

  const borderColor = isDark ? "#334155" : "#cbd5e1";
  const mutedText = isDark ? "#94a3b8" : "#64748b";
  const subtleBg = isDark ? "#1e293b" : "#e2e8f0";
  const activeBg = isDark ? "#1d4ed8" : "#dbeafe";
  const rowBorder = isDark ? "#1e293b" : "#f1f5f9";
  const surfaceBg = isDark ? "#0f172a" : "#ffffff";
  const primaryText = isDark ? "#f8fafc" : "#0f172a";

  const toolbarActions = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {DIAGRAM_KINDS.map((k) => {
        const isActive = !activeDiagramId && selectedKind === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => {
              setHasExplicitDiagramSelection(true);
              setSelectedDiagramId(undefined);
              setSelectedKind(k);
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              border: `1px solid ${borderColor}`,
              background: isActive ? (isDark ? "#f8fafc" : "#0f172a") : surfaceBg,
              color: isActive ? (isDark ? "#0f172a" : "#ffffff") : primaryText,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {k}
          </button>
        );
      })}
      {onExportSysml2 && <PanelButton onClick={onExportSysml2}>Export SysML v2</PanelButton>}
      {onExportReqif && <PanelButton onClick={onExportReqif}>Export ReqIF</PanelButton>}
      {onExportModelica && <PanelButton onClick={onExportModelica}>Export Modelica</PanelButton>}
      {mode === "artifact" && host?.openInMorsel && typeof effectiveSource === "string" && effectiveSource && (
        <PanelButton
          variant="primary"
          onClick={() => host.openInMorsel?.(effectiveSource, dialect || "magicdraw", resolvedName)}
        >
          Open in Morsel
        </PanelButton>
      )}
    </div>
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={resolvedName}
        subtitle={
          doc ? `${doc.classifiers.size} elements, ${doc.diagrams.length} diagrams` : "MagicDraw / Cameo SysML 1.x"
        }
        badge={parsed.error ? { label: "Parse Error", tone: "danger" } : { label: "MagicDraw", tone: "info" }}
        actions={toolbarActions}
      />

      {parsed.error ? (
        <div style={{ padding: 16, color: isDark ? "#fca5a5" : "#b91c1c", fontSize: 13 }}>
          Failed to parse MagicDraw model: {parsed.error}
        </div>
      ) : !doc ? (
        <div style={{ padding: 16, color: mutedText, fontSize: 13 }}>
          No MagicDraw / Cameo model loaded. Open a <code>.mdzip</code>, <code>.mdxml</code>, or <code>.xmi</code> file
          to inspect its containment tree, diagrams, and requirements.
        </div>
      ) : (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <aside
            style={{
              width: 240,
              borderRight: `1px solid ${borderColor}`,
              overflowY: "auto",
              padding: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Containment Tree</div>
            {Array.from(doc.classifiers.values()).map((cls) => (
              <div
                key={cls.id}
                onClick={() => {
                  setSelectedElementId(cls.id);
                  if (cls.span?.startLine) {
                    host?.onRevealLine?.(cls.span.startLine, cls.name);
                  }
                }}
                style={{
                  padding: "4px 6px",
                  cursor: "pointer",
                  borderRadius: 4,
                  background: selectedElementId === cls.id ? subtleBg : "transparent",
                }}
              >
                <span style={{ color: mutedText, fontSize: 11, marginRight: 4 }}>«{cls.kind}»</span>
                {cls.name}
              </div>
            ))}
            {doc.diagrams.length > 0 && (
              <>
                <div style={{ fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Stored Diagrams</div>
                {doc.diagrams.map((d) => (
                  <div
                    key={d.id}
                    onClick={() => {
                      setHasExplicitDiagramSelection(true);
                      setSelectedDiagramId(d.id);
                    }}
                    style={{
                      padding: "4px 6px",
                      cursor: "pointer",
                      borderRadius: 4,
                      background: activeDiagramId === d.id ? activeBg : "transparent",
                    }}
                  >
                    [{d.kind}] {d.name}
                  </div>
                ))}
              </>
            )}
          </aside>

          <main style={{ flex: 1, overflow: "auto", padding: 12 }}>
            {svg ? (
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div style={{ color: mutedText, fontSize: 12 }}>No diagram elements to render for {selectedKind}.</div>
            )}
            {selectedClassifier && (
              <div style={{ marginTop: 12, padding: 10, border: `1px solid ${borderColor}`, borderRadius: 6 }}>
                <div style={{ fontWeight: 600 }}>
                  {selectedClassifier.name} ({selectedClassifier.qualifiedName})
                </div>
                <div style={{ fontSize: 12, color: mutedText, marginTop: 4 }}>
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
                    <tr style={{ textAlign: "left", borderBottom: `1px solid ${borderColor}` }}>
                      <th style={{ padding: 4 }}>ID</th>
                      <th style={{ padding: 4 }}>Name</th>
                      <th style={{ padding: 4 }}>Text</th>
                      <th style={{ padding: 4 }}>Satisfied By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tables.requirements.map((r) => (
                      <tr key={r.xmiId} style={{ borderBottom: `1px solid ${rowBorder}` }}>
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
                          border: `1px solid ${borderColor}`,
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
                          <div style={{ padding: "12px 0", textAlign: "center", color: mutedText, fontWeight: 600 }}>
                            {b.extension.toUpperCase()}
                          </div>
                        )}
                        <div
                          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={b.entryName}
                        >
                          {b.entryName}
                        </div>
                        <div style={{ color: mutedText }}>
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
      )}
    </PanelShell>
  );
}

export default MagicDrawPanel;
