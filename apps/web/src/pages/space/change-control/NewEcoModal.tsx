// SPDX-License-Identifier: AGPL-3.0-or-later

import { GitPullRequestIcon, XIcon } from "@primer/octicons-react";
import type React from "react";
import type { EcoSeverity } from "./types";

export interface NewEcoModalProps {
  title: string;
  onTitleChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  severity: EcoSeverity;
  onSeverityChange: (value: EcoSeverity) => void;
  sourceBranch: string;
  onSourceBranchChange: (value: string) => void;
  targetBranch: string;
  onTargetBranchChange: (value: string) => void;
  models: string;
  onModelsChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const NewEcoModal: React.FC<NewEcoModalProps> = ({
  title,
  onTitleChange,
  description,
  onDescriptionChange,
  severity,
  onSeverityChange,
  sourceBranch,
  onSourceBranchChange,
  targetBranch,
  onTargetBranchChange,
  models,
  onModelsChange,
  onClose,
  onSubmit,
}) => (
  <div
    style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.65)",
      backdropFilter: "blur(2px)",
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
    }}
  >
    <div
      style={{
        width: "100%",
        maxWidth: "600px",
        background: "var(--color-canvas-default)",
        borderRadius: "6px",
        border: "1px solid var(--color-border-default)",
        boxShadow: "0 16px 36px rgba(0, 0, 0, 0.35)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--color-border-default)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--color-canvas-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <GitPullRequestIcon size={18} fill="var(--ms-brand)" />
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--color-fg-default)" }}>
            + New Change Request (ECO Proposal)
          </h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--color-fg-muted)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
          }}
        >
          <XIcon size={16} />
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <label
            style={{
              display: "block",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "var(--color-fg-default)",
              marginBottom: "6px",
            }}
          >
            Change Request Title *
          </label>
          <input
            type="text"
            placeholder="e.g. Dual-Redundant CAN-FD Gateway Architecture"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            required
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>

        <div>
          <label
            style={{
              display: "block",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "var(--color-fg-default)",
              marginBottom: "6px",
            }}
          >
            Engineering Rationale & Justification
          </label>
          <textarea
            rows={4}
            placeholder="Describe failure modes, verification margins, and safety impact..."
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "13px",
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "12.5px",
                fontWeight: 600,
                color: "var(--color-fg-default)",
                marginBottom: "6px",
              }}
            >
              Severity Classification
            </label>
            <select
              value={severity}
              onChange={(e) => onSeverityChange(e.target.value as EcoSeverity)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-fg-default)",
                fontSize: "12.5px",
              }}
            >
              <option value="safety_critical">🛡️ Safety-Critical (ISO 26262 ASIL-D)</option>
              <option value="major">⚡ Major Architecture</option>
              <option value="standard">Standard Change</option>
              <option value="minor">Minor Fix / Documentation</option>
            </select>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "12.5px",
                fontWeight: 600,
                color: "var(--color-fg-default)",
                marginBottom: "6px",
              }}
            >
              Source Branch → Target Branch
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="text"
                placeholder="e.g. eco/can-fd-gateway"
                value={sourceBranch}
                onChange={(e) => onSourceBranchChange(e.target.value)}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-subtle)",
                  color: "var(--color-fg-default)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
              <span style={{ color: "var(--color-fg-muted)" }}>→</span>
              <input
                type="text"
                value={targetBranch}
                onChange={(e) => onTargetBranchChange(e.target.value)}
                style={{
                  width: "70px",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-subtle)",
                  color: "var(--color-fg-default)",
                  fontSize: "12px",
                  fontFamily: "var(--font-mono, monospace)",
                }}
              />
            </div>
          </div>
        </div>

        <div>
          <label
            style={{
              display: "block",
              fontSize: "12.5px",
              fontWeight: 600,
              color: "var(--color-fg-default)",
              marginBottom: "6px",
            }}
          >
            Impacted Domain Models (Comma-separated)
          </label>
          <input
            type="text"
            placeholder="e.g. AetherDynamics.Avionics.BmsBusGateway, docs/overview.md"
            value={models}
            onChange={(e) => onModelsChange(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "12.5px",
              fontFamily: "var(--font-mono, monospace)",
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "7px 16px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "transparent",
              color: "var(--color-fg-default)",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            style={{
              padding: "7px 18px",
              borderRadius: "6px",
              border: "none",
              background: "#1f883d",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Submit Change Request
          </button>
        </div>
      </form>
    </div>
  </div>
);
