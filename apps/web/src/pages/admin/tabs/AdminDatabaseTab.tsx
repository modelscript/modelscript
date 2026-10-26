// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleIcon, DatabaseIcon } from "@primer/octicons-react";
import React from "react";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, StatGrid, Table } from "../styles";
import type { AdminDbStatus } from "../types";

export interface AdminDatabaseTabProps {
  dbStatus: AdminDbStatus | null;
  dbVerifyResult: {
    valid?: boolean | undefined;
    foreignKeysOk?: boolean | undefined;
    integrityOk?: boolean | undefined;
    issues?: string[] | undefined;
  } | null;
  dbUpgradeResult: unknown | null;
  dbDryRun: boolean;
  setDbDryRun: (dryRun: boolean) => void;
  onVerifyDb: () => Promise<void>;
  onUpgradeDb: () => Promise<void>;
  loading: boolean;
}

export const AdminDatabaseTab: React.FC<AdminDatabaseTabProps> = ({
  dbStatus,
  dbVerifyResult,
  dbUpgradeResult,
  dbDryRun,
  setDbDryRun,
  onVerifyDb,
  onUpgradeDb,
  loading,
}) => {
  const appliedList = dbStatus?.applied || dbStatus?.appliedMigrations || [];
  const pendingList = dbStatus?.pending || dbStatus?.pendingMigrations || [];
  const currentVer = dbStatus?.currentVersion
    ? String(dbStatus.currentVersion)
    : appliedList.length > 0
      ? appliedList[appliedList.length - 1]!.name
      : "Baseline";
  const latestVer = pendingList.length > 0 ? pendingList[pendingList.length - 1]!.name : currentVer;
  const pendingCount = dbStatus?.pendingCount ?? pendingList.length;

  return (
    <div>
      <StatGrid>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Current Schema Version</span>
          <span style={{ fontSize: "18px", fontWeight: 800, wordBreak: "break-all" }}>{currentVer}</span>
        </Card>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Latest Available Version</span>
          <span style={{ fontSize: "18px", fontWeight: 800, wordBreak: "break-all" }}>{latestVer}</span>
        </Card>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Pending Migrations</span>
          <span
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: pendingCount > 0 ? "#d29922" : "#3fb950",
            }}
          >
            {pendingCount}
          </span>
        </Card>
      </StatGrid>

      <Card>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>Maintenance Operations</span>
        <Box display="flex" alignItems="center" gap={3} mt={2} flexWrap="wrap">
          <ActionButton $variant="secondary" onClick={onVerifyDb} disabled={loading}>
            <CheckCircleIcon size={14} />
            <span>Verify Schema Integrity</span>
          </ActionButton>

          <Box display="flex" alignItems="center" gap={2}>
            <label
              style={{
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
              }}
            >
              <input type="checkbox" checked={dbDryRun} onChange={(e) => setDbDryRun(e.target.checked)} />
              Dry-Run Mode
            </label>
            <ActionButton $variant="primary" onClick={onUpgradeDb} disabled={loading}>
              <DatabaseIcon size={14} />
              <span>{dbDryRun ? "Simulate Upgrade" : "Apply Pending Migrations"}</span>
            </ActionButton>
          </Box>
        </Box>
      </Card>

      {dbVerifyResult &&
        (() => {
          const isSound = dbVerifyResult.valid ?? (dbVerifyResult.foreignKeysOk && dbVerifyResult.integrityOk);
          return (
            <Card>
              <span style={{ fontWeight: 700, fontSize: "14px" }}>Integrity Verification Report</span>
              <Box display="flex" alignItems="center" gap={2} mt={1}>
                <Badge $variant={isSound ? "success" : "danger"}>{isSound ? "VALID" : "INVALID"}</Badge>
                <span style={{ fontSize: "13px" }}>
                  {isSound
                    ? "Foreign keys, indexes, and database tables are in compliance with schema definitions."
                    : "One or more integrity violations detected."}
                </span>
              </Box>
              {dbVerifyResult.issues && dbVerifyResult.issues.length > 0 && (
                <Box mt={2}>
                  <ul style={{ paddingLeft: "20px", fontSize: "13px", color: "#f85149" }}>
                    {dbVerifyResult.issues.map((iss, i) => (
                      <li key={i}>{iss}</li>
                    ))}
                  </ul>
                </Box>
              )}
            </Card>
          );
        })()}

      {dbUpgradeResult != null && (
        <Card>
          <span style={{ fontWeight: 700, fontSize: "14px" }}>Migration Execution Summary</span>
          <pre
            style={{
              background: "var(--color-bg-primary)",
              padding: "12px",
              borderRadius: "6px",
              fontSize: "12px",
              overflowX: "auto",
            }}
          >
            {JSON.stringify(dbUpgradeResult, null, 2)}
          </pre>
        </Card>
      )}

      {appliedList.length > 0 && (
        <div>
          <Box fontWeight={700} fontSize="14px" mb={2} mt={3}>
            Applied Migrations ({appliedList.length})
          </Box>
          <Table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Migration Name</th>
                <th>Applied At</th>
              </tr>
            </thead>
            <tbody>
              {appliedList.map((m, idx) => (
                <tr key={m.id || idx}>
                  <td>#{m.id || idx + 1}</td>
                  <td>
                    <strong>{m.name}</strong>
                  </td>
                  <td style={{ color: "var(--color-text-muted)" }}>
                    {m.applied_at ? new Date(m.applied_at).toLocaleString() : "Baseline"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  );
};
