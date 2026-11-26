// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";

interface CreatorEarningsSummary {
  userId: number;
  totalEarnedCredits: number;
  byReason: Record<string, number>;
  retrievalReceiptCount: number;
  attributedArtifactsCount: number;
  recentPayouts: Array<{
    id: number;
    reason: string;
    artifactCid: string | null;
    amountCredits: number;
    createdAt: string;
  }>;
}

export function CreatorAttributionEarningsCard() {
  const [summary, setSummary] = useState<CreatorEarningsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/ai/attribution/earnings", { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as CreatorEarningsSummary;
      })
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Unable to load attribution earnings");
      });
    return () => {
      active = false;
    };
  }, []);

  if (error || !summary) {
    return null;
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid var(--color-border-default)",
        background: "var(--color-canvas-subtle)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Creator Attribution &amp; Royalty Earnings</h3>
        <strong style={{ fontSize: 18 }}>{summary.totalEarnedCredits.toFixed(4)} credits</strong>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "var(--color-fg-muted)",
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>Retrieval Receipts: {summary.retrievalReceiptCount}</span>
        <span>Attributed Models/Shards: {summary.attributedArtifactsCount}</span>
        {Object.entries(summary.byReason).map(([reason, amt]) => (
          <span key={reason}>
            {reason}: +{amt.toFixed(4)}
          </span>
        ))}
      </div>
      {summary.recentPayouts.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {summary.recentPayouts.slice(0, 6).map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: 4,
                background: "var(--color-canvas-default)",
              }}
            >
              <span>
                {p.reason} {p.artifactCid ? `(${p.artifactCid.slice(0, 18)})` : ""}
              </span>
              <strong>+{p.amountCredits.toFixed(4)} cr</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
