// SPDX-License-Identifier: AGPL-3.0-or-later

import { CodeIcon, LinkIcon, SlidersIcon, XIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import type { CadComponent } from "./CadViewer";
import { formatCadPartDisplayName } from "./scad-feature-tree";

export interface DimensionFieldSpec {
  index: number;
  label: string;
  value: number;
  primitiveType: "box" | "cube" | "cylinder" | "sphere";
}

export interface CadSelectionRibbonProps {
  component: CadComponent;
  assetLabel: string;
  dark: boolean;
  compact: boolean;
  dimensionFields: DimensionFieldSpec[];
  dimDrafts: Record<number, string>;
  onChangeDimDraft: (index: number, value: string) => void;
  onCommitDim: (
    index: number,
    raw: string,
    fallback: number,
    primitiveType: "box" | "cube" | "cylinder" | "sphere",
  ) => void;
  onClearDimDraft: (index: number) => void;
  onGoToSource?: (() => void) | undefined;
  onOpenBindings: () => void;
  onDeselect: () => void;
}

/**
 * Calm, compact 3D selection ribbon stacked directly above `CadCommandIsland`
 * inside the safe-zone bottom flex column (mirroring 2D Diagram's `AnsatzSelectionRibbon`).
 */
export const CadSelectionRibbon: React.FC<CadSelectionRibbonProps> = ({
  component,
  assetLabel,
  dark,
  compact,
  dimensionFields,
  dimDrafts,
  onChangeDimDraft,
  onCommitDim,
  onClearDimDraft,
  onGoToSource,
  onOpenBindings,
  onDeselect,
}) => {
  const [dimsExpanded, setDimsExpanded] = useState(false);
  const bindingCount = component.dynamicBindings?.length ?? 0;
  const hasDims = dimensionFields.length > 0;
  const showInlineDims = hasDims && (!compact || dimsExpanded);

  const surfaceBg = dark ? "rgba(15, 23, 42, 0.88)" : "rgba(255, 255, 255, 0.94)";
  const borderCol = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(15, 23, 42, 0.12)";
  const mutedFg = dark ? "#94a3b8" : "#64748b";
  const textFg = dark ? "#f1f5f9" : "#0f172a";
  const dividerCol = dark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.1)";

  return (
    <div
      data-testid="cad-selection-ribbon"
      role="region"
      aria-label={`Selected 3D part: ${component.name}`}
      style={{
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        maxWidth: "100%",
        padding: "5px 8px",
        borderRadius: "var(--ms-radius-lg, 12px)",
        background: surfaceBg,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: `1px solid ${borderCol}`,
        boxShadow: dark ? "0 8px 24px -4px rgba(0, 0, 0, 0.45)" : "0 8px 24px -4px rgba(15, 23, 42, 0.14)",
        color: textFg,
        fontSize: 12,
        userSelect: "none",
      }}
    >
      {/* Primary compact row */}
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 4 : 6, flexWrap: "nowrap", minWidth: 0 }}>
        {/* Part identity */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            minWidth: 0,
            maxWidth: compact ? 115 : 190,
          }}
          title={`${component.name} — ${assetLabel}`}
        >
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "var(--ms-brand, #0891b2)",
              boxShadow: "0 0 6px rgba(8, 145, 178, 0.55)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: 600,
              fontFamily: "var(--ms-font-mono, monospace)",
              fontSize: 11.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {formatCadPartDisplayName(component.name)}
          </span>
        </div>

        {/* Parameter badge */}
        {component.sourceMetadata?.parameterName && (
          <span
            title="Parametric source identifier"
            style={{
              fontSize: 10,
              fontFamily: "var(--ms-font-mono, monospace)",
              padding: "1px 6px",
              borderRadius: 999,
              background: "rgba(6, 182, 212, 0.14)",
              color: dark ? "#22d3ee" : "#0e7490",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            {component.sourceMetadata.parameterName}
          </span>
        )}

        {/* Binding state pill */}
        <span
          style={{
            fontSize: 10,
            padding: "1px 6px",
            borderRadius: 999,
            background: bindingCount > 0 ? "rgba(34, 197, 94, 0.16)" : "rgba(148, 163, 184, 0.16)",
            color: bindingCount > 0 ? (dark ? "#4ade80" : "#15803d") : mutedFg,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {bindingCount > 0 ? `${bindingCount} bound` : "unbound"}
        </span>

        {/* Inline dimensions when space allows */}
        {!compact && hasDims && (
          <>
            <span style={{ width: 1, height: 14, background: dividerCol, flexShrink: 0 }} />
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--ms-font-mono, monospace)",
                fontSize: 10.5,
              }}
            >
              {dimensionFields.map((field) => {
                const draftVal = dimDrafts[field.index] ?? String(Number(field.value.toFixed(4)));
                const paramHint = component.sourceMetadata?.dimensionParams?.[field.index];
                return (
                  <label
                    key={field.index}
                    style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                    title={paramHint ? `${field.label} (${paramHint})` : `${field.label} dimension`}
                  >
                    <span style={{ color: mutedFg, fontWeight: 700 }}>{field.label}</span>
                    <input
                      type="number"
                      step="any"
                      value={draftVal}
                      onChange={(e) => onChangeDimDraft(field.index, e.target.value)}
                      onBlur={(e) => onCommitDim(field.index, e.target.value, field.value, field.primitiveType)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                        } else if (e.key === "Escape") {
                          onClearDimDraft(field.index);
                          e.currentTarget.blur();
                        }
                      }}
                      aria-label={`${field.label} dimension for ${component.name}`}
                      style={{
                        width: 48,
                        height: 22,
                        padding: "0 4px",
                        borderRadius: 5,
                        border: `1px solid ${borderCol}`,
                        background: dark ? "rgba(15, 23, 42, 0.75)" : "#ffffff",
                        color: textFg,
                        fontFamily: "inherit",
                        fontSize: 10.5,
                      }}
                    />
                  </label>
                );
              })}
            </div>
          </>
        )}

        <span style={{ width: 1, height: 14, background: dividerCol, flexShrink: 0 }} />

        {/* Compact dimensions toggle when narrow */}
        {compact && hasDims && (
          <button
            type="button"
            onClick={() => setDimsExpanded((v) => !v)}
            aria-expanded={dimsExpanded}
            title="Edit part dimensions"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 24,
              padding: "0 7px",
              borderRadius: 6,
              border: `1px solid ${dimsExpanded ? "rgba(6, 182, 212, 0.5)" : "transparent"}`,
              background: dimsExpanded ? "rgba(6, 182, 212, 0.16)" : "transparent",
              color: dimsExpanded ? "var(--ms-brand, #0891b2)" : textFg,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <SlidersIcon size={12} />
            <span>Dims</span>
          </button>
        )}

        {onGoToSource && (
          <button
            type="button"
            onClick={onGoToSource}
            title="Jump to component definition in source code"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 24,
              padding: "0 7px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              background: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.04)",
              color: textFg,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <CodeIcon size={12} />
            <span>{compact ? "Source" : "Go to Source"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenBindings}
          title="Link 3D geometry to simulation states"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            height: 24,
            padding: "0 8px",
            borderRadius: 6,
            border: "none",
            background: "var(--ms-brand, #0891b2)",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <LinkIcon size={12} />
          <span>{compact ? "Link" : "Link Variables"}</span>
        </button>

        <button
          type="button"
          onClick={onDeselect}
          aria-label="Deselect part"
          title="Deselect (Esc)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "none",
            background: "transparent",
            color: mutedFg,
            cursor: "pointer",
            padding: 0,
            flexShrink: 0,
          }}
        >
          <XIcon size={13} />
        </button>
      </div>

      {/* Expandable dimensions row when compact */}
      {compact && showInlineDims && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 5,
            borderTop: `1px solid ${dividerCol}`,
            fontFamily: "var(--ms-font-mono, monospace)",
            fontSize: 11,
            flexWrap: "wrap",
          }}
        >
          {dimensionFields.map((field) => {
            const draftVal = dimDrafts[field.index] ?? String(Number(field.value.toFixed(4)));
            const paramHint = component.sourceMetadata?.dimensionParams?.[field.index];
            return (
              <label
                key={field.index}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                title={paramHint ? `${field.label} (${paramHint})` : `${field.label} dimension`}
              >
                <span style={{ color: mutedFg, fontWeight: 700 }}>{field.label}</span>
                <input
                  type="number"
                  step="any"
                  value={draftVal}
                  onChange={(e) => onChangeDimDraft(field.index, e.target.value)}
                  onBlur={(e) => onCommitDim(field.index, e.target.value, field.value, field.primitiveType)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      onClearDimDraft(field.index);
                      e.currentTarget.blur();
                    }
                  }}
                  aria-label={`${field.label} dimension for ${component.name}`}
                  style={{
                    width: 54,
                    height: 22,
                    padding: "0 5px",
                    borderRadius: 5,
                    border: `1px solid ${borderCol}`,
                    background: dark ? "rgba(15, 23, 42, 0.75)" : "#ffffff",
                    color: textFg,
                    fontFamily: "inherit",
                    fontSize: 11,
                  }}
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};
