// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DownloadIcon,
  GlobeIcon,
  PlusIcon,
  ShieldXIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import { circuitBreakAdminFederationDomain } from "../../../api";
import Box from "../../../components/Box";
import {
  ActionButton,
  Badge,
  Card,
  FilterPill,
  Input,
  ModalBox,
  ModalOverlay,
  Select,
  StatGrid,
  Table,
  Textarea,
} from "../styles";
import type { AdminFederationDeliveryItem, AdminFederationDomain, AdminFederationQueueStats } from "../types";

export interface AdminFederationTabProps {
  domains: AdminFederationDomain[];
  onSaveDomainTier: (domain: string, tier: "allow" | "silence" | "suspend", reason?: string) => Promise<void>;
  onDeleteDomainRule: (domain: string) => Promise<void>;
  onExportDomains?: ((format: "csv" | "json") => Promise<string>) | undefined;
  onImportDomains?:
    | ((payload: { content: string; format: "csv" | "json"; mode: "merge" | "replace" }) => Promise<void>)
    | undefined;
  onTestDomain?:
    | ((domain: string) => Promise<{
        domain: string;
        validSyntax: boolean;
        currentTier: string;
        reason: string | null;
        federationMode: string;
        exportControlStatus: string;
        allowedByPolicy: boolean;
        nodeInfoUrl: string;
        actorInboxUrl: string;
        ready: boolean;
      }>)
    | undefined;
  queueStats?: AdminFederationQueueStats | null | undefined;
  deliveries?: AdminFederationDeliveryItem[] | undefined;
  deliveryStatusFilter?: string | undefined;
  setDeliveryStatusFilter?: ((status: string) => void) | undefined;
  deliveryDomainFilter?: string | undefined;
  setDeliveryDomainFilter?: ((domain: string) => void) | undefined;
  onRetryFailedDeliveries?: ((domain?: string) => Promise<void>) | undefined;
  onPurgeDeliveries?: ((status: "failed" | "completed") => Promise<void>) | undefined;
  loading: boolean;
}

