// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArchiveIcon,
  CheckCircleIcon,
  DatabaseIcon,
  DownloadIcon,
  HistoryIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import React, { useState } from "react";
import {
  type AdminInstanceBundle,
  broadcastAdminActivityPubMove,
  exportAdminInstanceBundle,
  getAdminBackupDownloadUrl,
  importAdminInstanceBundle,
  uploadAdminBackup,
} from "../../../api";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, Input, ModalBox, ModalOverlay, StatGrid, Table } from "../styles";
import type { AdminBackupInfo, AdminDbStatus } from "../types";

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
  backups?: AdminBackupInfo[] | undefined;
  onCreateHotBackup?: ((label?: string) => Promise<void>) | undefined;
  onRestoreBackup?: ((fileName: string) => Promise<void>) | undefined;
  onDeleteBackup?: ((fileName: string) => Promise<void>) | undefined;
  onPruneBackups?: ((keepCount?: number) => Promise<void>) | undefined;
  onRefresh?: (() => Promise<void> | void) | undefined;
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
  backups = [],
  onCreateHotBackup,
  onRestoreBackup,
  onDeleteBackup,
  onPruneBackups,
  onRefresh,
  loading,
}) => {
  const [backupLabel, setBackupLabel] = useState("");
  const [keepCount, setKeepCount] = useState(7);
  const [confirmPruneOpen, setConfirmPruneOpen] = useState(false);
  const [confirmDeleteBackupFile, setConfirmDeleteBackupFile] = useState<string | null>(null);
  const [exportedBundle, setExportedBundle] = useState<AdminInstanceBundle | null>(null);
  const [bundleStatusMsg, setBundleStatusMsg] = useState<string | null>(null);
  const [sourceActorUri, setSourceActorUri] = useState("");
  const [targetActorUri, setTargetActorUri] = useState("");
  const [moveResultMsg, setMoveResultMsg] = useState<string | null>(null);
  const [uploadRestoreImmediately, setUploadRestoreImmediately] = useState(false);
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);

  const appliedList = dbStatus?.applied || dbStatus?.appliedMigrations || [];
  const pendingList = dbStatus?.pending || dbStatus?.pendingMigrations || [];
  const currentVer = dbStatus?.currentVersion
    ? String(dbStatus.currentVersion)
    : appliedList.length > 0
      ? appliedList[appliedList.length - 1]!.name
      : "Baseline";
  const latestVer = pendingList.length > 0 ? pendingList[pendingList.length - 1]!.name : currentVer;
  const pendingCount = dbStatus?.pendingCount ?? pendingList.length;

  const handleCreateBackup = async () => {
    if (!onCreateHotBackup) return;
    await onCreateHotBackup(backupLabel.trim() || undefined);
    setBackupLabel("");
  };

  const handlePruneSnapshots = async () => {
    if (!onPruneBackups) return;
    setConfirmPruneOpen(false);
    await onPruneBackups(keepCount);
  };

  const handleDeleteBackup = async (fileName: string) => {
    if (!onDeleteBackup) return;
    setConfirmDeleteBackupFile(null);
    await onDeleteBackup(fileName);
  };

  const handleDownloadBackup = async (fileName: string) => {
    try {
      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("modelscript-auth-token") || localStorage.getItem("token")
          : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const resp = await fetch(getAdminBackupDownloadUrl(fileName), { headers });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setUploadStatusMsg(`Failed to download backup ${fileName}.`);
    }
  };

  const handleUploadBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resultStr = String(reader.result || "");
        const base64 = resultStr.includes(",") ? resultStr.split(",")[1]! : resultStr;
        setUploadStatusMsg("Verifying SQLite 3 header & PRAGMA integrity_check...");
        const res = await uploadAdminBackup({
          fileBase64: base64,
          label: file.name.replace(/\.(db|sqlite|sqlite3)$/i, ""),
          restoreImmediately: uploadRestoreImmediately,
        });
        const restoredInfo = res.restoreResult ?? res.restored;
        setUploadStatusMsg(
          restoredInfo
            ? `Uploaded & restored ${restoredInfo.tablesRestored} table(s) from ${res.backup.fileName}.`
            : `Uploaded verified snapshot ${res.backup.fileName} (SHA-256: ${res.backup.sha256.slice(0, 12)}…).`,
        );
        await onRefresh?.();
      } catch {
        setUploadStatusMsg("Snapshot upload failed: invalid SQLite file or integrity check error.");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExportBundle = async () => {
    try {
      setBundleStatusMsg(null);
      const bundle = await exportAdminInstanceBundle();
      setExportedBundle(bundle);
      if (typeof window !== "undefined") {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `modelscript-instance-bundle-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setBundleStatusMsg("Failed to export migration bundle.");
    }
  };

  const handleImportBundleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setBundleStatusMsg("Importing & verifying instance migration bundle...");
        const parsed = JSON.parse(String(reader.result || "{}")) as Record<string, unknown>;
        const res = await importAdminInstanceBundle(parsed);
        setBundleStatusMsg(
          `Migration bundle imported (settings updated: ${res.settingsUpdated ? "yes" : "no"}, domains: ${res.importedDomains}, flags: ${res.importedFlags}).`,
        );
        await onRefresh?.();
      } catch {
        setBundleStatusMsg("Failed to import JSON migration bundle.");
      }
    };
    reader.readAsText(file);
  };

  const handleBroadcastMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceActorUri.trim() || !targetActorUri.trim()) return;
    try {
      const res = await broadcastAdminActivityPubMove({
        sourceActorUri: sourceActorUri.trim(),
        targetActorUri: targetActorUri.trim(),
      });
      setMoveResultMsg(`Broadcast Move (${res.activityId}) to ${res.queuedDeliveries} peer inbox(es).`);
    } catch {
      setMoveResultMsg("Failed to broadcast Move activity.");
    }
  };

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
              color: pendingCount > 0 ? "#d29922" : "var(--ms-success)",
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

      {onCreateHotBackup && (
        <Card>
          <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Hot SQLite WAL Backups &amp; Point-in-Time Restore ({backups.length})
            </span>
            {onPruneBackups && backups.length > 1 && (
              <Box display="flex" alignItems="center" gap={1}>
                <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Retain latest:</span>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  style={{ width: "68px", padding: "4px 8px" }}
                  value={keepCount}
                  onChange={(e) => setKeepCount(Math.max(1, Number(e.target.value) || 7))}
                />
                <ActionButton $variant="secondary" disabled={loading} onClick={() => setConfirmPruneOpen(true)}>
                  <TrashIcon size={13} />
                  <span>Prune Old Snapshots</span>
                </ActionButton>
              </Box>
            )}
          </Box>

          <Box display="flex" alignItems="center" gap={2} mt={2} flexWrap="wrap">
            <Input
              style={{ width: "260px" }}
              placeholder="Backup label (e.g. pre-migration)..."
              value={backupLabel}
              onChange={(e) => setBackupLabel(e.target.value)}
            />
            <ActionButton $variant="primary" onClick={() => void handleCreateBackup()} disabled={loading}>
              <ArchiveIcon size={14} />
              <span>Create Hot Snapshot</span>
            </ActionButton>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-primary)",
                background: "var(--color-bg-secondary)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <UploadIcon size={14} />
              <span>Upload External .db Snapshot</span>
              <input
                type="file"
                accept=".db,.sqlite,.sqlite3"
                style={{ display: "none" }}
                onChange={handleUploadBackupFile}
              />
            </label>
            <label
              style={{
                fontSize: "12px",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                color: "var(--color-text-muted)",
              }}
            >
              <input
                type="checkbox"
                checked={uploadRestoreImmediately}
                onChange={(e) => setUploadRestoreImmediately(e.target.checked)}
              />
              Restore immediately after integrity check
            </label>
          </Box>
          {uploadStatusMsg && (
            <Box mt={1} fontSize="12px" color="var(--color-text-muted)">
              {uploadStatusMsg}
            </Box>
          )}
          {backups.length > 0 && (
            <Box mt={2}>
              <Table>
                <thead>
                  <tr>
                    <th>Snapshot File</th>
                    <th>Size</th>
                    <th>SHA-256</th>
                    <th>Created At</th>
                    <th style={{ textAlign: "right" }}>Disaster Recovery Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.fileName}>
                      <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{b.fileName}</td>
                      <td>{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                      <td
                        style={{ fontFamily: "monospace", fontSize: "11px", color: "var(--color-text-muted)" }}
                        title={b.sha256}
                      >
                        {b.sha256 ? `${b.sha256.slice(0, 12)}…` : "—"}
                      </td>
                      <td style={{ color: "var(--color-text-muted)", fontSize: "12px" }}>
                        {new Date(b.createdAt).toLocaleString()}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Box display="flex" justifyContent="flex-end" gap={1} flexWrap="wrap">
                          <ActionButton
                            type="button"
                            $variant="secondary"
                            onClick={() => void handleDownloadBackup(b.fileName)}
                          >
                            <DownloadIcon size={13} />
                            <span>Download</span>
                          </ActionButton>
                          {onRestoreBackup && (
                            <ActionButton
                              $variant="secondary"
                              disabled={loading}
                              onClick={() => void onRestoreBackup(b.fileName)}
                              title="Verify integrity, take pre-restore snapshot, and restore live DB"
                            >
                              <HistoryIcon size={13} />
                              <span>Restore</span>
                            </ActionButton>
                          )}
                          {onDeleteBackup && (
                            <ActionButton
                              $variant="danger"
                              disabled={loading}
                              onClick={() => setConfirmDeleteBackupFile(b.fileName)}
                            >
                              <TrashIcon size={13} />
                              <span>Delete</span>
                            </ActionButton>
                          )}
                        </Box>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Box>
          )}
        </Card>
      )}

      <Card>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Portable Instance Migration Bundle &amp; ActivityPub Domain Move
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              Export a signed JSON manifest + SQLite snapshot for VPS-to-VPS migration, or broadcast a W3C ActivityPub{" "}
              <code>Move</code> (<code>alsoKnownAs</code>) activity to federated peers.
            </span>
          </Box>
          <Box display="flex" gap={1} flexWrap="wrap">
            <ActionButton
              $variant="secondary"
              type="button"
              onClick={() => void handleExportBundle()}
              disabled={loading}
            >
              <DownloadIcon size={14} />
              <span>Export Migration Bundle</span>
            </ActionButton>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "7px 14px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-primary)",
                background: "var(--color-bg-secondary)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <UploadIcon size={14} />
              <span>Import JSON Bundle</span>
              <input
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={handleImportBundleFile}
              />
            </label>
          </Box>
        </Box>

        {bundleStatusMsg && (
          <Box mt={1} fontSize="12px" color="var(--color-text-muted)">
            {bundleStatusMsg}
          </Box>
        )}

        {exportedBundle && (
          <Box mt={2} fontSize="12px">
            <Badge $variant="success">Bundle Ready</Badge>{" "}
            <span>
              Snapshot: <code>{exportedBundle.snapshot.fileName}</code> • SHA-256:{" "}
              <code>{exportedBundle.bundleSha256.slice(0, 16)}…</code>
            </span>
          </Box>
        )}

        <form onSubmit={handleBroadcastMove}>
          <Box display="flex" gap={2} mt={2} flexWrap="wrap" alignItems="center">
            <Input
              style={{ flex: 1, minWidth: "200px" }}
              placeholder="Source Actor URI (https://old.example/users/alice)"
              value={sourceActorUri}
              onChange={(e) => setSourceActorUri(e.target.value)}
            />
            <Input
              style={{ flex: 1, minWidth: "200px" }}
              placeholder="Target Actor URI (https://new.example/users/alice)"
              value={targetActorUri}
              onChange={(e) => setTargetActorUri(e.target.value)}
            />
            <ActionButton
              $variant="secondary"
              type="submit"
              disabled={loading || !sourceActorUri.trim() || !targetActorUri.trim()}
            >
              Broadcast ActivityPub Move
            </ActionButton>
          </Box>
        </form>
        {moveResultMsg && (
          <Box mt={1} fontSize="12px" color="var(--color-text-muted)">
            {moveResultMsg}
          </Box>
        )}
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
                  <ul style={{ paddingLeft: "20px", fontSize: "13px", color: "var(--ms-danger)" }}>
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

      {confirmPruneOpen && (
        <ModalOverlay onClick={() => setConfirmPruneOpen(false)}>
          <ModalBox
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Prune Old Snapshots"
          >
            <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-text-primary)" }}>
              Confirm Prune Old Snapshots
            </span>
            <Box fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.5 }}>
              Are you sure you want to permanently delete older SQLite WAL snapshots and retain only the latest{" "}
              <strong>{keepCount}</strong> snapshot(s)?
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setConfirmPruneOpen(false)} disabled={loading}>
                Cancel
              </ActionButton>
              <ActionButton $variant="danger" onClick={() => void handlePruneSnapshots()} disabled={loading}>
                Confirm Prune
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}

      {confirmDeleteBackupFile && (
        <ModalOverlay onClick={() => setConfirmDeleteBackupFile(null)}>
          <ModalBox
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm Delete Snapshot"
          >
            <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-text-primary)" }}>
              Delete Backup Snapshot
            </span>
            <Box fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.5 }}>
              Are you sure you want to permanently delete backup snapshot <code>{confirmDeleteBackupFile}</code>? This
              action cannot be undone.
            </Box>
            <Box display="flex" justifyContent="flex-end" gap={2} mt={2}>
              <ActionButton $variant="secondary" onClick={() => setConfirmDeleteBackupFile(null)} disabled={loading}>
                Cancel
              </ActionButton>
              <ActionButton
                $variant="danger"
                onClick={() => void handleDeleteBackup(confirmDeleteBackupFile)}
                disabled={loading}
              >
                Confirm Delete
              </ActionButton>
            </Box>
          </ModalBox>
        </ModalOverlay>
      )}
    </div>
  );
};
