// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  DownloadIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Text } from "@primer/react";
import React, { useState } from "react";
import { deleteAccount } from "../../../api";
import { useAuth } from "../../../AuthContext";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import {
  DangerButton,
  DetailSubtitle,
  DetailTitle,
  FormInput,
  FormLabel,
  Header,
  PrimaryButton,
  SecondaryButton,
} from "../settingsStyles";

export interface PrivacyTabProps {
  subView: "privacy" | "deleteAccount";
  onNavigate: (tab: any) => void;
}

export const PrivacyTab: React.FC<PrivacyTabProps> = ({ subView, onNavigate }) => {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");
  const [deleteConsentUnderstood, setDeleteConsentUnderstood] = useState(false);
  const [deleteConsentBackedUp, setDeleteConsentBackedUp] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (!user) return;
    if (deleteConfirmUsername.trim() !== user.username) {
      setDeleteError(`Please type your exact username ("${user.username}") to confirm.`);
      return;
    }
    if (!deleteConsentUnderstood || !deleteConsentBackedUp) {
      setDeleteError("Please confirm both acknowledgment checkboxes before proceeding.");
      return;
    }
    setIsDeletingAccount(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      toast.info("Your account and associated personal data have been permanently erased.");
      logout();
      window.location.href = "/";
    } catch (err: any) {
      setDeleteError(err.response?.data?.error || "Failed to delete account. Please try again or contact support.");
      setIsDeletingAccount(false);
    }
  };

  if (subView === "deleteAccount") {
    return (
      <>
        <Header>
          <CircleIconButton onClick={() => onNavigate("privacy")} style={{ marginRight: "8px" }}>
            <ArrowLeftIcon size={20} />
          </CircleIconButton>
          Deactivate or Delete Account
        </Header>
        <Box px={4} pb={4} style={{ overflowY: "auto" }}>
          <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
            Permanently erase your account and personal data pursuant to GDPR Article 17 (Right to Erasure) and CCPA §
            1798.105.
          </DetailSubtitle>

          {/* Danger Warning Box */}
          <Box
            mb={4}
            p={4}
            bg="rgba(218, 54, 51, 0.08)"
            border="1px solid var(--color-danger-fg, #cf222e)"
            borderRadius="12px"
          >
            <Box display="flex" alignItems="center" gap={2} mb={2} color="var(--color-danger-fg, #cf222e)">
              <AlertIcon size={22} />
              <Text fontWeight="bold" fontSize="17px">
                Warning: Irreversible Action
              </Text>
            </Box>
            <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.6", display: "block", marginBottom: "16px" }}>
              Deleting your account permanently anonymizes and erases your profile, email, authentication tokens,
              published posts, comments, models, and personal records. This action cannot be reversed.
            </DetailSubtitle>

            <Box
              p={3}
              bg="var(--color-canvas-default)"
              borderRadius="8px"
              border="1px solid var(--color-border-subtle)"
              display="flex"
              justifyContent="space-between"
              alignItems="center"
            >
              <Box>
                <Text fontWeight="600" fontSize="13px" display="block">
                  Have you backed up your data?
                </Text>
                <DetailSubtitle style={{ fontSize: "12px" }}>
                  You can download a complete ZIP archive with an offline HTML viewer before deleting.
                </DetailSubtitle>
              </Box>
              <SecondaryButton
                type="button"
                onClick={() => onNavigate("dataArchive")}
                style={{ padding: "6px 14px", fontSize: "13px" }}
              >
                <DownloadIcon size={14} />
                Download Archive First
              </SecondaryButton>
            </Box>
          </Box>

          {deleteError && (
            <Box
              mb={4}
              p={3}
              bg="var(--color-danger-subtle)"
              color="var(--color-danger-fg)"
              borderRadius="8px"
              display="flex"
              gap={2}
              alignItems="center"
            >
              <AlertIcon size={18} />
              <Text fontSize="14px">{deleteError}</Text>
            </Box>
          )}

          {/* Confirmation Form */}
          <Box p={4} bg="var(--color-canvas-subtle)" border="1px solid var(--color-border-default)" borderRadius="12px">
            <Text fontWeight="bold" fontSize="16px" display="block" mb={3}>
              Confirm Permanent Erasure
            </Text>

            <Box display="flex" flexDirection="column" gap={3} mb={4}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={deleteConsentUnderstood}
                  onChange={(e) => setDeleteConsentUnderstood(e.target.checked)}
                  style={{ marginTop: "3px", width: "18px", height: "18px", cursor: "pointer" }}
                />
                <Text fontSize="14px" style={{ lineHeight: "1.4" }}>
                  I understand that this action is permanent and my account, posts, models, and credits will be
                  permanently destroyed.
                </Text>
              </label>

              <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={deleteConsentBackedUp}
                  onChange={(e) => setDeleteConsentBackedUp(e.target.checked)}
                  style={{ marginTop: "3px", width: "18px", height: "18px", cursor: "pointer" }}
                />
                <Text fontSize="14px" style={{ lineHeight: "1.4" }}>
                  I have exported any data archives I wish to keep or confirm that I do not need them.
                </Text>
              </label>
            </Box>

            <Box mb={4}>
              <FormLabel style={{ display: "block", marginBottom: "6px" }}>
                Type your username{" "}
                <span style={{ fontFamily: "monospace", color: "var(--color-danger-fg)" }}>"{user?.username}"</span> to
                confirm:
              </FormLabel>
              <FormInput
                placeholder={user?.username || "username"}
                value={deleteConfirmUsername}
                onChange={(e) => setDeleteConfirmUsername(e.target.value)}
                style={{ marginTop: 0 }}
              />
            </Box>

            <Box display="flex" justifyContent="flex-end" gap={3}>
              <SecondaryButton type="button" onClick={() => onNavigate("privacy")}>
                Cancel
              </SecondaryButton>
              <DangerButton
                type="button"
                onClick={handleDeleteAccount}
                disabled={
                  isDeletingAccount ||
                  deleteConfirmUsername.trim() !== user?.username ||
                  !deleteConsentUnderstood ||
                  !deleteConsentBackedUp
                }
              >
                <TrashIcon size={16} />
                {isDeletingAccount ? "Erasing Account..." : "Permanently Delete My Account"}
              </DangerButton>
            </Box>
          </Box>
        </Box>
      </>
    );
  }

  return (
    <>
      <Header>
        <CircleIconButton onClick={() => onNavigate("account")} style={{ marginRight: "8px" }}>
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Privacy &amp; Data Protection
      </Header>
      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "24px" }}>
          Manage your personal data, exercise your privacy rights under GDPR and CCPA, and review how ModelScript
          safeguards your data with zero third-party tracking.
        </DetailSubtitle>

        {/* GDPR & CCPA Subject Rights Card */}
        <Box mb={4}>
          <DetailTitle style={{ fontSize: "18px", fontWeight: "bold", display: "block", marginBottom: "12px" }}>
            Your Rights Under GDPR &amp; CCPA
          </DetailTitle>
          <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap={3}>
            <Box
              p={4}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius="12px"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box color="var(--color-accent-fg)">
                    <DownloadIcon size={20} />
                  </Box>
                  <Text fontWeight="bold" fontSize="16px">
                    Data Portability
                  </Text>
                </Box>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
                  Download a complete, offline-browsable archive (.ZIP) of your models, posts, profile, compute ledger,
                  and activity history (GDPR Art. 20 / CCPA § 1798.100).
                </DetailSubtitle>
              </Box>
              <PrimaryButton type="button" onClick={() => onNavigate("dataArchive")}>
                <DownloadIcon size={16} />
                Download Data Archive
              </PrimaryButton>
            </Box>

            <Box
              p={4}
              bg="var(--color-canvas-subtle)"
              border="1px solid var(--color-border-default)"
              borderRadius="12px"
              display="flex"
              flexDirection="column"
              justifyContent="space-between"
            >
              <Box>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                  <Box color="var(--color-danger-fg)">
                    <TrashIcon size={20} />
                  </Box>
                  <Text fontWeight="bold" fontSize="16px">
                    Right to Erasure
                  </Text>
                </Box>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.5", display: "block", marginBottom: "16px" }}>
                  Permanently anonymize or delete your account, authored content, credentials, and telemetry records
                  from our active databases (GDPR Art. 17 / CCPA § 1798.105).
                </DetailSubtitle>
              </Box>
              <DangerButton type="button" onClick={() => onNavigate("deleteAccount")}>
                <TrashIcon size={16} />
                Delete Account &amp; Data
              </DangerButton>
            </Box>
          </Box>
        </Box>

        {/* Data Processing & Compliance Architecture */}
        <Box
          mb={4}
          p={4}
          bg="var(--color-canvas-subtle)"
          border="1px solid var(--color-border-default)"
          borderRadius="12px"
        >
          <Box display="flex" alignItems="center" gap={2} mb={3}>
            <Box color="var(--color-success-fg)">
              <ShieldCheckIcon size={22} />
            </Box>
            <Text fontWeight="bold" fontSize="17px">
              First-Party Privacy Architecture
            </Text>
          </Box>
          <DetailSubtitle style={{ fontSize: "14px", lineHeight: "1.6", display: "block", marginBottom: "16px" }}>
            ModelScript is built around strict data minimization and user sovereignty:
          </DetailSubtitle>

          <Box display="flex" flexDirection="column" gap={3}>
            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Zero Third-Party Trackers
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  We do not load external analytics libraries (Google Analytics, Meta Pixel, Hotjar) or sell user data
                  to advertising brokers.
                </DetailSubtitle>
              </Box>
            </Box>

            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Scrubbed &amp; Ephemeral Geo-Metrics
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  To provide post creators with aggregated viewer geographic heatmaps, client IP addresses are resolved
                  to country/region ISO codes purely in-memory. Raw IP addresses are scrubbed immediately and never
                  saved to the database.
                </DetailSubtitle>
              </Box>
            </Box>

            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Automated 30-Day Log Rotation
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  Security audit events, authentication attempts, and operational server logs are kept for a maximum of
                  30 days, after which they are systematically purged by automated background routines.
                </DetailSubtitle>
              </Box>
            </Box>

            <Box display="flex" gap={3}>
              <Box color="var(--color-accent-fg)" mt={1}>
                <CheckCircleIcon size={18} />
              </Box>
              <Box>
                <Text fontWeight="600" fontSize="14px" display="block">
                  Self-Contained Data Archives
                </Text>
                <DetailSubtitle style={{ fontSize: "13px", lineHeight: "1.4" }}>
                  Exported archives contain a standalone HTML viewer with zero external CDN dependencies, ensuring your
                  historical data can be inspected completely offline for decades.
                </DetailSubtitle>
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Policy Reference */}
        <Box
          p={3}
          bg="var(--color-canvas-default)"
          border="1px solid var(--color-border-subtle)"
          borderRadius="8px"
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          <Box>
            <Text fontWeight="600" fontSize="14px" display="block">
              Full Legal Documentation
            </Text>
            <DetailSubtitle style={{ fontSize: "13px" }}>
              Read our full terms and transparent data retention policy in the repository's PRIVACY.md.
            </DetailSubtitle>
          </Box>
          <a
            href="/PRIVACY.md"
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--color-accent-emphasis)",
              fontWeight: 600,
              fontSize: "14px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            View Privacy Policy &rarr;
          </a>
        </Box>
      </Box>
    </>
  );
};
