// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowLeftIcon,
  CheckCircleFillIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  KeyIcon,
  PlusIcon,
  SparkleFillIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { generateUserInvite, getUserInvites } from "../../../api/admin";
import Box from "../../../components/Box";
import { CircleIconButton } from "../../../components/SharedStyles";
import { useToast } from "../../../components/ToastContext";
import { useInstanceBranding } from "../../../InstanceBrandingContext";
import { DetailSubtitle, FormInput, FormLabel, Header, SaveButton } from "../settingsStyles";

export interface InvitesTabProps {
  onBack: () => void;
}

const StatCard = styled.div`
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);
  border: 1px solid rgba(6, 182, 212, 0.3);
  border-radius: 16px;
  padding: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;

  @media (max-width: 600px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
`;

const QuotaNumber = styled.div`
  font-size: 36px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.03em;
  display: flex;
  align-items: baseline;
  gap: 8px;

  span {
    font-size: 16px;
    font-weight: 500;
    color: var(--color-text-secondary, #94a3b8);
  }
`;

const GenerateSection = styled.div`
  background: var(--surface-overlay, #0e1424);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 28px;
`;

const TableContainer = styled.div`
  overflow-x: auto;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  border-radius: 12px;
  margin-bottom: 32px;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  text-align: left;

  th {
    background: rgba(255, 255, 255, 0.03);
    padding: 12px 16px;
    color: var(--color-text-secondary, #94a3b8);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  }

  td {
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.06));
    color: #fff;
  }

  tr:last-child td {
    border-bottom: none;
  }
`;

const CopyButton = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.25);
  }
`;

const StatusBadge = styled.span<{ $variant: "success" | "pending" | "used" }>`
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 6px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: ${(props) =>
    props.$variant === "success"
      ? "rgba(16, 185, 129, 0.15)"
      : props.$variant === "pending"
        ? "rgba(234, 179, 8, 0.15)"
        : "rgba(148, 163, 184, 0.15)"};
  color: ${(props) =>
    props.$variant === "success" ? "#10b981" : props.$variant === "pending" ? "#eab308" : "#94a3b8"};
  border: 1px solid
    ${(props) =>
      props.$variant === "success"
        ? "rgba(16, 185, 129, 0.3)"
        : props.$variant === "pending"
          ? "rgba(234, 179, 8, 0.3)"
          : "rgba(148, 163, 184, 0.3)"};
