// SPDX-License-Identifier: AGPL-3.0-or-later

import { PlusIcon, TrashIcon } from "@primer/octicons-react";
import React, { useState } from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, Input, Select, Table } from "../styles";
import type { AdminFederationDomain } from "../types";

export interface AdminFederationTabProps {
  domains: AdminFederationDomain[];
  onSaveDomainTier: (domain: string, tier: "allow" | "silence" | "suspend", reason?: string) => Promise<void>;
  onDeleteDomainRule: (domain: string) => Promise<void>;
  loading: boolean;
}

export const AdminFederationTab: React.FC<AdminFederationTabProps> = ({
  domains,
  onSaveDomainTier,
  onDeleteDomainRule,
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
    </div>
  );
};
