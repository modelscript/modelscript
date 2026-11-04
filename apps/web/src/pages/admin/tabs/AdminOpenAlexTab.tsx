// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  FilterIcon,
  LinkExternalIcon,
  SyncIcon,
  TrashIcon,
  ZapIcon,
} from "@primer/octicons-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchOpenAlexS3SyncStatus,
  loadOpenAlexS3Partitions,
  optimizeOpenAlexFts5,
  preloadOpenAlexFirstSlice,
  syncOpenAlexS3Manifest,
  unloadOpenAlexS3Partitions,
  type OpenAlexS3PartitionDto,
  type OpenAlexS3SyncStatusDto,
} from "../../../api/references";
import Box from "../../../components/Box";
import { ActionButton, Badge, Card, Input, Select, StatCard, StatGrid, Table } from "../styles";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function getErrorMessage(err: unknown, fallback: string): string {
  const errObj = err as { response?: { data?: { error?: string } }; message?: string } | null | undefined;
  return errObj?.response?.data?.error || errObj?.message || fallback;
}

export const AdminOpenAlexTab: React.FC = () => {
  const [status, setStatus] = useState<OpenAlexS3SyncStatusDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Partition table filters & selection
  const [statusFilter, setStatusFilter] = useState<"all" | "loaded" | "unloaded">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());

  // Ingestion filter configuration
  const [minCitedByCount, setMinCitedByCount] = useState<number>(0);
  const [fromYear, setFromYear] = useState<string>("");
  const [toYear, setToYear] = useState<string>("");
  const [oaOnly, setOaOnly] = useState<boolean>(false);
  const [conceptKeywords, setConceptKeywords] = useState<string>("");
  const [maxRecords, setMaxRecords] = useState<number>(2500);
  const [customS3Url, setCustomS3Url] = useState<string>("");
  const [copiedCli, setCopiedCli] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchOpenAlexS3SyncStatus();
      setStatus(data);
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to load OpenAlex S3 database status."),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const partitions = useMemo(() => status?.partitions || [], [status]);

  const filteredPartitions = useMemo(() => {
    return partitions.filter((p) => {
      if (statusFilter === "loaded" && p.status !== "loaded") return false;
      if (statusFilter === "unloaded" && p.status === "loaded") return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${p.s3Url} ${p.updatedDate || ""} ${p.partName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [partitions, statusFilter, searchQuery]);

  const buildFilterPayload = () => {
    const kws = conceptKeywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      minCitedByCount: minCitedByCount > 0 ? minCitedByCount : undefined,
      fromYear: fromYear.trim() ? Number(fromYear.trim()) : undefined,
      toYear: toYear.trim() ? Number(toYear.trim()) : undefined,
      oaOnly: oaOnly ? true : undefined,
      conceptKeywords: kws.length > 0 ? kws : undefined,
      maxRecords: maxRecords > 0 ? maxRecords : 2500,
    };
  };

  const handleSyncManifest = async () => {
    setBusyAction("sync-manifest");
    setBanner(null);
    try {
      const res = await syncOpenAlexS3Manifest({ entity: "works", limit: 120 });
      await refreshStatus();
      setBanner({
        type: "success",
        text: `Discovered ${res.syncedCount} S3 partition(s) from s3://openalex/data/works/manifest (${res.manifestSource}). All newly discovered partitions default to 'unloaded'.`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to sync OpenAlex S3 manifest."),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadPartitions = async (urlsToLoad: string[]) => {
    if (urlsToLoad.length === 0) return;
    setBusyAction(`load-${urlsToLoad.length === 1 ? urlsToLoad[0] : "batch"}`);
    setBanner(null);
    try {
      const res = await loadOpenAlexS3Partitions({
        s3Urls: urlsToLoad,
        ...buildFilterPayload(),
      });
      await refreshStatus();
      setSelectedUrls((prev) => {
        const next = new Set(prev);
        for (const u of urlsToLoad) next.delete(u);
        return next;
      });
      setBanner({
        type: "success",
        text: `Loaded ${res.loadedPartitions} partition(s) into openalex.db (${res.totalImportedWorks.toLocaleString()} scholarly works indexed into SQLite FTS5).`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to load selected S3 partition(s)."),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnloadPartitions = async (urlsToUnload: string[], unloadAll = false) => {
    setBusyAction(unloadAll ? "unload-all" : `unload-${urlsToUnload[0] || "batch"}`);
    setBanner(null);
    try {
      const res = await unloadOpenAlexS3Partitions(unloadAll ? { unloadAll: true } : { s3Urls: urlsToUnload });
      await refreshStatus();
      setSelectedUrls(new Set());
      setBanner({
        type: "success",
        text: unloadAll
          ? `Evicted all partitions (${res.removedWorks.toLocaleString()} works removed from openalex.db) and optimized FTS5.`
          : `Unloaded ${urlsToUnload.length} partition(s) (${res.removedWorks.toLocaleString()} works removed from openalex.db).`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to unload S3 partition(s)."),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleOptimizeFts = async () => {
    setBusyAction("fts-optimize");
    setBanner(null);
    try {
      const res = await optimizeOpenAlexFts5();
      await refreshStatus();
      setBanner({
        type: "success",
        text: `Rebuilt & optimized SQLite FTS5 index (${res.ftsIndexedCount.toLocaleString()} documents indexed in ${res.durationMs} ms).`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to optimize FTS5 index."),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePreloadFirstSlice = async () => {
    setBusyAction("preload-first-slice");
    setBanner(null);
    try {
      const res = await preloadOpenAlexFirstSlice({ force: true, maxRecords });
      await refreshStatus();
      setBanner({
        type: "success",
        text: `Preloaded OpenAlex first slice: ${res.importedCount} works indexed into openalex.db (${res.totalWorks} total) in ${res.durationMs}ms from ${res.fromCache ? "local cache" : "S3"}.`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: getErrorMessage(err, "Failed to preload OpenAlex first slice."),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLoadCustomUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customS3Url.trim();
    if (!trimmed) return;
    await handleLoadPartitions([trimmed]);
    setCustomS3Url("");
  };

  const toggleSelectUrl = (s3Url: string) => {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(s3Url)) {
        next.delete(s3Url);
      } else {
        next.add(s3Url);
      }
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (filteredPartitions.length === 0) return;
    const allSelected = filteredPartitions.every((p) => selectedUrls.has(p.s3Url));
    if (allSelected) {
      setSelectedUrls(new Set());
    } else {
      setSelectedUrls(new Set(filteredPartitions.map((p) => p.s3Url)));
    }
  };

  const handleCopyCli = () => {
    if (!status?.awsCliSyncCommand) return;
    void navigator.clipboard?.writeText(status.awsCliSyncCommand);
    setCopiedCli(true);
    setTimeout(() => setCopiedCli(false), 2000);
  };

  return (
    <Box display="flex" flexDirection="column" gap={3}>
      {/* Top Architecture & Database Status Card */}
      <Card>
        <Box display="flex" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
          <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <DatabaseIcon size={20} fill="var(--color-accent-primary)" />
              <span style={{ fontWeight: 800, fontSize: "18px", color: "var(--color-text-primary)" }}>
                OpenAlex S3 Partition Manager &amp; Dedicated FTS5 Database
              </span>
              <Badge $variant="success">Dedicated openalex.db</Badge>
              <Badge $variant="info">SQLite FTS5 (BM25 + Porter)</Badge>
              <Badge $variant={status?.paidRestApiForwarded ? "warning" : "success"}>
                {status?.paidRestApiForwarded ? "Live REST API Enabled" : "Zero Paid API Calls (100% Self-Hosted S3)"}
              </Badge>
            </Box>
            <Box fontSize="13px" color="var(--color-text-muted)" style={{ lineHeight: 1.5 }}>
              Manage which partitions from the free public OpenAlex AWS S3 data lake (
              <a
                href={status?.s3BrowseUrl || "https://openalex.s3.amazonaws.com/browse.html#data/"}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-accent-primary)", textDecoration: "none", fontWeight: 600 }}
              >
                s3://openalex/data/works/ <LinkExternalIcon size={12} />
              </a>
              ) are loaded into the dedicated <code>openalex.db</code> database. By default,{" "}
              <strong>0 partitions</strong> are preloaded so your instance only stores the exact partitions and domains
              you select.
            </Box>
          </Box>

          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <ActionButton
              $variant="secondary"
              onClick={() => void refreshStatus()}
              disabled={loading || Boolean(busyAction)}
            >
              <SyncIcon size={14} /> Refresh Status
            </ActionButton>
            <ActionButton
              $variant="secondary"
              onClick={() => void handleOptimizeFts()}
              disabled={loading || Boolean(busyAction)}
            >
              <ZapIcon size={14} /> {busyAction === "fts-optimize" ? "Optimizing FTS5…" : "Rebuild & Optimize FTS5"}
            </ActionButton>
            <ActionButton
              $variant="secondary"
              onClick={() => void handlePreloadFirstSlice()}
              disabled={loading || Boolean(busyAction)}
              title="Download, cache, and preload the first slice of OpenAlex data from S3 into openalex.db"
            >
              <DownloadIcon size={14} />{" "}
              {busyAction === "preload-first-slice" ? "Preloading Slice…" : "Preload First Slice (Dev)"}
            </ActionButton>
            <ActionButton
              $variant="primary"
              onClick={() => void handleSyncManifest()}
              disabled={loading || Boolean(busyAction)}
            >
              <DownloadIcon size={14} />{" "}
              {busyAction === "sync-manifest" ? "Syncing S3 Manifest…" : "Sync S3 Bucket Manifest"}
            </ActionButton>
          </Box>
        </Box>

        {banner && (
          <Box
            mt={3}
            p={2}
            borderRadius={8}
            fontSize="13px"
            style={{
              background: banner.type === "success" ? "rgba(0, 186, 124, 0.12)" : "rgba(244, 33, 46, 0.12)",
              border: `1px solid ${banner.type === "success" ? "rgba(0, 186, 124, 0.35)" : "rgba(244, 33, 46, 0.35)"}`,
              color: banner.type === "success" ? "#00ba7c" : "#f4212e",
              fontWeight: 600,
            }}
          >
            {banner.text}
          </Box>
        )}

        <StatGrid style={{ marginTop: "16px" }}>
          <StatCard>
            <span className="label">Total Indexed Works</span>
            <span className="value">{(status?.catalogStats.totalWorks ?? 0).toLocaleString()}</span>
            <span className="sub">
              {(status?.catalogStats.openAccessWorks ?? 0).toLocaleString()} Open Access •{" "}
              {(status?.catalogStats.localPdfWorks ?? 0).toLocaleString()} Local PDFs
            </span>
          </StatCard>
          <StatCard>
            <span className="label">Loaded S3 Partitions</span>
            <span className="value">
              {status?.catalogStats.loadedPartitionsCount ?? 0} / {status?.catalogStats.totalPartitionsCount ?? 0}
            </span>
            <span className="sub">Default: 0 loaded until selected by admin</span>
          </StatCard>
          <StatCard>
            <span className="label">Local Disk Cache</span>
            <span className="value">
              {status?.cachedPartitionsCount ?? 0} cached ({formatBytes(status?.cachedPartitionsSizeBytes ?? 0)})
            </span>
            <span
              className="sub"
              title={status?.openalexCacheDir || "cache/openalex"}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {status?.openalexCacheDir ? status.openalexCacheDir.split("/").slice(-3).join("/") : "cache/openalex"}
            </span>
          </StatCard>
          <StatCard>
            <span className="label">FTS5 Search Index</span>
            <span className="value">{(status?.ftsIndexedCount ?? 0).toLocaleString()}</span>
            <span className="sub">scholarly_works_fts (porter unicode61)</span>
          </StatCard>
          <StatCard>
            <span className="label">openalex.db Footprint</span>
            <span className="value">{formatBytes(status?.openalexDbSizeBytes ?? 0)}</span>
            <span
              className="sub"
              title={status?.openalexDbPath || "openalex.db"}
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {status?.openalexDbPath ? status.openalexDbPath.split("/").slice(-2).join("/") : "openalex.db"}
            </span>
          </StatCard>
        </StatGrid>

        {/* AWS S3 CLI Helper Bar */}
        <Box
          mt={3}
          p={2}
          borderRadius={8}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
          flexWrap="wrap"
          gap={2}
          style={{
            background: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border-primary)",
          }}
        >
          <Box display="flex" flexDirection="column" gap={0.5}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
              }}
            >
              Anonymous AWS S3 Bucket Mirror Command (No AWS Account Required)
            </span>
            <code
              style={{
                fontSize: "12px",
                color: "var(--color-text-primary)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {status?.awsCliSyncCommand ||
                "aws s3 sync s3://openalex/data/works/ ./data/openalex/works/ --no-sign-request"}
            </code>
          </Box>
          <ActionButton $variant="secondary" onClick={handleCopyCli}>
            {copiedCli ? <CheckCircleIcon size={14} /> : <CopyIcon size={14} />}{" "}
            {copiedCli ? "Copied" : "Copy CLI Command"}
          </ActionButton>
        </Box>
      </Card>

      {/* Ingestion Filter Configuration & Direct Partition Loader */}
      <Card>
        <Box display="flex" alignItems="center" gap={2} mb={2}>
          <FilterIcon size={16} fill="var(--color-accent-primary)" />
          <span style={{ fontWeight: 800, fontSize: "15px", color: "var(--color-text-primary)" }}>
            Partition Ingestion Filters &amp; Streaming Controls
          </span>
        </Box>
        <Box fontSize="12px" color="var(--color-text-muted)" mb={3}>
          Configure optional filters applied on-the-fly while streaming gzipped JSONL partitions (
          <code>part_XXX.gz</code>) in constant ~20 MB RAM before writing into <code>openalex.db</code>.
        </Box>

        <Box
          display="grid"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              Min Citation Count
            </label>
            <Input
              type="number"
              min={0}
              value={minCitedByCount}
              onChange={(e) => setMinCitedByCount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0 (import all)"
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              From Publication Year
            </label>
            <Input
              type="number"
              min={1900}
              max={2030}
              value={fromYear}
              onChange={(e) => setFromYear(e.target.value)}
              placeholder="e.g. 2015"
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              To Publication Year
            </label>
            <Input
              type="number"
              min={1900}
              max={2030}
              value={toYear}
              onChange={(e) => setToYear(e.target.value)}
              placeholder="e.g. 2026"
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              Max Works per Partition
            </label>
            <Input
              type="number"
              min={1}
              max={250000}
              value={maxRecords}
              onChange={(e) => setMaxRecords(Math.max(1, Number(e.target.value) || 2500))}
            />
          </Box>

          <Box display="flex" flexDirection="column" gap={1} style={{ gridColumn: "span 2" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-secondary)" }}>
              Domain / Concept Keywords (comma-separated)
            </label>
            <Input
              type="text"
              value={conceptKeywords}
              onChange={(e) => setConceptKeywords(e.target.value)}
              placeholder="e.g. modelica, differential algebraic, control, power systems, cfd"
            />
          </Box>
        </Box>

        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mt={3}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "var(--color-text-primary)",
              cursor: "pointer",
            }}
          >
            <input type="checkbox" checked={oaOnly} onChange={(e) => setOaOnly(e.target.checked)} />
            <span>
              Only ingest Open Access works (<code>open_access.is_oa = true</code>)
            </span>
          </label>

          <form
            onSubmit={handleLoadCustomUrl}
            style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, maxWidth: "560px" }}
          >
            <Input
              type="text"
              value={customS3Url}
              onChange={(e) => setCustomS3Url(e.target.value)}
              placeholder="s3://openalex/data/works/updated_date=2026-03-15/part_000.gz"
              style={{ flex: 1 }}
            />
            <ActionButton type="submit" $variant="primary" disabled={!customS3Url.trim() || Boolean(busyAction)}>
              <DownloadIcon size={14} /> Load S3 Partition URI
            </ActionButton>
          </form>
        </Box>
      </Card>

      {/* S3 Partitions Catalog Table */}
      <Card>
        <Box display="flex" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={2} mb={3}>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span style={{ fontWeight: 800, fontSize: "16px", color: "var(--color-text-primary)" }}>
              S3 Bucket Partitions ({filteredPartitions.length})
            </span>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "loaded" | "unloaded")}
              aria-label="Filter partitions by status"
            >
              <option value="all">All Partitions ({partitions.length})</option>
              <option value="loaded">
                Loaded in openalex.db ({partitions.filter((p) => p.status === "loaded").length})
              </option>
              <option value="unloaded">Unloaded ({partitions.filter((p) => p.status !== "loaded").length})</option>
            </Select>
            <Box position="relative" display="flex" alignItems="center">
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by updated_date or part_XXX.gz…"
                style={{ minWidth: "240px" }}
              />
            </Box>
          </Box>

          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            {selectedUrls.size > 0 && (
              <>
                <ActionButton
                  $variant="primary"
                  onClick={() => void handleLoadPartitions(Array.from(selectedUrls))}
                  disabled={Boolean(busyAction)}
                >
                  <DownloadIcon size={14} /> Load Selected ({selectedUrls.size})
                </ActionButton>
                <ActionButton
                  $variant="danger"
                  onClick={() => void handleUnloadPartitions(Array.from(selectedUrls))}
                  disabled={Boolean(busyAction)}
                >
                  <TrashIcon size={14} /> Unload Selected ({selectedUrls.size})
                </ActionButton>
              </>
            )}
            {(status?.catalogStats.totalWorks ?? 0) > 0 && (
              <ActionButton
                $variant="danger"
                onClick={() => void handleUnloadPartitions([], true)}
                disabled={Boolean(busyAction)}
              >
                <TrashIcon size={14} /> Unload All &amp; Reset openalex.db
              </ActionButton>
            )}
          </Box>
        </Box>

        {partitions.length === 0 ? (
          <Box
            p={4}
            textAlign="center"
            borderRadius={12}
            style={{
              background: "var(--color-bg-secondary)",
              border: "1px dashed var(--color-border-primary)",
            }}
          >
            <DatabaseIcon size={28} fill="var(--color-text-muted)" />
            <Box fontWeight={800} fontSize="15px" color="var(--color-text-primary)" mt={2}>
              No S3 Partitions Loaded (openalex.db is Empty by Default)
            </Box>
            <Box
              fontSize="13px"
              color="var(--color-text-muted)"
              mt={1}
              mb={3}
              style={{ maxWidth: "560px", marginInline: "auto" }}
            >
              Click <strong>Sync S3 Bucket Manifest</strong> to fetch the partition catalog from{" "}
              <code>s3://openalex/data/works/manifest</code>, then select which partitions you want to stream into{" "}
              <code>openalex.db</code>.
            </Box>
            <ActionButton $variant="primary" onClick={() => void handleSyncManifest()} disabled={Boolean(busyAction)}>
              <DownloadIcon size={14} />{" "}
              {busyAction === "sync-manifest" ? "Syncing Manifest…" : "Sync S3 Bucket Manifest"}
            </ActionButton>
          </Box>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Table>
              <thead>
                <tr>
                  <th style={{ width: "36px" }}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible partitions"
                      checked={
                        filteredPartitions.length > 0 && filteredPartitions.every((p) => selectedUrls.has(p.s3Url))
                      }
                      onChange={toggleSelectAllVisible}
                    />
                  </th>
                  <th>Status</th>
                  <th>Updated Date</th>
                  <th>Partition File</th>
                  <th>S3 URI</th>
                  <th>S3 Size / Records</th>
                  <th>In openalex.db</th>
                  <th>Last Loaded</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartitions.map((part: OpenAlexS3PartitionDto) => {
                  const isLoaded = part.status === "loaded";
                  const isRowBusy = busyAction === `load-${part.s3Url}` || busyAction === `unload-${part.s3Url}`;
                  return (
                    <tr key={part.s3Url}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${part.s3Url}`}
                          checked={selectedUrls.has(part.s3Url)}
                          onChange={() => toggleSelectUrl(part.s3Url)}
                        />
                      </td>
                      <td>
                        <Badge
                          $variant={
                            part.status === "loaded"
                              ? "success"
                              : part.status === "loading"
                                ? "info"
                                : part.status === "error"
                                  ? "danger"
                                  : "default"
                          }
                        >
                          {part.status.toUpperCase()}
                        </Badge>
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{part.updatedDate || "—"}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>{part.partName}</td>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px" }}>
                        <Box display="flex" alignItems="center" gap={1}>
                          <span title={part.s3Url}>{part.s3Url}</span>
                          <a
                            href={part.httpsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Direct S3 HTTPS Download"
                            style={{ color: "var(--color-accent-primary)" }}
                          >
                            <LinkExternalIcon size={12} />
                          </a>
                        </Box>
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                        {part.contentLength > 0 ? formatBytes(part.contentLength) : "Stream"} •{" "}
                        {part.recordCount > 0 ? `${part.recordCount.toLocaleString()} recs` : "JSONL"}
                      </td>
                      <td style={{ fontWeight: 700 }}>
                        {isLoaded ? (
                          <span style={{ color: "#00ba7c" }}>{part.importedCount.toLocaleString()} works</span>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>0 works</span>
                        )}
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                        {part.lastLoadedAt
                          ? `${part.lastLoadedAt.slice(0, 16).replace("T", " ")}${
                              part.lastDurationMs !== null ? ` (${part.lastDurationMs} ms)` : ""
                            }`
                          : "Never"}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <Box display="inline-flex" alignItems="center" gap={1}>
                          <ActionButton
                            $variant={isLoaded ? "secondary" : "primary"}
                            onClick={() => void handleLoadPartitions([part.s3Url])}
                            disabled={Boolean(busyAction)}
                          >
                            <DownloadIcon size={12} /> {isRowBusy ? "Working…" : isLoaded ? "Reload" : "Load Partition"}
                          </ActionButton>
                          {isLoaded && (
                            <ActionButton
                              $variant="danger"
                              onClick={() => void handleUnloadPartitions([part.s3Url])}
                              disabled={Boolean(busyAction)}
                            >
                              <TrashIcon size={12} /> Unload
                            </ActionButton>
                          )}
                        </Box>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Box>
        )}
      </Card>
    </Box>
  );
};

export default AdminOpenAlexTab;
