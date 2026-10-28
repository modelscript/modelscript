// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import Box from "../../../components/Box";
import { sanitizeHttpUrl } from "../../../util/url";
import { ActionButton, Badge, Card, FilterPill, ModalBox, ModalOverlay, Textarea } from "../styles";
import type { AdminDmcaNotice } from "../types";

export interface AdminDmcaTabProps {
  dmcaNotices: AdminDmcaNotice[];
  dmcaFilter: string;
  setDmcaFilter: (filter: string) => void;
  onResolveDmca: (noticeId: number, actionTaken: string) => Promise<void>;
  loading: boolean;
}

export const AdminDmcaTab: React.FC<AdminDmcaTabProps> = ({
  dmcaNotices,
  dmcaFilter,
  setDmcaFilter,
  onResolveDmca,
  loading,
}) => {
  const [activeDmcaToResolve, setActiveDmcaToResolve] = useState<AdminDmcaNotice | null>(null);
  const [dmcaActionTaken, setDmcaActionTaken] = useState("");

  const handleConfirmResolve = async () => {
    if (!activeDmcaToResolve || !dmcaActionTaken.trim()) return;
    await onResolveDmca(activeDmcaToResolve.id, dmcaActionTaken.trim());
    setActiveDmcaToResolve(null);
    setDmcaActionTaken("");
  };

  return (
    <div>
      <Box display="flex" gap={2} mb={3}>
        <FilterPill $active={dmcaFilter === "all"} onClick={() => setDmcaFilter("all")}>
          All Notices
        </FilterPill>
        <FilterPill $active={dmcaFilter === "pending"} onClick={() => setDmcaFilter("pending")}>
          Pending
        </FilterPill>
        <FilterPill $active={dmcaFilter === "resolved"} onClick={() => setDmcaFilter("resolved")}>
          Resolved
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
                <Badge $variant={n.status === "resolved" ? "success" : "warning"}>{n.status}</Badge>
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
              <Box fontSize="13px" color="var(--ms-success)">
                <strong>Action Taken:</strong> {n.action_taken}
              </Box>
            )}

            {n.status === "pending" && (
              <Box mt={2}>
                <ActionButton
                  $variant="primary"
                  onClick={() => {
                    setActiveDmcaToResolve(n);
                    setDmcaActionTaken("Takedown executed per statutory requirements.");
                  }}
                >
                  Resolve Notice...
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
              <label style={{ fontSize: "12px", fontWeight: 600 }}>Action Taken Record</label>
              <Textarea
                placeholder="Document the action taken pursuant to DMCA notice..."
                value={dmcaActionTaken}
                onChange={(e) => setDmcaActionTaken(e.target.value)}
                required
              />
            </Box>

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