export const AdminFederationTab: React.FC<AdminFederationTabProps> = ({
  domains,
  onSaveDomainTier,
  onDeleteDomainRule,
  onExportDomains,
  onImportDomains,
  onTestDomain,
  queueStats,
  deliveries = [],
  deliveryStatusFilter = "all",
  setDeliveryStatusFilter,
  deliveryDomainFilter = "",
  setDeliveryDomainFilter,
  onRetryFailedDeliveries,
  onPurgeDeliveries,
  loading,
}) => {
  const [newDomain, setNewDomain] = useState("");
  const [newDomainTier, setNewDomainTier] = useState<"allow" | "silence" | "suspend">("silence");
  const [newDomainReason, setNewDomainReason] = useState("");
  const [domainFilterQuery, setDomainFilterQuery] = useState("");

  const [showImportModal, setShowImportModal] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "json">("csv");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");

  const [testDomainInput, setTestDomainInput] = useState("");
  const [testDomainResult, setTestDomainResult] = useState<{
    domain: string;
    validSyntax: boolean;
    currentTier: string;
    reason: string | null;
    federationMode: string;
    exportControlStatus: string;
    allowedByPolicy: boolean;
    nodeInfoUrl: string;
    actorInboxUrl: string;
    ready: boolean;
  } | null>(null);

  const [expandedDeliveryId, setExpandedDeliveryId] = useState<number | null>(null);
  const [circuitBreakStatus, setCircuitBreakStatus] = useState<string | null>(null);

  const handleCircuitBreakDomain = async (domain: string) => {
    if (!domain) return;
    try {
      const res = await circuitBreakAdminFederationDomain({
        domain,
        tier: "suspend",
        reason: "Circuit breaker tripped due to dead-letter delivery failures",
      });
      setCircuitBreakStatus(
        `Circuit breaker tripped for ${res.domain} (${res.tier}; purged ${res.purgedDeliveries} queued/failed deliveries).`,
      );
    } catch {
      setCircuitBreakStatus(`Failed to trip circuit breaker for ${domain}.`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;
    await onSaveDomainTier(newDomain.trim(), newDomainTier, newDomainReason.trim() || undefined);
    setNewDomain("");
    setNewDomainReason("");
  };

  const handleExport = async (format: "csv" | "json") => {
    if (!onExportDomains) return;
    const content = await onExportDomains(format);
    if (typeof window !== "undefined") {
      const blob = new Blob([content], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modelscript-federation-domains.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleConfirmImport = async () => {
    if (!onImportDomains || !importContent.trim()) return;
    await onImportDomains({
      content: importContent.trim(),
      format: importFormat,
      mode: importMode,
    });
    setShowImportModal(false);
    setImportContent("");
  };

  const handleRunDomainTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onTestDomain || !testDomainInput.trim()) return;
    const res = await onTestDomain(testDomainInput.trim());
    setTestDomainResult(res);
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
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <span style={{ fontWeight: 700, fontSize: "14px" }}>Configure Federation Domain Rule</span>
          <Box display="flex" gap={1} flexWrap="wrap">
            {onExportDomains && (
              <>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => void handleExport("csv")}
                  disabled={loading}
                >
                  <DownloadIcon size={13} />
                  <span>Export CSV Blocklist</span>
                </ActionButton>
                <ActionButton
                  $variant="secondary"
                  type="button"
                  onClick={() => void handleExport("json")}
                  disabled={loading}
                >
                  <DownloadIcon size={13} />
                  <span>Export JSON</span>
                </ActionButton>
              </>
            )}
            {onImportDomains && (
              <ActionButton
                $variant="secondary"
                type="button"
                onClick={() => setShowImportModal(true)}
                disabled={loading}
              >
                <UploadIcon size={13} />
                <span>Import Blocklist...</span>
              </ActionButton>
            )}
          </Box>
        </Box>
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

      {onTestDomain && (
        <Card>
          <span style={{ fontWeight: 700, fontSize: "14px" }}>Remote Peer Policy &amp; Handshake Tester</span>
          <form
            onSubmit={handleRunDomainTest}
            style={{ display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}
          >
            <Input
              style={{ flex: 1, minWidth: "240px" }}
              placeholder="Test peer hostname (e.g. hub.partner-aero.org)..."
              value={testDomainInput}
              onChange={(e) => setTestDomainInput(e.target.value)}
            />
            <ActionButton $variant="secondary" type="submit" disabled={loading || !testDomainInput.trim()}>
              <GlobeIcon size={13} />
              <span>Diagnose Peer</span>
            </ActionButton>
          </form>
          {testDomainResult && (
            <Box mt={2} display="flex" flexWrap="wrap" gap={2} alignItems="center" fontSize="12px">
              <Badge $variant={testDomainResult.ready ? "success" : "danger"}>
                {testDomainResult.ready ? "READY FOR S2S" : "BLOCKED BY POLICY"}
              </Badge>
              <span>
                <strong>Domain:</strong> {testDomainResult.domain}
              </span>
              <span>
                <strong>Local Tier:</strong> {testDomainResult.currentTier}
              </span>
              <span>
                <strong>Topology Mode:</strong> {testDomainResult.federationMode}
              </span>
              <span>
                <strong>Export Control:</strong> {testDomainResult.exportControlStatus}
              </span>
            </Box>
          )}
        </Card>
      )}

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
                  onClick={() => void onRetryFailedDeliveries(deliveryDomainFilter.trim() || undefined)}
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

          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={2}>
            {setDeliveryStatusFilter && (
              <Box display="flex" gap={2}>
                {(["all", "pending", "failed", "completed"] as const).map((st) => (
                  <FilterPill
                    key={st}
                    $active={deliveryStatusFilter === st}
                    onClick={() => setDeliveryStatusFilter(st)}
                  >
                    {st === "all" ? "All Deliveries" : st.charAt(0).toUpperCase() + st.slice(1)}
                  </FilterPill>
                ))}
              </Box>
            )}
            {setDeliveryDomainFilter && (
              <Input
                style={{ width: "260px" }}
                placeholder="Filter queue by target domain..."
                value={deliveryDomainFilter}
                onChange={(e) => setDeliveryDomainFilter(e.target.value)}
              />
            )}
          </Box>

          {circuitBreakStatus && (
            <Box mb={2} style={{ fontSize: "12px", color: "var(--ms-text-2, var(--color-text-muted))" }}>
              {circuitBreakStatus}
            </Box>
          )}

          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Activity</th>
                <th>Target Inbox</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last Error</th>
                <th>Payload</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "20px" }}>
                    No S2S delivery records in this state.
                  </td>
                </tr>
              ) : (
                deliveries.map((item) => (
                  <React.Fragment key={item.id}>
                    <tr>
                      <td>#{item.id}</td>
                      <td>
                        <Badge $variant="neutral">{item.activity_type}</Badge>
                      </td>
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
                      <td style={{ fontSize: "12px", color: "var(--ms-danger)", maxWidth: "240px" }}>
                        {item.last_error || "—"}
                      </td>
                      <td>
                        <Box display="flex" gap={1} flexWrap="wrap">
                          {item.payload ? (
                            <ActionButton
                              $variant="secondary"
                              type="button"
                              onClick={() => setExpandedDeliveryId(expandedDeliveryId === item.id ? null : item.id)}
                            >
                              {expandedDeliveryId === item.id ? "Hide JSON" : "Inspect"}
                            </ActionButton>
                          ) : (
                            "—"
                          )}
                          {item.status === "failed" && item.target_domain && (
                            <ActionButton
                              $variant="danger"
                              type="button"
                              onClick={() => void handleCircuitBreakDomain(item.target_domain)}
                              title={`Suspend ${item.target_domain} and purge dead-letter queue`}
                            >
                              <ShieldXIcon size={12} />
                              <span>Circuit-Break Peer</span>
                            </ActionButton>
                          )}
                        </Box>
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                        {new Date(item.updated_at).toLocaleString()}
                      </td>
                    </tr>
                    {expandedDeliveryId === item.id && item.payload && (
                      <tr>
                        <td colSpan={8}>
                          <pre
                            style={{
                              margin: 0,
                              padding: "10px",
                              background: "var(--color-bg-primary)",
                              borderRadius: "6px",
                              fontSize: "11px",
                              overflowX: "auto",
                            }}
                          >
                            {(() => {
                              try {
                                return JSON.stringify(JSON.parse(item.payload), null, 2);
                              } catch {
                                return item.payload;
                              }
                            })()}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </Table>
        </Box>
      )}

      {showImportModal && (
        <ModalOverlay>
          <ModalBox>
            <span style={{ fontWeight: 800, fontSize: "16px" }}>
              Import Federation Blocklist / Allowlist (CSV or JSON)
            </span>
            <Box display="flex" gap={2}>
              <Select
                style={{ flex: 1 }}
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as "csv" | "json")}
              >
                <option value="csv">CSV Format (#domain,#severity,#public_comment)</option>
                <option value="json">JSON Array Format</option>
              </Select>
              <Select
                style={{ flex: 1 }}
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as "merge" | "replace")}
              >
                <option value="merge">Merge with existing domain rules</option>
                <option value="replace">Replace all existing domain rules</option>
              </Select>
            </Box>
            <Textarea
              style={{ minHeight: "140px", fontFamily: "monospace", fontSize: "12px" }}
              placeholder={
                importFormat === "csv"
                  ? '#domain,#severity,#public_comment\nspam.example.org,suspend,"Automated spam"'
                  : '[{"domain":"peer.example.org","tier":"allow","reason":"Trusted research partner"}]'
              }
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
            />
            <Box display="flex" justifyContent="flex-end" gap={2}>
              <ActionButton $variant="secondary" onClick={() => setShowImportModal(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="primary"
                onClick={handleConfirmImport}
                disabled={loading || !importContent.trim()}
              >
                Import Domain Rules
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};