`;

export const InvitesTab: React.FC<InvitesTabProps> = ({ onBack }) => {
  const toast = useToast();
  const branding = useInstanceBranding();
  const brandName = branding.instanceName || "Ansatz";

  const [_loading, setLoading] = useState(true);
  const [invitesRemaining, setInvitesRemaining] = useState(0);
  const [invites, setInvites] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [note, setNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getUserInvites();
      setInvitesRemaining(data.invitesRemaining);
      setInvites(data.invites);
      setReferrals(data.referrals);
    } catch {
      toast.show("Failed to load invites", { type: "error" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invitesRemaining <= 0) return;

    setGenerating(true);
    try {
      await generateUserInvite(note.trim() || undefined);
      toast.show("Golden ticket generated successfully!", { type: "success" });
      setNote("");
      await fetchInvites();
    } catch {
      toast.show("Failed to generate ticket", { type: "error" });
    } finally {
      setGenerating(false);
    }
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`;
    navigator.clipboard.writeText(link).catch(() => {});
    setCopiedCode(code);
    toast.show("Invite link copied to clipboard", { type: "success" });
    setTimeout(() => setCopiedCode(null), 2500);
  };

  return (
    <>
      <Header>
        <CircleIconButton onClick={onBack} style={{ marginRight: "8px" }} aria-label="Go back">
          <ArrowLeftIcon size={20} />
        </CircleIconButton>
        Member Invites & Golden Tickets
      </Header>

      <Box px={4} pb={4} style={{ overflowY: "auto" }}>
        <DetailSubtitle style={{ fontSize: "15px", lineHeight: "1.5", display: "block", marginBottom: "20px" }}>
          Invite colleagues and fellow researchers to {brandName}. When an engineer registers with your Golden Ticket
          and completes their first simulation run, both of your accounts receive{" "}
          <strong>75 free compute credits</strong>.
        </DetailSubtitle>

        {/* STAT QUOTA CARD */}
        <StatCard>
          <div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--color-accent-cyan, #06b6d4)",
                marginBottom: "4px",
              }}
            >
              Available Golden Tickets
            </div>
            <QuotaNumber>
              {invitesRemaining}
              <span>invites remaining</span>
            </QuotaNumber>
          </div>
          <div
            style={{
              fontSize: "13px",
              color: "var(--color-text-secondary, #94a3b8)",
              maxWidth: "260px",
              lineHeight: "1.4",
            }}
          >
            Single-use invitations bypass any public waitlists and provide instant access key activation.
          </div>
        </StatCard>

        {/* GENERATE SECTION */}
        <GenerateSection>
          <div
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "#fff",
              marginBottom: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <KeyIcon size={18} />
            Generate New Golden Ticket
          </div>
          <form onSubmit={handleGenerate}>
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: "240px" }}>
                <FormLabel htmlFor="ticket-note">Recipient note (optional)</FormLabel>
                <FormInput
                  id="ticket-note"
                  type="text"
                  placeholder="e.g. For Dr. Robert Smith (Propulsion Lab)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={invitesRemaining <= 0 || generating}
                />
              </div>
              <SaveButton type="submit" disabled={invitesRemaining <= 0 || generating} style={{ height: "42px" }}>
                <PlusIcon size={16} />
                {generating ? "Generating…" : "Generate Ticket"}
              </SaveButton>
            </div>
          </form>
        </GenerateSection>

        {/* INVITES TABLE */}
        <div style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "12px" }}>
          Your Generated Tickets ({invites.length})
        </div>
        <TableContainer>
          <StyledTable>
            <thead>
              <tr>
                <th>Invite Code</th>
                <th>Status</th>
                <th>Initial Credits</th>
                <th>Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {invites.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: "center", color: "var(--color-text-secondary, #94a3b8)", padding: "24px" }}
                  >
                    No golden tickets generated yet.
                  </td>
                </tr>
              ) : (
                invites.map((inv) => {
                  const isUsed = inv.uses_count >= inv.max_uses;
                  return (
                    <tr key={inv.id}>
                      <td
                        style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--color-accent-cyan, #06b6d4)" }}
                      >
                        {inv.code}
                      </td>
                      <td>
                        <StatusBadge $variant={isUsed ? "used" : "success"}>
                          {isUsed ? "Redeemed" : "Available"}
                        </StatusBadge>
                      </td>
                      <td>{inv.initial_credits} MSX</td>
                      <td style={{ color: "var(--color-text-secondary, #94a3b8)" }}>{inv.note || "—"}</td>
                      <td>
                        <CopyButton type="button" onClick={() => copyInviteLink(inv.code)}>
                          {copiedCode === inv.code ? (
                            <>
                              <CheckIcon size={14} fill="#10b981" /> Copied
                            </>
                          ) : (
                            <>
                              <CopyIcon size={14} /> Copy Link
                            </>
                          )}
                        </CopyButton>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </StyledTable>
        </TableContainer>

        {/* REFERRAL ACTIVITY & BONUSES */}
        <div
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "#fff",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <SparkleFillIcon size={16} fill="var(--color-accent-cyan, #06b6d4)" />
          Colleague Referral Rewards ({referrals.length})
        </div>
        <TableContainer>
          <StyledTable>
            <thead>
              <tr>
                <th>Colleague</th>
                <th>Status</th>
                <th>Bonus Granted</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {referrals.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    style={{ textAlign: "center", color: "var(--color-text-secondary, #94a3b8)", padding: "24px" }}
                  >
                    No colleague referrals yet. Share an invite link to start earning simulation credits!
                  </td>
                </tr>
              ) : (
                referrals.map((ref) => (
                  <tr key={ref.id}>
                    <td style={{ fontWeight: 600 }}>@{ref.referee_username}</td>
                    <td>
                      {ref.reward_granted ? (
                        <StatusBadge $variant="success">
                          <CheckCircleFillIcon size={12} style={{ marginRight: "4px" }} />
                          Completed Simulation
                        </StatusBadge>
                      ) : (
                        <StatusBadge $variant="pending">
                          <ClockIcon size={12} style={{ marginRight: "4px" }} />
                          Pending First Run
                        </StatusBadge>
                      )}
                    </td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: ref.reward_granted ? "#10b981" : "var(--color-text-secondary, #94a3b8)",
                      }}
                    >
                      {ref.reward_granted ? `+${ref.reward_amount} Credits` : "75 Credits on First Run"}
                    </td>
                    <td style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                      {new Date(ref.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </StyledTable>
        </TableContainer>
      </Box>
    </>
  );
};
