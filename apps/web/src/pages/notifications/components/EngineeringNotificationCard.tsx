// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArchiveIcon,
  ClockIcon,
  CpuIcon,
  CreditCardIcon,
  FileCodeIcon,
  PackageIcon,
  PlayIcon,
  ShieldIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitModerationAppeal } from "../../../api";
import Box from "../../../components/Box";
import { formatRelativeTime, getIconForType } from "../formatters";
import {
  EngineeringCard,
  MetricChip,
  ModelBadge,
  NotificationWrapper,
  QuickActionIconButton,
  UnreadDotButton,
} from "../styles";
import type { NotificationItem } from "../types";

export interface EngineeringNotificationCardProps {
  notif: NotificationItem;
  selected?: boolean | undefined;
  onSelect?: ((notif: NotificationItem) => void) | undefined;
  onMarkRead?: ((id: string | number) => void) | undefined;
  onToggleStar?: ((notif: NotificationItem) => void) | undefined;
  onToggleArchive?: ((notif: NotificationItem) => void) | undefined;
}

export const EngineeringNotificationCard: React.FC<EngineeringNotificationCardProps> = ({
  notif,
  selected,
  onSelect,
  onMarkRead,
  onToggleStar,
  onToggleArchive,
}) => {
  const navigate = useNavigate();
  const meta = notif.metadata || {};
  const isSimulation =
    notif.type === "simulation_completed" || notif.type === "simulation" || notif.type === "cae_completed";
  const isSimFailed = notif.type === "simulation_failed" || notif.type === "cae_failed";
  const isPackageYanked = notif.type === "package_yanked";
  const isPackage = notif.type === "package" || notif.type === "package_published" || isPackageYanked;
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
    : isSimFailed || isPackageYanked
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
    if (onSelect) {
      onSelect(notif);
      return;
    }
    if (isSimulation || isSimFailed) {
      const targetModel = meta.name;
      if (targetModel) {
        navigate(`/morsel?model=${encodeURIComponent(targetModel)}`);
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
    <NotificationWrapper
      $unread={!notif.read}
      $selected={selected}
      data-notification-id={String(notif.id)}
      data-unread={!notif.read ? "true" : "false"}
      onClick={handleCardClick}
    >
      <Box width={28} display="flex" justifyContent="center" pt={1}>
        {getIconForType(notif.type)}
      </Box>
      <Box flex={1} style={{ minWidth: 0 }}>
        <EngineeringCard $status={cardStatus}>
          <Box display="flex" justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              {isSimulation && (
                <Label variant="success">{notif.isOutboxJob ? "Dispatched Run" : "Simulation Completed"}</Label>
              )}
              {isSimFailed && <Label variant="danger">Simulation Failed</Label>}
              {isPackage && !isPackageYanked && <Label variant="accent">Package Release</Label>}
              {isPackageYanked && <Label variant="danger">Package Yanked</Label>}
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
            <Box display="flex" alignItems="center" gap="4px" flexShrink={0}>
              <Text style={{ fontSize: "12px", lineHeight: "16px" }} color="var(--color-fg-muted)">
                {formatRelativeTime(notif.created_at || new Date().toISOString())}
              </Text>
              {onToggleStar && !notif.isOutboxJob && (
                <QuickActionIconButton
                  type="button"
                  $active={Boolean(notif.starred)}
                  title={notif.starred ? "Remove from Saved (S)" : "Save for later (S)"}
                  aria-label={notif.starred ? "Remove from Saved" : "Save for later"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleStar(notif);
                  }}
                >
                  {notif.starred ? <StarFillIcon size={14} /> : <StarIcon size={14} />}
                </QuickActionIconButton>
              )}
              {onToggleArchive && !notif.isOutboxJob && (
                <QuickActionIconButton
                  type="button"
                  $active={Boolean(notif.archived)}
                  title={notif.archived ? "Move back to Inbox (E)" : "Archive / Mark Done (E)"}
                  aria-label={notif.archived ? "Move back to Inbox" : "Archive notification"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleArchive(notif);
                  }}
                >
                  <ArchiveIcon size={14} />
                </QuickActionIconButton>
              )}
              {!notif.read && (
                <UnreadDotButton
                  type="button"
                  title="Mark as read"
                  aria-label="Mark notification as read"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkRead?.(notif.id);
                  }}
                />
              )}
            </Box>
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
                    if (!notif.read) onMarkRead?.(notif.id);
                    navigate(meta.name ? `/morsel?model=${encodeURIComponent(meta.name)}` : "/morsel");
                  }}
                >
                  Open in Morsel
                </Button>
                {meta.jobId && (
                  <Button
                    size="small"
                    leadingVisual={FileCodeIcon}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!notif.read) onMarkRead?.(notif.id);
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
                      if (!notif.read) onMarkRead?.(notif.id);
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
                    if (!notif.read) onMarkRead?.(notif.id);
                    navigate(meta.name ? `/morsel?model=${encodeURIComponent(meta.name)}` : "/morsel");
                  }}
                >
                  Open in Morsel
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
                  if (!notif.read) onMarkRead?.(notif.id);
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
                  if (!notif.read) onMarkRead?.(notif.id);
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
