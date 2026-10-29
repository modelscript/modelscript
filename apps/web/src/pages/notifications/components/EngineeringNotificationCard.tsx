// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ClockIcon,
  CpuIcon,
  CreditCardIcon,
  FileCodeIcon,
  PackageIcon,
  PlayIcon,
  ShieldIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitModerationAppeal } from "../../../api";
import Box from "../../../components/Box";
import { formatRelativeTime, getIconForType } from "../formatters";
import { EngineeringCard, MetricChip, ModelBadge, NotificationWrapper } from "../styles";
import type { NotificationItem } from "../types";

export interface EngineeringNotificationCardProps {
  notif: NotificationItem;
  onMarkRead?: ((id: string | number) => void) | undefined;
}

export const EngineeringNotificationCard: React.FC<EngineeringNotificationCardProps> = ({ notif, onMarkRead }) => {
  const navigate = useNavigate();
  const meta = notif.metadata || {};
  const isSimulation = notif.type === "simulation_completed" || notif.type === "simulation";
  const isSimFailed = notif.type === "simulation_failed";
  const isPackage = notif.type === "package" || notif.type === "package_published";
  const isSecurity = notif.type === "security_alert";
  const isCredit = notif.type === "credit_warning";
  const isModerationNotice = isSecurity && Boolean(meta["moderationAction"]);
  const canAppeal = Boolean(meta["canAppeal"]);

  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealDetails, setAppealDetails] = useState("");
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealSubmitted, setAppealSubmitted] = useState(false);

  const cardStatus = isSimulation
    ? "completed"
    : isSimFailed
      ? "failed"
      : isSecurity
        ? "security"
        : isCredit
          ? "credit"
          : "package";

  const handleCardClick = () => {
    if (showAppealForm) return;
    if (!notif.read) {
      onMarkRead?.(notif.id);
    }
    if (isSimulation || isSimFailed) {
      const targetModel = meta.name;
      if (targetModel) {
        navigate(`/playground?model=${encodeURIComponent(targetModel)}`);
      } else {
        navigate(meta.jobId || notif.job_id ? `/jobs/${meta.jobId || notif.job_id}` : "/jobs");
      }
    } else if (isPackage) {
      navigate(
        meta.packageName || notif.package_name ? `/packages/${meta.packageName || notif.package_name}` : "/packages",
      );
    } else if (isCredit) {
      navigate("/settings/billing");
    } else if (isSecurity && !isModerationNotice) {
      navigate("/settings/security");
    }
  };

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!appealDetails.trim()) return;
    setAppealSubmitting(true);
    try {
      await submitModerationAppeal(
        `Appeal for ${String(meta["moderationAction"] || "moderation action")}`,
        appealDetails.trim(),
        notif.post_id ? Number(notif.post_id) : undefined,
      );
      setAppealSubmitted(true);
      setShowAppealForm(false);
    } catch {
      // Handled silently or retryable
    } finally {
      setAppealSubmitting(false);
    }
  };

  return (
    <NotificationWrapper $unread={!notif.read} onClick={handleCardClick}>
      <Box width={36} display="flex" justifyContent="center" pt={1}>
        {getIconForType(notif.type)}
      </Box>
      <Box flex={1}>
        <EngineeringCard $status={cardStatus}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={2}>
              {isSimulation && <Label variant="success">Simulation Completed</Label>}
              {isSimFailed && <Label variant="danger">Simulation Failed</Label>}
              {isPackage && <Label variant="accent">Package Release</Label>}
              {isSecurity && (
                <Label variant={meta["moderationAction"] === "restore_user" ? "success" : "danger"}>
                  {isModerationNotice
                    ? meta["moderationAction"] === "restore_user"
                      ? "Account Restored"
                      : "Moderation Notice"
                    : "Security Advisory"}
                </Label>
              )}
              {isCredit && <Label variant="attention">Compute Quota</Label>}
              {meta.profile && (
                <MetricChip>
                  <CpuIcon size={12} /> {meta.profile}
                </MetricChip>
              )}
              {meta.duration && (
                <MetricChip>
                  <ClockIcon size={12} /> {meta.duration}s
                </MetricChip>
              )}
            </Box>
            <Text style={{ fontSize: "13px", lineHeight: "16px" }} color="var(--color-fg-muted)">
              {formatRelativeTime(notif.created_at || new Date().toISOString())}
            </Text>
          </Box>

          {/* Title & Body */}
          <Box mt={1}>
            {(isSimulation || isSimFailed) && meta.name && (
              <Box display="flex" alignItems="center" gap={2} mb={1}>
                <ModelBadge>{meta.name}</ModelBadge>
              </Box>
            )}
            {isSimFailed && meta.error && (
              <Box
                p={2}
                borderRadius={6}
                background="rgba(248, 81, 73, 0.1)"
                border="1px solid rgba(248, 81, 73, 0.25)"
                color="var(--color-danger-fg)"
                style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "13px", lineHeight: "16px" }}
              >
                {meta.error}
              </Box>
            )}
            {isPackage && (
              <Box display="flex" alignItems="center" gap={2}>
                <ModelBadge>
                  {meta.packageName || notif.package_name}
                  {meta.packageVersion ? `@${meta.packageVersion}` : ""}
                </ModelBadge>
                {meta.distTag && <Label variant="secondary">{meta.distTag}</Label>}
                {meta.totalFiles && (
                  <Text style={{ fontSize: "13px", lineHeight: "16px" }} color="var(--color-fg-muted)">
                    {meta.totalFiles} files
                  </Text>
                )}
              </Box>
            )}
            {isSecurity && (
              <Text style={{ fontSize: "15px", lineHeight: "20px", display: "block" }} color="var(--color-danger-fg)">
                {meta.reason || "Vulnerability detected in package dependencies."}
              </Text>
            )}
            {isCredit && (
              <Text
                style={{ fontSize: "15px", lineHeight: "20px", display: "block" }}
                color="var(--color-attention-fg)"
              >
                {meta.message || `Account compute balance has dropped to ${meta.balance ?? "< 10"} credits.`}
              </Text>
            )}
          </Box>

          {/* Quick Actions */}
          <Box
            display="flex"
            gap={2}
            mt={1}
            pt={1}
            borderTop="1px solid var(--color-border-subtle, rgba(255,255,255,0.06))"
          >
            {isSimulation && (
              <>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={PlayIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(meta.name ? `/playground?model=${encodeURIComponent(meta.name)}` : "/playground");
                  }}
                >
                  Open in Playground
                </Button>
                {meta.jobId && (
                  <Button
                    size="small"
                    leadingVisual={FileCodeIcon}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/jobs/${meta.jobId}`);
                    }}
                  >
                    View Job Log
                  </Button>
                )}
              </>
            )}
            {isSimFailed && (
              <>
                {meta.jobId && (
                  <Button
                    size="small"
                    variant="danger"
                    leadingVisual={FileCodeIcon}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/jobs/${meta.jobId}`);
                    }}
                  >
                    Inspect Failure Log
                  </Button>
                )}
                <Button
                  size="small"
                  leadingVisual={PlayIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(meta.name ? `/playground?model=${encodeURIComponent(meta.name)}` : "/playground");
                  }}
                >
                  Open in Editor
                </Button>
              </>
            )}
            {isPackage && (
              <Button
                size="small"
                variant="primary"
                leadingVisual={PackageIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/packages/${meta.packageName || notif.package_name}`);
                }}
              >
                Inspect Package
              </Button>
            )}
            {isSecurity && (
              <>
                {canAppeal && !appealSubmitted && (
                  <Button
                    size="small"
                    variant="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAppealForm((prev) => !prev);
                    }}
                  >
                    {showAppealForm ? "Cancel Appeal" : "Submit Appeal"}
                  </Button>
                )}
                {appealSubmitted && <Label variant="success">Appeal Submitted for Review</Label>}
                <Button
                  size="small"
                  variant="danger"
                  leadingVisual={ShieldIcon}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!notif.read) onMarkRead?.(notif.id);
                    navigate("/settings/security");
                  }}
                >
                  Review Security Settings
                </Button>
              </>
            )}
            {isCredit && (
              <Button
                size="small"
                variant="primary"
                leadingVisual={CreditCardIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate("/settings/billing");
                }}
              >
                Top-Up Compute Wallet
              </Button>
            )}
          </Box>

          {showAppealForm && (
            <form
              onSubmit={handleSubmitAppeal}
              onClick={(e) => e.stopPropagation()}
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Text fontSize="12px" fontWeight="bold">
                Explain why this moderation decision should be reconsidered:
              </Text>
              <textarea
                rows={3}
                value={appealDetails}
                onChange={(e) => setAppealDetails(e.target.value)}
                placeholder="Provide context or corrections for the moderation team..."
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-default)",
                  color: "var(--color-fg-default)",
                  fontSize: "12px",
                }}
              />
              <Box display="flex" justifyContent="flex-end" gap={2}>
                <Button
                  size="small"
                  type="submit"
                  variant="primary"
                  disabled={appealSubmitting || !appealDetails.trim()}
                >
                  {appealSubmitting ? "Submitting..." : "Send Appeal"}
                </Button>
              </Box>
            </form>
          )}
        </EngineeringCard>
      </Box>
    </NotificationWrapper>
  );
};
