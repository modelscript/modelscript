// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlusIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, FilterPill, Input, Select, StatGrid, Table } from "../styles";
import type { AdminFederationDeliveryItem, AdminFederationDomain, AdminFederationQueueStats } from "../types";

export interface AdminFederationTabProps {
  domains: AdminFederationDomain[];
  onSaveDomainTier: (domain: string, tier: "allow" | "silence" | "suspend", reason?: string) => Promise<void>;
  onDeleteDomainRule: (domain: string) => Promise<void>;
  queueStats?: AdminFederationQueueStats | null | undefined;
  deliveries?: AdminFederationDeliveryItem[] | undefined;
  deliveryStatusFilter?: string | undefined;
  setDeliveryStatusFilter?: ((status: string) => void) | undefined;
  onRetryFailedDeliveries?: ((domain?: string) => Promise<void>) | undefined;
  onPurgeDeliveries?: ((status: "failed" | "completed") => Promise<void>) | undefined;
  loading: boolean;
}

export const AdminFederationTab: React.FC<AdminFederationTabProps> = ({
  domains,
  onSaveDomainTier,
  onDeleteDomainRule,
  queueStats,
  deliveries = [],
  deliveryStatusFilter = "all",
  setDeliveryStatusFilter,
  onRetryFailedDeliveries,
  onPurgeDeliveries,
  loading,
}) => {
  const [newDomain, setNewDomain] = useState("");
  const [newDomainTier, setNewDomainTier] = useState<"allow" | "silence" | "suspend">("silence");
  const [newDomainReason, setNewDomainReason] = useState("");
  const [domainFilterQuery, setDomainFilterQuery] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;
    await onSaveDomainTier(newDomain.trim(), newDomainTier, newDomainReason.trim() || undefined);
    setNewDomain("");
    setNewDomainReason("");
  };

  const filteredDomains = domains.filter((d) =>
    domainFilterQuery.trim() ? d.domain.toLowerCase().includes(domainFilterQuery.toLowerCase().trim()) : true,
  );

  return (
    <div>
      {queueStats && (
        <StatGrid>
          <Card>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Pending S2S Deliveries</span>
            <span style={{ fontSize: "22px", fontWeight: 800 }}>{queueStats.pending}</span>
          </Card>
          <Card>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>In-Flight Processing</span>
            <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--color-accent-cyan)" }}>
              {queueStats.processing}
            </span>
          </Card>
          <Card>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Completed Deliveries</span>
            <span style={{ fontSize: "22px", fontWeight: 800, color: "var(--ms-success)" }}>
              {queueStats.completed}
            </span>
          </Card>
          <Card>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Dead-Letter / Failed</span>
            <span
              style={{
                fontSize: "22px",
                fontWeight: 800,
                color: queueStats.failed > 0 ? "var(--ms-danger)" : "var(--color-text-primary)",
              }}
            >
              {queueStats.failed}
            </span>
          </Card>
        </StatGrid>
      )}

      <Card>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>Configure Federation Domain Rule</span>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}
        >
          <Box display="flex" gap={2}>
            <Input
              style={{ flex: 2 }}
              placeholder="e.g. spam-node.world"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              required
            />
            <Select
              style={{ flex: 1 }}
              value={newDomainTier}
              onChange={(e) => setNewDomainTier(e.target.value as "allow" | "silence" | "suspend")}
            >
              <option value="allow">allow (Default)</option>
              <option value="silence">silence (Hide from public timelines)</option>
              <option value="suspend">suspend (Block all S2S traffic)</option>
            </Select>
          </Box>
          <Input
            placeholder="Justification reason (optional, logged in audit trail)"
            value={newDomainReason}
            onChange={(e) => setNewDomainReason(e.target.value)}
          />
          <Box display="flex" justifyContent="flex-end">
            <ActionButton $variant="primary" type="submit" disabled={loading}>
              <PlusIcon size={14} />
              <span>Save Domain Tier</span>
            </ActionButton>
          </Box>
        </form>
      </Card>

      <Box display="flex" alignItems="center" gap={2} mb={3}>
        <Input
          style={{ width: "100%", maxWidth: "350px" }}
          placeholder="Filter configured domains..."
          value={domainFilterQuery}
          onChange={(e) => setDomainFilterQuery(e.target.value)}
        />
      </Box>

      <Table>
        <thead>
          <tr>
            <th>Domain</th>
            <th>Tier</th>
            <th>Reason</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filteredDomains.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "24px" }}>
                No domain tier overrides found. All domains follow default allow policies.
              </td>
            </tr>
          ) : (
            filteredDomains.map((d) => (
              <tr key={d.domain}>
                <td>
                  <strong>{d.domain}</strong>
                </td>
                <td>
                  <Badge $variant={d.tier === "allow" ? "success" : d.tier === "silence" ? "warning" : "danger"}>
                    {d.tier}
                  </Badge>
                </td>
                <td style={{ color: "var(--color-text-muted)" }}>{d.reason || "—"}</td>
                <td>
                  <ActionButton $variant="danger" onClick={() => onDeleteDomainRule(d.domain)} disabled={loading}>
                    <TrashIcon size={13} />
                    <span>Reset</span>
                  </ActionButton>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {/* ── S2S DELIVERY QUEUE & DEAD-LETTER INSPECTOR ── */}
      {(queueStats || deliveries.length > 0 || onRetryFailedDeliveries) && (
        <Box mt={4}>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              ActivityPub S2S Delivery Queue &amp; Dead-Letter Inspector
            </span>
            <Box display="flex" gap={2} flexWrap="wrap">
              {onRetryFailedDeliveries && (
                <ActionButton
                  $variant="secondary"
                  disabled={loading || (queueStats ? queueStats.failed === 0 : false)}
                  onClick={() => void onRetryFailedDeliveries()}
                >
                  <SyncIcon size={13} />
                  <span>Retry Failed Deliveries</span>
                </ActionButton>
              )}
              {onPurgeDeliveries && (
                <ActionButton
                  $variant="danger"
                  disabled={loading || (queueStats ? queueStats.failed === 0 : false)}
                  onClick={() => void onPurgeDeliveries("failed")}
                >
                  <TrashIcon size={13} />
                  <span>Purge Dead-Letter Queue</span>
                </ActionButton>
              )}
            </Box>
          </Box>

          {setDeliveryStatusFilter && (
            <Box display="flex" gap={2} mb={2}>
              {(["all", "pending", "failed", "completed"] as const).map((st) => (
                <FilterPill key={st} $active={deliveryStatusFilter === st} onClick={() => setDeliveryStatusFilter(st)}>
                  {st === "all" ? "All Deliveries" : st.charAt(0).toUpperCase() + st.slice(1)}
                </FilterPill>
              ))}
            </Box>
          )}

          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Target Inbox</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last Error</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "20px" }}>
                    No S2S delivery records in this state.
                  </td>
                </tr>
              ) : (
                deliveries.map((item) => (
                  <tr key={item.id}>
                    <td>#{item.id}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
                      {item.target_inbox_url}
                    </td>
                    <td>
                      <Badge
                        $variant={
                          item.status === "completed" ? "success" : item.status === "failed" ? "danger" : "warning"
                        }
                      >
                        {item.status}
                      </Badge>
                    </td>
                    <td>
                      {item.attempts}/{item.max_attempts}
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--ms-danger)", maxWidth: "260px" }}>
                      {item.last_error || "—"}
                    </td>
                    <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                      {new Date(item.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </Box>
      )}
    </div>
  );
};
