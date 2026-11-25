// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ClockIcon,
  GitMergeIcon,
  PackageIcon,
  RocketIcon,
  XIcon,
} from "@primer/octicons-react";
import type React from "react";
import Spinner from "../../../components/Spinner";
import { MergeBox } from "./styles";
import type { SigningDecision } from "./types";

export interface EcoMergeBoxProps {
  isMerged: boolean;
  canMerge: boolean;
  gatePassed: boolean;
  hasApprovedSig: boolean;
  hasBlockingSig: boolean;
  canWrite: boolean;
  mergingEco: boolean;
  onOpenSignatureModal: (decision: SigningDecision) => void;
  onMergeEco: () => void;
  mergeButtonLabel?: string;
  mergedBadgeLabel?: string;
  releaseBundles?: ReadonlyArray<string>;
}

export const EcoMergeBox: React.FC<EcoMergeBoxProps> = ({
  isMerged,
  canMerge,
  gatePassed,
  hasApprovedSig,
  hasBlockingSig,
  canWrite,
  mergingEco,
  onOpenSignatureModal,
  onMergeEco,
  mergeButtonLabel = "🚀 Merge ECO & Tag Release",
  mergedBadgeLabel = "Merged & Released",
  releaseBundles = ["AASX (IDTA v3.0)", "ISO 10303-242 DDP"],
}) => (
  <MergeBox id="section-merge" $state={isMerged ? "merged" : canMerge ? "can_merge" : "blocked"}>
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        <div style={{ marginTop: "2px" }}>
          {isMerged ? (
            <GitMergeIcon size={24} fill="#8250df" />
          ) : canMerge ? (
            <CheckCircleFillIcon size={24} fill="var(--color-success-fg, #1a7f37)" />
          ) : (
            <AlertIcon size={24} fill="var(--color-attention-fg, #9a6700)" />
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <strong style={{ fontSize: "15px", color: "var(--color-fg-default)" }}>
            {isMerged
              ? "Change Request successfully merged and released"
              : canMerge
                ? "All continuous checks have passed"
                : "Merge Gated by Simulation Checks & Signatures"}
          </strong>

          <div
            style={{
              fontSize: "13px",
              color: "var(--color-fg-muted)",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {gatePassed ? (
                <CheckIcon size={14} fill="var(--color-success-fg, #1a7f37)" />
              ) : (
                <XIcon size={14} fill="var(--color-danger-fg, #cf222e)" />
              )}
              <span>
                <strong>Simulation Checks:</strong>{" "}
                {gatePassed ? "Passed (within ±5% tolerance band, SUNDIALS CVODE)" : "Pending/Failed DAE integration"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              {hasApprovedSig ? (
                <CheckIcon size={14} fill="var(--color-success-fg, #1a7f37)" />
              ) : (
                <ClockIcon size={14} />
              )}
              <span>
                <strong>Review Sign-Off Quorum:</strong>{" "}
                {hasApprovedSig
                  ? "Approved with valid Ed25519 & 21 CFR Part 11 signatures"
                  : "Awaiting authorized signatory"}
                {hasBlockingSig && " (Changes requested)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Release Tags / Badges if Merged */}
      {isMerged && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {releaseBundles.map((bundle, idx) => (
            <span
              key={bundle}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "5px 10px",
                borderRadius: "6px",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "12px",
                border: "1px solid var(--color-border-default)",
              }}
            >
              {idx === 0 && <PackageIcon size={13} />}
              {bundle}
            </span>
          ))}
        </div>
      )}
    </div>

    {/* Action Buttons Row */}
    {canWrite && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "12px",
          paddingTop: "14px",
          borderTop: "1px solid var(--color-border-default)",
        }}
      >
        {!isMerged && (
          <>
            <button
              type="button"
              onClick={() => onOpenSignatureModal("changes_requested")}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Request Changes
            </button>

            <button
              type="button"
              onClick={() => onOpenSignatureModal("approved")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <span>✍️</span>
              <span>Review & Sign-Off (21 CFR Part 11)</span>
            </button>
          </>
        )}

        {isMerged ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 18px",
              borderRadius: "6px",
              background: "color-mix(in srgb, #8250df 15%, transparent)",
              color: "#8250df",
              border: "1px solid color-mix(in srgb, #8250df 35%, transparent)",
              fontSize: "13px",
              fontWeight: 700,
            }}
          >
            <GitMergeIcon size={14} />
            <span>{mergedBadgeLabel}</span>
          </span>
        ) : (
          <button
            type="button"
            onClick={onMergeEco}
            disabled={!canMerge || mergingEco}
            title={
              !canMerge
                ? !gatePassed
                  ? "Simulation checks must pass before merge"
                  : !hasApprovedSig
                    ? "Sign-off quorum required before merge"
                    : "Blocking change requests exist"
                : "Merge Change Request into target branch and tag release"
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 20px",
              borderRadius: "6px",
              border: "1px solid rgba(27, 31, 36, 0.15)",
              background: canMerge ? "#1f883d" : "var(--color-canvas-subtle)",
              color: canMerge ? "#ffffff" : "var(--color-fg-muted)",
              fontSize: "13.5px",
              fontWeight: 600,
              cursor: canMerge && !mergingEco ? "pointer" : "not-allowed",
              opacity: canMerge && !mergingEco ? 1 : 0.65,
              boxShadow: canMerge ? "0 1px 0 rgba(27, 31, 36, 0.1)" : "none",
            }}
          >
            {mergingEco ? <Spinner size="small" /> : <RocketIcon size={14} />}
            <span>{mergeButtonLabel}</span>
          </button>
        )}
      </div>
    )}
  </MergeBox>
);
