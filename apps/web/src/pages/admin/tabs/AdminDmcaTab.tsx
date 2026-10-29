// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import Box from "../../../components/Box";
import { sanitizeHttpUrl } from "../../../util/url";
import { ActionButton, Badge, Card, FilterPill, ModalBox, ModalOverlay, Select, Textarea } from "../styles";
import type { AdminDmcaNotice } from "../types";

export interface AdminDmcaTabProps {
  dmcaNotices: AdminDmcaNotice[];
  dmcaFilter: string;
  setDmcaFilter: (filter: string) => void;
  onResolveDmca: (
    noticeId: number,
    actionTaken: string,
    options?: { status?: "resolved" | "rejected" | undefined; quarantineResource?: boolean | undefined },
  ) => Promise<void>;
  loading: boolean;
}

const DMCA_TEMPLATES = [
  {
    label: "Statutory Takedown Executed",
    status: "resolved" as const,
    text: "Takedown executed per 17 U.S.C. § 512(c) statutory requirements; target resource removed.",
  },
  {
    label: "Incomplete Statutory Elements",
    status: "rejected" as const,
    text: "Rejected: Notice lacks required statutory elements under 17 U.S.C. § 512(c)(3).",
  },
  {
    label: "Fair Use / Open-Source License Verified",
    status: "rejected" as const,
    text: "Rejected: Target model is licensed under an open-source SPDX license permitting redistribution.",
  },
];

export const AdminDmcaTab: React.FC<AdminDmcaTabProps> = ({
  dmcaNotices,
  dmcaFilter,
  setDmcaFilter,
  onResolveDmca,
  loading,
}) => {
  const [activeDmcaToResolve, setActiveDmcaToResolve] = useState<AdminDmcaNotice | null>(null);
  const [dmcaActionTaken, setDmcaActionTaken] = useState("");
  const [dmcaResolutionStatus, setDmcaResolutionStatus] = useState<"resolved" | "rejected">("resolved");
  const [quarantineResource, setQuarantineResource] = useState(true);

  const handleConfirmResolve = async () => {
    if (!activeDmcaToResolve || !dmcaActionTaken.trim()) return;
    await onResolveDmca(activeDmcaToResolve.id, dmcaActionTaken.trim(), {
      status: dmcaResolutionStatus,
      quarantineResource: dmcaResolutionStatus === "resolved" ? quarantineResource : false,
    });
    setActiveDmcaToResolve(null);
    setDmcaActionTaken("");
  };

  return (
    <div>
      <Box display="flex" gap={2} mb={3} flexWrap="wrap">
        <FilterPill $active={dmcaFilter === "all"} onClick={() => setDmcaFilter("all")}>
          All Notices
        </FilterPill>
        <FilterPill $active={dmcaFilter === "pending"} onClick={() => setDmcaFilter("pending")}>
          Pending
        </FilterPill>
        <FilterPill $active={dmcaFilter === "resolved"} onClick={() => setDmcaFilter("resolved")}>
          Resolved
        </FilterPill>
        <FilterPill $active={dmcaFilter === "rejected"} onClick={() => setDmcaFilter("rejected")}>
          Rejected
        </FilterPill>
      </Box>

      {dmcaNotices.length === 0 ? (
        <Card>
          <Box color="var(--color-text-muted)" textAlign="center" py={4}>
            No DMCA notices found.
          </Box>
        </Card>
      ) : (
        dmcaNotices.map((n) => (
          <Card key={n.id}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={2}>
                <span style={{ fontWeight: 700 }}>Notice #{n.id}</span>
                <Badge $variant={n.status === "resolved" ? "success" : n.status === "rejected" ? "neutral" : "warning"}>
                  {n.status}
                </Badge>
              </Box>
              <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                {new Date(n.created_at).toLocaleString()}
              </span>
            </Box>

            <Box fontSize="13px">
              <strong>Claimant:</strong> {n.claimant_name} ({n.claimant_email}) &bull; <strong>Owner:</strong>{" "}
              {n.copyright_owner}
            </Box>

            <Box fontSize="13px">
              <strong>Infringing URL:</strong>{" "}
              {sanitizeHttpUrl(n.infringing_url, { allowRelative: true, prependHttpsIfMissingScheme: true }) ? (
                <a
                  href={sanitizeHttpUrl(n.infringing_url, {
                    allowRelative: true,
                    prependHttpsIfMissingScheme: true,
                  })}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--color-accent-purple)" }}
                >
                  {n.infringing_url}
                </a>
              ) : (
                <span>{n.infringing_url}</span>
              )}
            </Box>

            <Box fontSize="13px" color="var(--color-text-muted)">
              <strong>Work Description:</strong> {n.work_description}
            </Box>

            {n.action_taken && (
              <Box fontSize="13px" color={n.status === "rejected" ? "var(--color-text-muted)" : "var(--ms-success)"}>
                <strong>Action Taken:</strong> {n.action_taken}
              </Box>
            )}

            {n.status === "pending" && (
              <Box mt={2} display="flex" gap={2}>
                <ActionButton
                  $variant="primary"
                  onClick={() => {
                    setActiveDmcaToResolve(n);
                    setDmcaResolutionStatus("resolved");
                    setQuarantineResource(true);
                    setDmcaActionTaken("Takedown executed per statutory requirements.");
                  }}
                >
                  Resolve Notice...
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  onClick={() => {
                    setActiveDmcaToResolve(n);
                    setDmcaResolutionStatus("rejected");
                    setQuarantineResource(false);
                    setDmcaActionTaken(
                      "Rejected: Notice lacks required statutory elements under 17 U.S.C. § 512(c)(3).",
                    );
                  }}
                >
                  Reject Notice...
                </ActionButton>
              </Box>
            )}
          </Card>
        ))
      )}

      {/* ── DMCA RESOLUTION MODAL ── */}
      {activeDmcaToResolve && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>Resolve DMCA Notice #{activeDmcaToResolve.id}</span>
            <Box fontSize="13px" color="var(--color-text-muted)">
              Infringing URL: {activeDmcaToResolve.infringing_url}
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Disposition</label>
              <Select
                value={dmcaResolutionStatus}
                onChange={(e) => setDmcaResolutionStatus(e.target.value as "resolved" | "rejected")}
              >
                <option value="resolved">Resolved (Execute Takedown)</option>
                <option value="rejected">Rejected (Invalid / Incomplete Notice)</option>
              </Select>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Statutory Templates</label>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {DMCA_TEMPLATES.map((tpl) => (
                  <FilterPill
                    key={tpl.label}
                    type="button"
                    $active={dmcaActionTaken === tpl.text}
                    onClick={() => {
                      setDmcaResolutionStatus(tpl.status);
                      setDmcaActionTaken(tpl.text);
                    }}
                  >
                    {tpl.label}
                  </FilterPill>
                ))}
              </Box>
            </Box>

            <Box display="flex" flexDirection="column" gap={1}>
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Action Taken Record</label>
              <Textarea
                placeholder="Document the action taken pursuant to DMCA notice..."
                value={dmcaActionTaken}
                onChange={(e) => setDmcaActionTaken(e.target.value)}
                required
              />
            </Box>

            {dmcaResolutionStatus === "resolved" && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={quarantineResource}
                  onChange={(e) => setQuarantineResource(e.target.checked)}
                />
                Automatically remove matching local Post URL if referenced in Infringing URL
              </label>
            )}

            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setActiveDmcaToResolve(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="primary"
                onClick={handleConfirmResolve}
                disabled={loading || !dmcaActionTaken.trim()}
              >
                Confirm Resolution
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};
