// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useState } from "react";

interface DiskAnnStats {
  backend: "diskann";
  vectorDim: number;
  activeEmbeddingModelId: string;
  totalChunks: number;
  quarantinedChunks: number;
  formalVerifiedChunks: number;
  ramInt8Bytes: number;
  nvmeFp32Bytes: number;
  deadSlotBytes: number;
  maxVamanaDegree: number;
  bySourceKind: Record<string, number>;
  byModality: Record<string, number>;
  byEmbeddingModel: Record<string, number>;
}

interface MemoryChunkListItem {
  chunkId: string;
  sourceKind: string;
  sourceUri: string;
  packageName: string | null;
  packageVersion: string | null;
  dialect: string;
  tenantScope: string;
  formalVerified: boolean;
  isQuarantined: boolean;
  embeddingModelId: string;
  modalityKind: string;
  symbolTags: string[];
  contentPreview: string;
  independentReproductions: number;
}

interface FederatedPeer {
  peerUrl: string;
  label: string;
  publicKeyMultibase?: string | null;
  enabled: boolean;
  lastSeenAt?: string | null;
  lastLatencyMs?: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function VectorMemoryPage() {
  const [stats, setStats] = useState<DiskAnnStats | null>(null);
  const [chunks, setChunks] = useState<MemoryChunkListItem[]>([]);
  const [totalChunks, setTotalChunks] = useState(0);
  const [peers, setPeers] = useState<FederatedPeer[]>([]);
  const [search, setSearch] = useState("");
  const [dialectFilter, setDialectFilter] = useState("");
  const [modalityFilter, setModalityFilter] = useState("");
  const [quarantineOnly, setQuarantineOnly] = useState(false);
  const [newPeerUrl, setNewPeerUrl] = useState("");
  const [newPeerLabel, setNewPeerLabel] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set("search", search.trim());
      if (dialectFilter.trim()) qs.set("dialect", dialectFilter.trim());
      if (modalityFilter.trim()) qs.set("modalityKind", modalityFilter.trim());
      if (quarantineOnly) qs.set("isQuarantined", "true");
      qs.set("limit", "50");

      const [statsRes, chunksRes, peersRes] = await Promise.all([
        fetch("/api/v1/memory/stats", { credentials: "include" }),
        fetch(`/api/v1/memory/chunks?${qs.toString()}`, { credentials: "include" }),
        fetch("/api/v1/memory/federated/peers", { credentials: "include" }),
      ]);

      if (statsRes.ok) {
        setStats((await statsRes.json()) as DiskAnnStats);
      }
      if (chunksRes.ok) {
        const data = (await chunksRes.json()) as { chunks?: MemoryChunkListItem[]; total?: number };
        setChunks(data.chunks ?? []);
        setTotalChunks(data.total ?? 0);
      }
      if (peersRes.ok) {
        const data = (await peersRes.json()) as { peers?: FederatedPeer[] };
        setPeers(data.peers ?? []);
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to load DiskANN memory state");
    } finally {
      setLoading(false);
    }
  }, [search, dialectFilter, modalityFilter, quarantineOnly]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleToggleQuarantine = async (chunk: MemoryChunkListItem) => {
    setStatusMessage(null);
    const res = await fetch(`/api/v1/memory/chunks/${encodeURIComponent(chunk.chunkId)}/quarantine`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ quarantined: !chunk.isQuarantined }),
    });
    if (res.ok) {
      setStatusMessage(`${!chunk.isQuarantined ? "Quarantined" : "Restored"} chunk ${chunk.chunkId.slice(0, 10)}.`);
      await loadAll();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(err.error ?? "Sign in to modify chunk quarantine status.");
    }
  };

  const handleDeleteChunk = async (chunkId: string) => {
    setStatusMessage(null);
    const res = await fetch(`/api/v1/memory/chunks/${encodeURIComponent(chunkId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setStatusMessage(`Deleted chunk ${chunkId.slice(0, 10)}.`);
      await loadAll();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(err.error ?? "Failed to delete chunk.");
    }
  };

  const handleCompact = async () => {
    setStatusMessage("Compacting NVMe FP32 vector store & rebuilding INT8 Vamana graph...");
    const res = await fetch("/api/v1/memory/compact", {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const data = (await res.json()) as {
        beforeChunks: number;
        afterChunks: number;
        reclaimedBytes: number;
        deduplicatedCount: number;
      };
      setStatusMessage(
        `Compacted DiskANN: ${data.beforeChunks} -> ${data.afterChunks} chunks (${data.deduplicatedCount} deduped, ${formatBytes(data.reclaimedBytes)} reclaimed).`,
      );
      await loadAll();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(err.error ?? "Compaction requires authentication.");
    }
  };

  const handleAddPeer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPeerUrl.trim()) return;
    const res = await fetch("/api/v1/memory/federated/peers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ peerUrl: newPeerUrl.trim(), label: newPeerLabel.trim() || newPeerUrl.trim() }),
    });
    if (res.ok) {
      setNewPeerUrl("");
      setNewPeerLabel("");
      setStatusMessage("Added federated DiskANN peer.");
      await loadAll();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(err.error ?? "Failed to register federated peer.");
    }
  };

  const handleRemovePeer = async (peerUrl: string) => {
    const res = await fetch(`/api/v1/memory/federated/peers?peerUrl=${encodeURIComponent(peerUrl)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setStatusMessage(`Removed peer ${peerUrl}.`);
      await loadAll();
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(err.error ?? "Failed to remove peer.");
    }
  };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 20px 56px", color: "var(--color-text-primary)" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "16px 18px",
          borderRadius: 12,
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-card)",
          boxShadow: "var(--ms-shadow-card)",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--color-text-heading)" }}>
            DiskANN Vector Memory &amp; Curation Console
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--color-text-muted)", fontSize: 13 }}>
            Inspect INT8 RAM Vamana / NVMe FP32 memory chunks, enforce quarantines, compact dead vector slots, and
            manage federated peers.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={loading}
            style={{
              padding: "7px 13px",
              borderRadius: 8,
              border: "1px solid var(--color-border-default)",
              background: "var(--color-bg-surface)",
              color: "var(--color-text-primary)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void handleCompact()}
            style={{
              padding: "7px 13px",
              borderRadius: 8,
              border: "1px solid var(--ms-brand)",
              background: "var(--ms-brand)",
              color: "var(--ms-brand-contrast, #ffffff)",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Compact Index
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid var(--color-border-default)",
            background: "var(--color-canvas-subtle)",
            fontSize: 13,
          }}
        >
          {statusMessage}
        </div>
      )}

      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
            marginTop: 16,
          }}
        >
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border-default)" }}>
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Active Chunks</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{stats.totalChunks}</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              {stats.formalVerifiedChunks} formal-verified · {stats.quarantinedChunks} quarantined
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border-default)" }}>
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>RAM INT8 / NVMe FP32</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {formatBytes(stats.ramInt8Bytes)} / {formatBytes(stats.nvmeFp32Bytes)}
            </div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              Dead slots: {formatBytes(stats.deadSlotBytes)} · dim={stats.vectorDim}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border-default)" }}>
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Active Embedding Space</div>
            <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-all" }}>{stats.activeEmbeddingModelId}</div>
            <div style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              Vamana max degree: {stats.maxVamanaDegree}
            </div>
          </div>
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid var(--color-border-default)" }}>
            <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Modalities</div>
            <div style={{ fontSize: 12, marginTop: 4 }}>
              {Object.entries(stats.byModality).length === 0
                ? "None"
                : Object.entries(stats.byModality)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 20,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          type="text"
          placeholder="Search URI, symbol tag, or content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 240px", padding: "6px 10px" }}
        />
        <input
          type="text"
          placeholder="Dialect (modelica, scad...)"
          value={dialectFilter}
          onChange={(e) => setDialectFilter(e.target.value)}
          style={{ width: 170, padding: "6px 10px" }}
        />
        <select
          value={modalityFilter}
          onChange={(e) => setModalityFilter(e.target.value)}
          style={{ padding: "6px 10px" }}
        >
          <option value="">All Modalities</option>
          <option value="code">Code / DAE</option>
          <option value="cad">CAD / Geometry</option>
          <option value="wam">WAM / Robotics</option>
          <option value="ontology">OWL2 / Ontology</option>
          <option value="social">Social / RLHF</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input type="checkbox" checked={quarantineOnly} onChange={(e) => setQuarantineOnly(e.target.checked)} />
          Quarantined only
        </label>
      </div>

      <h2 style={{ marginTop: 20, fontSize: 16 }}>
        Indexed Memory Chunks ({chunks.length} of {totalChunks})
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {chunks.map((ch) => (
          <div
            key={ch.chunkId}
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--color-border-default)",
              opacity: ch.isQuarantined ? 0.65 : 1,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                <strong>{ch.sourceUri}</strong>{" "}
                <span style={{ color: "var(--color-fg-muted)" }}>
                  [{ch.sourceKind} · {ch.dialect} · {ch.modalityKind} · {ch.embeddingModelId}]
                </span>
                {ch.formalVerified && <span style={{ marginLeft: 6, color: "#1a7f37" }}>Verified</span>}
                {ch.isQuarantined && <span style={{ marginLeft: 6, color: "#cf222e" }}>Quarantined</span>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => void handleToggleQuarantine(ch)}>
                  {ch.isQuarantined ? "Restore" : "Quarantine"}
                </button>
                <button type="button" onClick={() => void handleDeleteChunk(ch.chunkId)}>
                  Delete
                </button>
              </div>
            </div>
            <pre
              style={{
                margin: "8px 0 0",
                padding: 8,
                fontSize: 12,
                whiteSpace: "pre-wrap",
                background: "var(--color-canvas-subtle)",
                borderRadius: 6,
              }}
            >
              {ch.contentPreview}
            </pre>
          </div>
        ))}
        {chunks.length === 0 && (
          <div style={{ color: "var(--color-fg-muted)", fontSize: 13 }}>
            No DiskANN memory chunks match the current filters.
          </div>
        )}
      </div>

      <h2 style={{ marginTop: 28, fontSize: 16 }}>Federated DiskANN Peers ({peers.length})</h2>
      <form
        onSubmit={(e) => void handleAddPeer(e)}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}
      >
        <input
          type="url"
          placeholder="https://peer.ansatz.social"
          value={newPeerUrl}
          onChange={(e) => setNewPeerUrl(e.target.value)}
          style={{ flex: "1 1 260px", padding: "6px 10px" }}
        />
        <input
          type="text"
          placeholder="Label"
          value={newPeerLabel}
          onChange={(e) => setNewPeerLabel(e.target.value)}
          style={{ width: 180, padding: "6px 10px" }}
        />
        <button type="submit">Add Peer</button>
      </form>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {peers.map((peer) => (
          <div
            key={peer.peerUrl}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid var(--color-border-default)",
              fontSize: 13,
            }}
          >
            <div>
              <strong>{peer.label || peer.peerUrl}</strong>{" "}
              <span style={{ color: "var(--color-fg-muted)" }}>{peer.peerUrl}</span>
            </div>
            <button type="button" onClick={() => void handleRemovePeer(peer.peerUrl)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
