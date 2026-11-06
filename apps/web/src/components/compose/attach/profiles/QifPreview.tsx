// SPDX-License-Identifier: AGPL-3.0-or-later

import { reconcileStepWithQif } from "@modelscript/qif/step-bridge";
import React, { Component, lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import type { QifViewerProps } from "../../../artifacts/QifViewer";
import { PillToggleGroup } from "../Primitives";
import type { QifAttachDraft } from "./QifProfile";

const LazyQifViewer = lazy(() => import("../../../artifacts/QifViewer"));

export const qifPreviewRenderer: {
  Viewer: React.ComponentType<QifViewerProps>;
} = {
  Viewer: LazyQifViewer as unknown as React.ComponentType<QifViewerProps>,
};

class PreviewErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export const QifPreview: React.FC<{ draft: QifAttachDraft }> = ({ draft }) => {
  const [tab, setTab] = useState<"3d" | "boc" | "entities">("3d");

  const reconciliation = useMemo(() => {
    if (!draft.stepText) return null;
    try {
      return reconcileStepWithQif(draft.stepText, draft.doc);
    } catch {
      return null;
    }
  }, [draft.stepText, draft.doc]);

  const viewConfig = useMemo(
    () => ({
      code: draft.text,
      stepCode: draft.stepText,
      companions: draft.linked
        ? { geometry: { artifactId: draft.linked.id, title: draft.linked.title, scaleFactor: draft.scaleFactor } }
        : draft.stepFile
          ? { geometry: { title: draft.stepFile.name, scaleFactor: draft.scaleFactor } }
          : undefined,
      geometryScale: draft.scaleFactor,
    }),
    [draft.text, draft.stepText, draft.linked, draft.stepFile, draft.scaleFactor],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
      <PillToggleGroup
        label="Inspection Preview"
        value={tab}
        onChange={setTab}
        options={[
          { value: "3d", label: "3D Alignment" },
          { value: "boc", label: `Characteristics (${draft.doc.characteristics.length})` },
          { value: "entities", label: `Matched Entities (${draft.doc.features.length})` },
        ]}
      />

      <div
        data-testid="qif-attach-preview-container"
        style={{
          minHeight: 260,
          maxHeight: 380,
          overflow: "auto",
          borderRadius: 10,
          border: "1px solid var(--ms-border)",
          background: "var(--color-canvas-default, #0d1117)",
          position: "relative",
        }}
      >
        {tab === "3d" && (
          <div style={{ width: "100%", height: "280px", position: "relative" }}>
            <PreviewErrorBoundary
              fallback={
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    gap: 6,
                    color: "var(--ms-text-3)",
                    fontSize: 13,
                    padding: 16,
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--ms-text-1)" }}>
                    3D Model Preview ({draft.doc.features.length} Features)
                  </span>
                  <span>{draft.stepFile?.name ?? draft.linked?.title ?? "No STEP geometry attached"}</span>
                </div>
              }
            >
              <Suspense
                fallback={
                  <div
                    role="status"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      fontSize: 13,
                      color: "var(--ms-text-3)",
                    }}
                  >
                    Loading 3D preview…
                  </div>
                }
              >
                <qifPreviewRenderer.Viewer viewConfig={viewConfig} />
              </Suspense>
            </PreviewErrorBoundary>
          </div>
        )}

        {tab === "boc" && (
          <div style={{ padding: 12 }}>
            {draft.doc.characteristics.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--ms-text-3)", fontSize: 13 }}>
                No characteristics defined in this QIF document.
              </div>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 11.5,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-fg-default, #e6edf3)",
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--ms-border)",
                      textAlign: "left",
                      color: "var(--ms-text-3)",
                    }}
                  >
                    <th style={{ padding: "6px 8px" }}>#</th>
                    <th style={{ padding: "6px 8px" }}>Characteristic</th>
                    <th style={{ padding: "6px 8px" }}>GD&amp;T Type</th>
                    <th style={{ padding: "6px 8px" }}>Nominal / Zone</th>
                    <th style={{ padding: "6px 8px" }}>Material Cond.</th>
                    <th style={{ padding: "6px 8px" }}>Feature</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.doc.characteristics.map((c, i) => (
                    <tr
                      key={c.id}
                      style={{
                        borderBottom: "1px solid var(--ms-border-soft, rgba(255, 255, 255, 0.05))",
                      }}
                    >
                      <td style={{ padding: "6px 8px", fontWeight: 700 }}>{c.balloonNumber ?? i + 1}</td>
                      <td style={{ padding: "6px 8px" }}>{c.name}</td>
                      <td style={{ padding: "6px 8px", color: "var(--ms-brand, #38bdf8)" }}>{c.gdtType}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {c.toleranceZone !== undefined
                          ? `${c.isDiametrical ? "⌀" : ""}${c.toleranceZone}`
                          : c.nominalValue !== undefined
                            ? `${c.nominalValue} mm`
                            : "—"}
                      </td>
                      <td style={{ padding: "6px 8px" }}>{c.materialCondition ?? "RFS"}</td>
                      <td style={{ padding: "6px 8px", color: "var(--ms-text-2)" }}>
                        {c.featureIds.join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === "entities" && (
          <div style={{ padding: 12 }}>
            {!draft.stepText ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--ms-text-3)", fontSize: 13 }}>
                Attach or link a STEP CAD model in the step above to reconcile QIF features with 3D B-Rep entities.
              </div>
            ) : !reconciliation ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--ms-text-3)", fontSize: 13 }}>
                Could not read STEP model to reconcile features.
              </div>
            ) : (
              <div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 10,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--ms-border)",
                    fontSize: 12,
                    color: "var(--ms-text-2)",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--ms-text-1)" }}>
                    {reconciliation.matchedFeatures.length} of {draft.doc.features.length} Matched
                  </span>
                  <span>
                    Direct:{" "}
                    <strong style={{ color: "#38bdf8" }}>
                      {reconciliation.matchedFeatures.filter((m) => m.matchType === "entityId").length}
                    </strong>
                  </span>
                  <span>
                    By Name:{" "}
                    <strong style={{ color: "#a855f7" }}>
                      {reconciliation.matchedFeatures.filter((m) => m.matchType === "semanticName").length}
                    </strong>
                  </span>
                  <span>
                    By Proximity:{" "}
                    <strong style={{ color: "#f59e0b" }}>
                      {reconciliation.matchedFeatures.filter((m) => m.matchType === "spatialProximity").length}
                    </strong>
                  </span>
                  {reconciliation.unresolvedFeatures.length > 0 && (
                    <span>
                      Unresolved:{" "}
                      <strong style={{ color: "#ef4444" }}>{reconciliation.unresolvedFeatures.length}</strong>
                    </span>
                  )}
                </div>

                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 11.5,
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--color-fg-default, #e6edf3)",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--ms-border)",
                        textAlign: "left",
                        color: "var(--ms-text-3)",
                      }}
                    >
                      <th style={{ padding: "6px 8px" }}>Feature</th>
                      <th style={{ padding: "6px 8px" }}>Type</th>
                      <th style={{ padding: "6px 8px" }}>STEP Entity</th>
                      <th style={{ padding: "6px 8px" }}>Match Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.doc.features.map((f) => {
                      const match = reconciliation.matchedFeatures.find((m) => m.featureId === f.id);
                      return (
                        <tr
                          key={f.id}
                          style={{
                            borderBottom: "1px solid var(--ms-border-soft, rgba(255, 255, 255, 0.05))",
                          }}
                        >
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>{f.name}</td>
                          <td style={{ padding: "6px 8px", color: "var(--ms-text-2)" }}>{f.featureType}</td>
                          <td style={{ padding: "6px 8px" }}>
                            {match ? (
                              <span>
                                <strong style={{ color: "#38bdf8" }}>{match.stepEntityId}</strong>{" "}
                                <span style={{ color: "var(--ms-text-3)", fontSize: 10 }}>
                                  ({match.stepEntityType})
                                </span>
                              </span>
                            ) : f.stepEntityId ? (
                              <span style={{ color: "#ef4444" }}>{f.stepEntityId} (Missing)</span>
                            ) : (
                              <span style={{ color: "var(--ms-text-3)" }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            {match?.matchType === "entityId" && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "rgba(56, 189, 248, 0.15)",
                                  color: "#38bdf8",
                                  border: "1px solid rgba(56, 189, 248, 0.35)",
                                }}
                              >
                                Direct #ID
                              </span>
                            )}
                            {match?.matchType === "semanticName" && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "rgba(168, 85, 247, 0.15)",
                                  color: "#a855f7",
                                  border: "1px solid rgba(168, 85, 247, 0.35)",
                                }}
                              >
                                Semantic Name
                              </span>
                            )}
                            {match?.matchType === "spatialProximity" && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "rgba(245, 158, 11, 0.15)",
                                  color: "#f59e0b",
                                  border: "1px solid rgba(245, 158, 11, 0.35)",
                                }}
                              >
                                Spatial Proximity
                              </span>
                            )}
                            {!match && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: "rgba(239, 68, 68, 0.15)",
                                  color: "#ef4444",
                                  border: "1px solid rgba(239, 68, 68, 0.35)",
                                }}
                              >
                                Unresolved
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default QifPreview;
