// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckIcon, SyncIcon, XIcon } from "@primer/octicons-react";
import { Button, Flash, Text } from "@primer/react";
import React from "react";
import { Link } from "react-router-dom";
import type { PendingPackageTransfer } from "../../../api";
import Box from "../../../components/Box";

export interface PendingTransfersBannerProps {
  pendingTransfers: PendingPackageTransfer[];
  transferBusyId: number | null;
  transferFeedback: { type: "success" | "danger"; message: string } | null;
  onDismissFeedback: () => void;
  onAcceptTransfer: (transfer: PendingPackageTransfer) => void;
  onCancelTransfer: (transfer: PendingPackageTransfer) => void;
  currentUserId?: string | number | undefined;
  currentUsername?: string | undefined;
}

export const PendingTransfersBanner: React.FC<PendingTransfersBannerProps> = ({
  pendingTransfers,
  transferBusyId,
  transferFeedback,
  onDismissFeedback,
  onAcceptTransfer,
  onCancelTransfer,
  currentUserId,
  currentUsername,
}) => {
  return (
    <>
      {transferFeedback && (
        <Box mb={3}>
          <Flash variant={transferFeedback.type} onDismiss={onDismissFeedback}>
            {transferFeedback.message}
          </Flash>
        </Box>
      )}

      {pendingTransfers.length > 0 && (
        <Box
          mb={4}
          p={3}
          style={{
            borderRadius: 12,
            background: "rgba(139, 92, 246, 0.08)",
            border: "1px solid rgba(139, 92, 246, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Text style={{ fontWeight: 700, fontSize: 14, color: "var(--color-text-heading)" }}>
              Pending Package Ownership Transfers ({pendingTransfers.length})
            </Text>
          </Box>
          {pendingTransfers.map((tr) => {
            const isIncoming = tr.to_user_id === currentUserId || tr.to_username === currentUsername;
            const isBusy = transferBusyId === tr.id;
            return (
              <Box
                key={tr.id}
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                flexWrap="wrap"
                gap={2}
                p={2}
                style={{
                  borderRadius: 8,
                  background: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <SyncIcon size={16} fill="#a855f7" />
                  {isIncoming ? (
                    <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                      <strong>@{tr.from_username || "User"}</strong> invited you to accept ownership of{" "}
                      <Link
                        to={`/packages/${tr.package_name}`}
                        style={{ color: "var(--color-accent-cyan, #06b6d4)", fontWeight: 600 }}
                      >
                        {tr.package_name}
                      </Link>
                    </Text>
                  ) : (
                    <Text style={{ fontSize: 13, color: "var(--color-text-primary)" }}>
                      Outgoing transfer of{" "}
                      <Link
                        to={`/packages/${tr.package_name}`}
                        style={{ color: "var(--color-accent-cyan, #06b6d4)", fontWeight: 600 }}
                      >
                        {tr.package_name}
                      </Link>{" "}
                      to <strong>@{tr.to_username || "recipient"}</strong> (awaiting acceptance)
                    </Text>
                  )}
                </Box>
                <Box display="flex" alignItems="center" gap={2}>
                  {isIncoming && (
                    <Button
                      size="small"
                      variant="primary"
                      leadingVisual={CheckIcon}
                      disabled={isBusy}
                      onClick={() => onAcceptTransfer(tr)}
                    >
                      Accept Ownership
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="danger"
                    leadingVisual={XIcon}
                    disabled={isBusy}
                    onClick={() => onCancelTransfer(tr)}
                  >
                    {isIncoming ? "Decline" : "Cancel Request"}
                  </Button>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </>
  );
};
