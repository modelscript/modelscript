// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckCircleFillIcon,
  CheckIcon,
  PinIcon,
  ShieldCheckIcon,
  XCircleFillIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, IconButton, Label, Text, Textarea } from "@primer/react";
import React, { useState } from "react";
import styled, { keyframes } from "styled-components";
import type { EngineeringQueryItem } from "./types.js";

export interface EngineeringQueryPinOverlayProps {
  queries: EngineeringQueryItem[];
  zoom: number; // pixels per mm
  pan: { x: number; y: number };
  activeLayer?: string | undefined;
  onSelectQuery?: ((query: EngineeringQueryItem) => void) | undefined;
  onApproveDeviation?: ((queryId: string, notes: string) => Promise<void> | void) | undefined;
  onRejectQuery?: ((queryId: string, notes: string) => Promise<void> | void) | undefined;
  onCreateQuery?:
    | ((newQuery: Omit<EngineeringQueryItem, "id" | "createdAt" | "updatedAt">) => Promise<void> | void)
    | undefined;
  allowCreatePin?: boolean | undefined;
  currentUser?: { id: string; name: string; role: "oem_engineer" | "cm_dfm" | "quality_lead" } | undefined;
}

const pulse = keyframes`
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(207, 34, 46, 0.7); }
  70% { transform: scale(1.15); box-shadow: 0 0 0 10px rgba(207, 34, 46, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(207, 34, 46, 0); }
`;

const OverlayContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 12;
`;

const PinMarker = styled.div<{
  $x: number;
  $y: number;
  $color: string;
  $isOpen: boolean;
  $isSelected: boolean;
}>`
  position: absolute;
  top: ${({ $y }) => $y}px;
  left: ${({ $x }) => $x}px;
  transform: translate(-50%, -100%);
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: ${({ $isSelected }) => ($isSelected ? 25 : 15)};
  transition: transform 0.15s ease-out;

  &:hover {
    transform: translate(-50%, -115%) scale(1.1);
  }

  .pin-head {
    width: 26px;
    height: 26px;
    border-radius: 50% 50% 50% 0;
    transform: rotate(-45deg);
    background-color: ${({ $color }) => $color};
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    ${({ $isOpen, $color }) => $isOpen && `animation: ${pulse} 2s infinite;`}

    svg {
      transform: rotate(45deg);
      color: #ffffff;
      width: 14px;
      height: 14px;
    }
  }

  .pin-tag {
    margin-top: 4px;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(13, 17, 23, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #f0f6fc;
    white-space: nowrap;
  }
`;

const DetailDrawer = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  width: 360px;
  max-height: calc(100% - 32px);
  background: var(--surface-overlay, rgba(22, 27, 34, 0.98));
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  z-index: 30;
  pointer-events: auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const DrawerHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-muted, #21262d);
`;

const DrawerBody = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
  color: var(--color-fg-default, #c9d1d9);
`;

const SignOffItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(110, 118, 129, 0.08);
  font-size: 12px;
`;

export function EngineeringQueryPinOverlay({
  queries,
  zoom,
  pan,
  activeLayer,
  onSelectQuery,
  onApproveDeviation,
  onRejectQuery,
  onCreateQuery: _onCreateQuery,
  allowCreatePin: _allowCreatePin,
  currentUser: _currentUser = { id: "user-1", name: "OEM Lead Engineer", role: "oem_engineer" },
}: EngineeringQueryPinOverlayProps): React.JSX.Element {
  const [selectedQueryId, setSelectedQueryId] = useState<string | null>(null);
  const [approvalNotes, setApprovalNotes] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const selectedQuery = queries.find((q) => q.id === selectedQueryId) || null;

  const getPinColor = (query: EngineeringQueryItem): string => {
    if (query.status === "approved_deviation") return "#2ea043"; // Green
    if (query.status === "rejected") return "#da3633"; // Red
    if (query.status === "resolved") return "#8b949e"; // Muted gray

    switch (query.severity) {
      case "critical":
        return "#cf222e";
      case "major":
        return "#d29922";
      case "minor":
        return "#0969da";
      default:
        return "#6e7681";
    }
  };

  const handleApprove = async () => {
    if (!selectedQuery || !onApproveDeviation) return;
    setIsSubmitting(true);
    try {
      await onApproveDeviation(
        selectedQuery.id,
        approvalNotes || "Deviation formally approved by OEM design authority.",
      );
      setApprovalNotes("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!selectedQuery || !onRejectQuery) return;
    setIsSubmitting(true);
    try {
      await onRejectQuery(
        selectedQuery.id,
        approvalNotes || "Deviation rejected. Board layout must be revised to spec.",
      );
      setApprovalNotes("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OverlayContainer>
      {queries.map((q) => {
        if (!q.location) return null;
        if (activeLayer && q.location.layer && activeLayer !== "All" && q.location.layer !== activeLayer) {
          return null;
        }

        const screenX = pan.x + q.location.x * zoom;
        const screenY = pan.y + q.location.y * zoom;
        const isSelected = q.id === selectedQueryId;
        const color = getPinColor(q);

        return (
          <PinMarker
            key={q.id}
            $x={screenX}
            $y={screenY}
            $color={color}
            $isOpen={q.status === "open" || q.status === "under_review"}
            $isSelected={isSelected}
            onClick={() => {
              setSelectedQueryId(isSelected ? null : q.id);
              onSelectQuery?.(q);
            }}
          >
            <div className="pin-head">
              {q.status === "approved_deviation" ? <CheckIcon /> : q.status === "rejected" ? <XIcon /> : <AlertIcon />}
            </div>
            <div className="pin-tag">
              {q.componentRef ? `${q.componentRef} • ` : ""}
              {q.category.toUpperCase()}
            </div>
          </PinMarker>
        );
      })}

      {selectedQuery && (
        <DetailDrawer>
          <DrawerHeader>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <PinIcon size={16} />
              <Text sx={{ fontWeight: 600, fontSize: 13 }}>Engineering Query (EQ)</Text>
            </div>
            <IconButton
              aria-label="Close"
              icon={XIcon}
              size="small"
              variant="invisible"
              onClick={() => setSelectedQueryId(null)}
            />
          </DrawerHeader>

          <DrawerBody>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Label variant={selectedQuery.severity === "critical" ? "danger" : "attention"}>
                {selectedQuery.severity.toUpperCase()}
              </Label>
              <Label variant="accent">{selectedQuery.category.toUpperCase()}</Label>
              <Label
                variant={
                  selectedQuery.status === "approved_deviation"
                    ? "success"
                    : selectedQuery.status === "open"
                      ? "severe"
                      : "secondary"
                }
              >
                {selectedQuery.status.replace("_", " ").toUpperCase()}
              </Label>
            </div>

            <div>
              <Text sx={{ fontWeight: 600, fontSize: 14 }}>{selectedQuery.title}</Text>
              {selectedQuery.location && (
                <Text sx={{ fontSize: 11, color: "fg.muted", display: "block", mt: 1 }}>
                  Board Location: ({selectedQuery.location.x.toFixed(2)}mm, {selectedQuery.location.y.toFixed(2)}mm)
                  {selectedQuery.location.layer ? ` • ${selectedQuery.location.layer}` : ""}
                </Text>
              )}
            </div>

            <div style={{ background: "rgba(0,0,0,0.2)", padding: 8, borderRadius: 6, fontSize: 12 }}>
              <Text sx={{ color: "fg.muted", fontWeight: 600, display: "block", mb: 1 }}>Description:</Text>
              {selectedQuery.description}
            </div>

            {selectedQuery.suggestedRemedy && (
              <div
                style={{
                  background: "rgba(31, 111, 235, 0.1)",
                  border: "1px solid rgba(31, 111, 235, 0.3)",
                  padding: 8,
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <Text sx={{ color: "accent.fg", fontWeight: 600, display: "block", mb: 1 }}>
                  Suggested Factory Remedy / Deviation:
                </Text>
                {selectedQuery.suggestedRemedy}
              </div>
            )}

            {selectedQuery.signOffs && selectedQuery.signOffs.length > 0 && (
              <div>
                <Text sx={{ fontWeight: 600, fontSize: 12, mb: 1, display: "block" }}>Sign-Off & Audit Trail:</Text>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {selectedQuery.signOffs.map((s, idx) => (
                    <SignOffItem key={idx}>
                      {s.approved ? (
                        <CheckCircleFillIcon size={14} fill="#2ea043" />
                      ) : (
                        <XCircleFillIcon size={14} fill="#da3633" />
                      )}
                      <div>
                        <strong>{s.userName}</strong> ({s.role}) —{" "}
                        <span style={{ color: "var(--color-fg-muted)" }}>{new Date(s.timestamp).toLocaleString()}</span>
                        {s.notes && <div style={{ marginTop: 2, fontStyle: "italic" }}>"{s.notes}"</div>}
                      </div>
                    </SignOffItem>
                  ))}
                </div>
              </div>
            )}

            {selectedQuery.status !== "approved_deviation" && selectedQuery.status !== "resolved" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <Text sx={{ fontWeight: 600, fontSize: 12 }}>OEM Sign-Off Decision:</Text>
                <Textarea
                  placeholder="Engineering justification or deviation concession notes..."
                  rows={2}
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  style={{ width: "100%", fontSize: 12 }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="primary"
                    leadingVisual={ShieldCheckIcon}
                    size="small"
                    disabled={isSubmitting}
                    onClick={handleApprove}
                  >
                    Approve Deviation
                  </Button>
                  <Button variant="danger" size="small" disabled={isSubmitting} onClick={handleReject}>
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </DrawerBody>
        </DetailDrawer>
      )}
    </OverlayContainer>
  );
}
