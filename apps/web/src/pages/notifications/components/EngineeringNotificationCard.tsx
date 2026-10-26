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
import React from "react";
import { useNavigate } from "react-router-dom";
import Box from "../../../components/Box";
import { formatRelativeTime, getIconForType } from "../formatters";
import { EngineeringCard, MetricChip, ModelBadge, NotificationWrapper } from "../styles";
import type { NotificationItem } from "../types";

export interface EngineeringNotificationCardProps {
  notif: NotificationItem;
}

export const EngineeringNotificationCard: React.FC<EngineeringNotificationCardProps> = ({ notif }) => {
  const navigate = useNavigate();
  const meta = notif.metadata || {};
  const isSimulation = notif.type === "simulation_completed" || notif.type === "simulation";
  const isSimFailed = notif.type === "simulation_failed";
  const isPackage = notif.type === "package" || notif.type === "package_published";
  const isSecurity = notif.type === "security_alert";
  const isCredit = notif.type === "credit_warning";

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
    } else if (isSecurity) {
      navigate("/settings");
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
              {isSecurity && <Label variant="danger">Security Advisory</Label>}
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
            <Text fontSize="12px" color="var(--color-fg-muted)">
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
                fontSize="13px"
                color="var(--color-danger-fg)"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
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
                  <Text fontSize="13px" color="var(--color-fg-muted)">
                    {meta.totalFiles} files
                  </Text>
                )}
              </Box>
            )}
            {isSecurity && (
              <Text fontSize="13px" color="var(--color-danger-fg)">
                {meta.reason || "Vulnerability detected in package dependencies."}
              </Text>
            )}
            {isCredit && (
              <Text fontSize="13px" color="var(--color-attention-fg)">
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
              <Button
                size="small"
                variant="danger"
                leadingVisual={ShieldIcon}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate("/settings");
                }}
              >
                Review Security Settings
              </Button>
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
        </EngineeringCard>
      </Box>
    </NotificationWrapper>
  );
};
