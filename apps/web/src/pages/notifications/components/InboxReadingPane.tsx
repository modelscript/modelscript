// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArchiveIcon,
  BookmarkFillIcon,
  ClockIcon,
  CpuIcon,
  CreditCardIcon,
  FileCodeIcon,
  InboxIcon,
  LinkExternalIcon,
  PackageIcon,
  PlayIcon,
  ShieldIcon,
  StarFillIcon,
  StarIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React from "react";
import { Link, useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import { safeJsonParse } from "../../../util/json";
import { formatPostContent, formatRelativeTime, getIconForType, getMessageForType } from "../formatters";
import { Avatar, EngineeringCard, KbdBadge, MetricChip, ModelBadge, ReadingPaneWrapper } from "../styles";
import type { InboxView, NotificationItem } from "../types";

export interface InboxReadingPaneProps {
  selectedItem: NotificationItem | null;
  activeView: InboxView;
  currentUsername?: string | undefined;
  onToggleArchive: (notif: NotificationItem) => void;
  onToggleStar: (notif: NotificationItem) => void;
  onToggleRead: (notif: NotificationItem) => void;
  onOpenPrimaryTarget: (notif: NotificationItem) => void;
}

export const InboxReadingPane: React.FC<InboxReadingPaneProps> = ({
  selectedItem,
  activeView,
  currentUsername,
  onToggleArchive,
  onToggleStar,
  onToggleRead,
  onOpenPrimaryTarget,
}) => {
  const navigate = useNavigate();

  if (!selectedItem) {
    return (
      <ReadingPaneWrapper data-testid="inbox-reading-pane-empty">
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          p={4}
          style={{
            minHeight: 320,
            textAlign: "center",
            borderRadius: 12,
            border: "1px dashed var(--color-border-default)",
            background: "var(--color-canvas-subtle)",
          }}
        >
          <Box mb={2} color="var(--color-fg-muted)">
            <InboxIcon size={28} />
          </Box>
          <Text fontWeight="bold" fontSize="15px" color="var(--color-fg-default)">
            Select an item to inspect details &amp; actions
          </Text>
          <Text
            fontSize="13px"
            color="var(--color-fg-muted)"
            style={{ maxWidth: 380, marginTop: 6, lineHeight: "18px" }}
          >
            Preview simulation telemetry, solver diagnostics, package releases, saved bookmarks, and discussion threads
            without leaving your {activeView}.
          </Text>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap={3}
            mt={3}
            pt={3}
            flexWrap="wrap"
            borderTop="1px solid var(--color-border-default)"
            style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}
          >
            <span>
              <KbdBadge>J</KbdBadge> <KbdBadge>K</KbdBadge> Navigate
            </span>
            <span>
              <KbdBadge>E</KbdBadge> Archive / Done
            </span>
            <span>
              <KbdBadge>S</KbdBadge> Save
            </span>
            <span>
              <KbdBadge>U</KbdBadge> Read / Unread
            </span>
            <span>
              <KbdBadge>Enter</KbdBadge> Open
            </span>
          </Box>
        </Box>
      </ReadingPaneWrapper>
    );
  }

  const meta = selectedItem.metadata || {};
  const isSimulation =
    selectedItem.type === "simulation_completed" ||
    selectedItem.type === "simulation" ||
    selectedItem.type === "cae_completed";
  const isSimFailed = selectedItem.type === "simulation_failed" || selectedItem.type === "cae_failed";
  const isPackageYanked = selectedItem.type === "package_yanked";
  const isPackage = selectedItem.type === "package" || selectedItem.type === "package_published" || isPackageYanked;
  const isSecurity = selectedItem.type === "security_alert";
  const isCredit = selectedItem.type === "credit_warning";
  const isEngineering = isSimulation || isSimFailed || isPackage || isSecurity || isCredit;

  const primaryActor = selectedItem.actors?.[0] || {
    username: selectedItem.actor_username || "engineer",
    display_name: selectedItem.actor_display_name || selectedItem.actor_username || "Engineer",
    avatar_url: selectedItem.actor_avatar_url,
  };

  let previewImageUrl: string | null = null;
  if (selectedItem.post_artifact_config && selectedItem.post_artifact_type === "picture") {
    const conf = safeJsonParse<{ url?: string | undefined }>(selectedItem.post_artifact_config, {});
    if (conf.url) previewImageUrl = conf.url;
  } else if (selectedItem.post_artifact_config && selectedItem.post_artifact_type === "link-preview") {
    const conf = safeJsonParse<{ image?: string | undefined }>(selectedItem.post_artifact_config, {});
    if (conf.image) previewImageUrl = conf.image;
  }

  const cardStatus = isSimulation
    ? "completed"
    : isSimFailed || isPackageYanked
      ? "failed"
      : isSecurity
        ? "security"
        : isCredit
          ? "credit"
          : "package";

  return (
    <ReadingPaneWrapper data-testid="inbox-reading-pane">
      {/* ── Top Action Toolbar ── */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        pb={3}
        mb={3}
        flexWrap="wrap"
        borderBottom="1px solid var(--color-border-default)"
      >
        <Box display="flex" alignItems="center" gap={2}>
          {getIconForType(selectedItem.type)}
          <Text fontWeight="bold" fontSize="14px" color="var(--color-fg-default)">
            {selectedItem.isOutboxJob
              ? "Dispatched Job Output"
              : selectedItem.isBookmark
                ? "Saved Bookmark"
                : isSimulation
                  ? "Simulation Run"
                  : isSimFailed
                    ? "Simulation Diagnostic"
                    : isPackage
                      ? "Package Registry Event"
                      : isSecurity
                        ? "Security & Governance"
                        : isCredit
                          ? "Compute Wallet Alert"
                          : "Community Discussion"}
          </Text>
          <Text fontSize="12px" color="var(--color-fg-muted)">
            · {formatRelativeTime(selectedItem.created_at || new Date().toISOString())}
          </Text>
        </Box>

        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          {!selectedItem.isOutboxJob && (
            <Button
              size="small"
              leadingVisual={
                selectedItem.isBookmark ? BookmarkFillIcon : selectedItem.starred ? StarFillIcon : StarIcon
              }
              onClick={() => onToggleStar(selectedItem)}
            >
              {selectedItem.isBookmark ? "Bookmarked" : selectedItem.starred ? "Saved" : "Save"}
            </Button>
          )}
          {!selectedItem.isOutboxJob && !selectedItem.isBookmark && (
            <>
              <Button size="small" leadingVisual={ArchiveIcon} onClick={() => onToggleArchive(selectedItem)}>
                {selectedItem.archived ? "Move to Inbox" : "Mark Done"}
              </Button>
              <Button size="small" variant="invisible" onClick={() => onToggleRead(selectedItem)}>
                {selectedItem.read ? "Mark unread" : "Mark read"}
              </Button>
            </>
          )}
        </Box>
      </Box>

      {/* ── Detail Card Body ── */}
      {isEngineering ? (
        <EngineeringCard $status={cardStatus}>
          <Box display="flex" alignItems="center" justifyContent="space-between" gap={2} flexWrap="wrap">
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              {isSimulation && (
                <Label variant="success">{selectedItem.isOutboxJob ? "Dispatched Run" : "Simulation Completed"}</Label>
              )}
              {isSimFailed && <Label variant="danger">Simulation Failed</Label>}
              {isPackage && !isPackageYanked && <Label variant="accent">Package Release</Label>}
              {isPackageYanked && <Label variant="danger">Package Yanked</Label>}
              {isSecurity && <Label variant="danger">Security Advisory</Label>}
              {isCredit && <Label variant="attention">Compute Quota</Label>}
              {meta.solver && <MetricChip>Solver: {meta.solver}</MetricChip>}
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
              {meta.costCredits !== undefined && (
                <MetricChip>
                  <CreditCardIcon size={12} /> {String(meta.costCredits)} cr
                </MetricChip>
              )}
            </Box>
          </Box>

          <Box mt={2} display="flex" flexDirection="column" gap={2}>
            {(isSimulation || isSimFailed) && meta.name && (
              <Box>
                <Text
                  fontSize="12px"
                  color="var(--color-fg-muted)"
                  style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
                >
                  Target Model / Job
                </Text>
                <ModelBadge>{meta.name}</ModelBadge>
              </Box>
            )}

            {isSimFailed && meta.error && (
              <Box>
                <Text
                  fontSize="12px"
                  color="var(--color-danger-fg)"
                  style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
                >
                  Diagnostic Output
                </Text>
                <Box
                  p={3}
                  borderRadius={8}
                  background="rgba(248, 81, 73, 0.1)"
                  border="1px solid rgba(248, 81, 73, 0.25)"
                  color="var(--color-danger-fg)"
                  style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "13px", lineHeight: "18px" }}
                >
                  {meta.error}
                </Box>
              </Box>
            )}

            {isPackage && (
              <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                <ModelBadge>
                  {meta.packageName || selectedItem.package_name}
                  {meta.packageVersion ? `@${meta.packageVersion}` : ""}
                </ModelBadge>
                {meta.distTag && <Label variant="secondary">{meta.distTag}</Label>}
                {meta.totalFiles && (
                  <Text fontSize="13px" color="var(--color-fg-muted)">
                    {meta.totalFiles} files indexed
                  </Text>
                )}
              </Box>
            )}

            {isSecurity && (
              <Text fontSize="14px" color="var(--color-danger-fg)" style={{ lineHeight: "20px" }}>
                {meta.reason || "Vulnerability detected in package dependencies."}
              </Text>
            )}

            {isCredit && (
              <Text fontSize="14px" color="var(--color-attention-fg)" style={{ lineHeight: "20px" }}>
                {meta.message || `Account compute balance has dropped to ${meta.balance ?? "< 10"} credits.`}
              </Text>
            )}
          </Box>

          <Box
            display="flex"
            gap={2}
            mt={3}
            pt={3}
            flexWrap="wrap"
            borderTop="1px solid var(--color-border-subtle, rgba(255,255,255,0.08))"
          >
            {(isSimulation || isSimFailed) && (
              <>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={PlayIcon}
                  onClick={() => navigate(meta.name ? `/morsel?model=${encodeURIComponent(meta.name)}` : "/morsel")}
                >
                  Open in Morsel
                </Button>
                {(meta.jobId || selectedItem.job_id) && (
                  <Button
                    size="small"
                    leadingVisual={FileCodeIcon}
                    onClick={() => navigate(`/jobs/${meta.jobId || selectedItem.job_id}`)}
                  >
                    Inspect Job Log
                  </Button>
                )}
              </>
            )}
            {isPackage && (
              <Button
                size="small"
                variant="primary"
                leadingVisual={PackageIcon}
                onClick={() => navigate(`/packages/${meta.packageName || selectedItem.package_name || ""}`)}
              >
                Inspect Package
              </Button>
            )}
            {isSecurity && (
              <Button
                size="small"
                variant="danger"
                leadingVisual={ShieldIcon}
                onClick={() => navigate("/settings/security")}
              >
                Review Security Settings
              </Button>
            )}
            {isCredit && (
              <Button
                size="small"
                variant="primary"
                leadingVisual={CreditCardIcon}
                onClick={() => navigate("/settings/billing")}
              >
                Top-Up Compute Wallet
              </Button>
            )}
          </Box>
        </EngineeringCard>
      ) : (
        <Box
          p={3}
          borderRadius={10}
          border="1px solid var(--color-border-default)"
          background="var(--color-canvas-default)"
          display="flex"
          flexDirection="column"
          gap={3}
        >
          <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <Link
                to={primaryActor.username ? `/@${primaryActor.username}` : "/home"}
                style={{ textDecoration: "none" }}
              >
                <Avatar
                  $url={primaryActor.avatar_url}
                  $letter={((primaryActor.display_name || primaryActor.username || "?")[0] || "?").toUpperCase()}
                />
              </Link>
              <Box display="flex" flexDirection="column">
                <Link
                  to={primaryActor.username ? `/@${primaryActor.username}` : "/home"}
                  style={{
                    fontWeight: 700,
                    fontSize: "14px",
                    color: "var(--color-fg-default)",
                    textDecoration: "none",
                  }}
                >
                  {primaryActor.display_name || primaryActor.username}
                </Link>
                <Text fontSize="12px" color="var(--color-fg-muted)">
                  @{primaryActor.username}
                </Text>
              </Box>
            </Box>
            {selectedItem.post_artifact_type && <Label variant="accent">{selectedItem.post_artifact_type}</Label>}
          </Box>

          <Box style={{ fontSize: "14px", lineHeight: "20px", color: "var(--color-fg-muted)" }}>
            {getMessageForType(selectedItem.type, selectedItem.actors, currentUsername)}
          </Box>

          {selectedItem.post_content && (
            <Box
              p={3}
              borderRadius={8}
              background="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              style={{ fontSize: "15px", lineHeight: "22px", color: "var(--color-fg-default)", whiteSpace: "pre-wrap" }}
            >
              {formatPostContent(selectedItem.post_content)}
            </Box>
          )}

          {previewImageUrl && (
            <Box
              borderRadius={8}
              overflow="hidden"
              border="1px solid var(--color-border-default)"
              style={{ maxHeight: 280 }}
            >
              <img
                src={previewImageUrl}
                alt="Post attachment preview"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </Box>
          )}

          <Box display="flex" gap={2} pt={2} borderTop="1px solid var(--color-border-default)">
            <Button
              size="small"
              variant="primary"
              leadingVisual={LinkExternalIcon}
              onClick={() => onOpenPrimaryTarget(selectedItem)}
            >
              {selectedItem.post_id ? "Open Post Thread" : "View Profile"}
            </Button>
          </Box>
        </Box>
      )}

      {/* ── Keyboard Shortcut Footer ── */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        gap={2}
        mt={3}
        pt={2}
        flexWrap="wrap"
        style={{ fontSize: "11.5px", color: "var(--color-fg-muted)" }}
      >
        <span>
          <KbdBadge>J</KbdBadge> / <KbdBadge>K</KbdBadge> Next / Prev
        </span>
        <span>
          <KbdBadge>E</KbdBadge> {selectedItem.archived ? "Unarchive" : "Done"}
        </span>
        <span>
          <KbdBadge>S</KbdBadge> {selectedItem.starred || selectedItem.isBookmark ? "Unsave" : "Save"}
        </span>
        <span>
          <KbdBadge>Enter</KbdBadge> Open Target
        </span>
      </Box>
    </ReadingPaneWrapper>
  );
};
