// SPDX-License-Identifier: AGPL-3.0-or-later

import { LockIcon, ShieldCheckIcon, XIcon } from "@primer/octicons-react";
import type React from "react";
import type { SpaceEcoProposalRecord } from "../../../api";
import Spinner from "../../../components/Spinner";
import { SIGNING_DECISION_OPTIONS, SIGNING_INTENT_OPTIONS } from "./badges";
import type { SigningDecision } from "./types";

export interface SignatureModalProps {
  eco: SpaceEcoProposalRecord;
  decision: SigningDecision;
  onDecisionChange: (decision: SigningDecision) => void;
  role: string;
  onRoleChange: (role: string) => void;
  intent: string;
  onIntentChange: (intent: string) => void;
  comment: string;
  onCommentChange: (comment: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  title?: string;
  roleOptions?: ReadonlyArray<string>;
  identificationNotice?: string;
}

const DEFAULT_ROLE_OPTIONS: ReadonlyArray<string> = [
  "Lead Systems Architect",
  "Functional Safety Officer (ISO 26262 ASIL-D)",
  "Verification & Validation Engineer",
  "Chief Engineer / Release Authority",
  "Quality Assurance Specialist (21 CFR Part 11)",
];

export const SignatureModal: React.FC<SignatureModalProps> = ({
  eco,
  decision,
  onDecisionChange,
  role,
  onRoleChange,
  intent,
  onIntentChange,
  comment,
  onCommentChange,
  password,
  onPasswordChange,
  submitting,
  onClose,
  onSubmit,
  title = "21 CFR Part 11 / ISO 26262 Electronic Signature",
  roleOptions = DEFAULT_ROLE_OPTIONS,
  identificationNotice = "Dual-component identification binds this cryptographic signature directly to your identity.",
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
        maxWidth: "580px",
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
          <ShieldCheckIcon size={18} fill="var(--color-success-fg, #1a7f37)" />
          <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "var(--color-fg-default)" }}>{title}</h4>
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
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "6px",
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border-default)",
            display: "flex",
            flexDirection: "column",
            gap: "3px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--ms-brand)",
              }}
            >
              #{eco.eco_number}
            </span>
            <span style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--color-fg-default)" }}>{eco.title}</span>
          </div>
          <span style={{ fontSize: "12px", color: "var(--color-fg-muted)", fontFamily: "var(--font-mono)" }}>
            {eco.source_branch} → {eco.target_branch}
          </span>
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
            Signing Decision
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            {SIGNING_DECISION_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => onDecisionChange(opt.id)}
                style={{
                  padding: "8px 6px",
                  borderRadius: "6px",
                  border: `1px solid ${decision === opt.id ? opt.color : "var(--color-border-default)"}`,
                  background: decision === opt.id ? "var(--color-canvas-subtle)" : "transparent",
                  color: decision === opt.id ? opt.color : "var(--color-fg-muted)",
                  fontSize: "12px",
                  fontWeight: decision === opt.id ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {opt.label}
              </button>
            ))}
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
            Authorized Signatory Role
          </label>
          <select
            value={role}
            onChange={(e) => onRoleChange(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "13px",
            }}
          >
            {roleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
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
            Standard Signing Intent & Attestation
          </label>
          <select
            value={intent}
            onChange={(e) => onIntentChange(e.target.value)}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 12px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              background: "var(--color-canvas-subtle)",
              color: "var(--color-fg-default)",
              fontSize: "13px",
            }}
          >
            {SIGNING_INTENT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
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
            Review Comments (Optional)
          </label>
          <textarea
            rows={2}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Add engineering notes or contingency remarks..."
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
            Password Confirmation (21 CFR Part 11 §11.200 Identification)
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--color-fg-muted)",
                display: "inline-flex",
                pointerEvents: "none",
              }}
            >
              <LockIcon size={14} />
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Confirm account password..."
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px 8px 34px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
                color: "var(--color-fg-default)",
                fontSize: "13px",
              }}
            />
          </div>
          <span
            style={{
              fontSize: "11.5px",
              color: "var(--color-fg-muted)",
              marginTop: "6px",
              display: "block",
            }}
          >
            {identificationNotice}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: "10px",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border-default)",
          }}
        >
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
            disabled={submitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 18px",
              borderRadius: "6px",
              border: "none",
              background:
                decision === "approved"
                  ? "#1f883d"
                  : decision === "rejected"
                    ? "var(--color-danger-fg, #cf222e)"
                    : "var(--color-attention-fg, #9a6700)",
              color: "#ffffff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? <Spinner size="small" /> : <span>✍️</span>}
            <span>Commit Cryptographic Sign-Off</span>
          </button>
        </div>
      </form>
    </div>
  </div>
);
