// SPDX-License-Identifier: AGPL-3.0-or-later

import { GlobeIcon, GraphIcon, ShieldCheckIcon, TrashIcon } from "@primer/octicons-react";
import React, { useMemo, useState } from "react";
import Box from "../../../components/Box";
import WorldMap from "../../../components/WorldMap";
import { ActionButton, Badge, Card, FilterPill, Select, StatGrid, Table } from "../styles";
import type { AdminAnalyticsSummary } from "../types";

export interface AdminAnalyticsTabProps {
  analytics: AdminAnalyticsSummary | null;
  analyticsDays: number;
  setAnalyticsDays: (days: number) => void;
  analyticsSurface: "all" | "web" | "docs";
  setAnalyticsSurface: (surface: "all" | "web" | "docs") => void;
  onPruneAnalytics: (retainDays: number) => Promise<void>;
  loading: boolean;
}

export const AdminAnalyticsTab: React.FC<AdminAnalyticsTabProps> = ({
  analytics,
  analyticsDays,
  setAnalyticsDays,
  analyticsSurface,
  setAnalyticsSurface,
  onPruneAnalytics,
  loading,
}) => {
  const [retainDays, setRetainDays] = useState<number>(90);

  const totals = analytics?.totals || {
    totalViews: 0,
    uniqueViews: 0,
    webViews: 0,
    docsViews: 0,
    totalPostViews: 0,
    totalPackageDownloads: 0,
  };

  const mapCountryData = useMemo(
    () =>
      (analytics?.countryBreakdown || []).map((c) => ({
        country: c.countryCode,
        views: c.views,
      })),
    [analytics?.countryBreakdown],
  );

  const mapRegionData = useMemo(
    () =>
      (analytics?.regionBreakdown || []).map((r) => ({
        country: r.countryCode,
        region: r.region,
        views: r.views,
      })),
    [analytics?.regionBreakdown],
  );

  const dailySeries = analytics?.dailySeries || [];
  const maxDailyViews = useMemo(() => Math.max(...dailySeries.map((d) => d.views), 1), [dailySeries]);

  const topPages = analytics?.topPages || [];

  return (
    <div>
      {/* Controls Bar: Surface + Time Window */}
      <Card>
        <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={3}>
          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)" }}>Surface:</span>
            <FilterPill $active={analyticsSurface === "all"} onClick={() => setAnalyticsSurface("all")}>
              All Surfaces
            </FilterPill>
            <FilterPill $active={analyticsSurface === "web"} onClick={() => setAnalyticsSurface("web")}>
              Web App
            </FilterPill>
            <FilterPill $active={analyticsSurface === "docs"} onClick={() => setAnalyticsSurface("docs")}>
              Docs Portal
            </FilterPill>
          </Box>

          <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-muted)" }}>Window:</span>
            {[7, 30, 90].map((d) => (
              <FilterPill key={d} $active={analyticsDays === d} onClick={() => setAnalyticsDays(d)}>
                {d} Days
              </FilterPill>
            ))}
          </Box>
        </Box>
      </Card>

      {/* Primary KPI Grid */}
      <StatGrid>
        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Page Views ({analyticsDays}d)</span>
          <span style={{ fontSize: "24px", fontWeight: 800 }}>{totals.totalViews.toLocaleString()}</span>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {totals.uniqueViews.toLocaleString()} unique daily visitors
          </span>
        </Card>

        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Surface Split ({analyticsDays}d)</span>
          <Box display="flex" alignItems="baseline" gap={2}>
            <span style={{ fontSize: "20px", fontWeight: 800 }}>{totals.webViews.toLocaleString()}</span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Web</span>
            <span style={{ color: "var(--color-text-muted)" }}>·</span>
            <span style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-accent-cyan)" }}>
              {totals.docsViews.toLocaleString()}
            </span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Docs</span>
          </Box>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Unified first-party origin telemetry
          </span>
        </Card>

        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Content &amp; Registry Reach</span>
          <Box display="flex" alignItems="baseline" gap={2}>
            <span style={{ fontSize: "20px", fontWeight: 800 }}>{totals.totalPostViews.toLocaleString()}</span>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Post Views</span>
          </Box>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            {totals.totalPackageDownloads.toLocaleString()} total package downloads
          </span>
        </Card>

        <Card>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>Privacy &amp; GeoIP Engine</span>
          <Box display="flex" alignItems="center" gap={2} mt={1}>
            <Badge $variant={analytics?.geoipConfigured ? "success" : "warning"}>
              {analytics?.geoipConfigured ? "MAXMIND MMDB ACTIVE" : "PROXY HEADER MODE"}
            </Badge>
          </Box>
          <span
            style={{
              fontSize: "12px",
              color: "var(--color-text-muted)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <ShieldCheckIcon size={13} /> Zero raw IP persistence (daily HMAC)
          </span>
        </Card>
      </StatGrid>

      {/* Daily Traffic Trend */}
      {dailySeries.length > 0 && (
        <Card>
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
            <Box display="flex" alignItems="center" gap={2}>
              <GraphIcon size={16} />
              <span style={{ fontWeight: 700, fontSize: "14px" }}>Daily Traffic Trend</span>
            </Box>
            <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
              {dailySeries.length} active day{dailySeries.length === 1 ? "" : "s"} recorded
            </span>
          </Box>
          <Box
            display="flex"
            alignItems="flex-end"
            gap={1}
            style={{
              height: "120px",
              padding: "12px 4px 4px",
              borderBottom: "1px solid var(--color-border-subtle)",
              overflowX: "auto",
            }}
          >
            {dailySeries.map((point) => {
              const heightPct = Math.max(6, Math.round((point.views / maxDailyViews) * 100));
              return (
                <div
                  key={point.day}
                  title={`${point.day}: ${point.views} views (${point.uniqueViews} unique)`}
                  style={{
                    flex: "1 1 12px",
                    minWidth: "10px",
                    maxWidth: "36px",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: `${heightPct}%`,
                      borderRadius: "4px 4px 0 0",
                      background: "linear-gradient(180deg, var(--color-accent-cyan, #06b6d4), #2563eb)",
                      transition: "height 0.2s ease",
                    }}
                  />
                </div>
              );
            })}
          </Box>
          <Box
            display="flex"
            justifyContent="space-between"
            style={{ fontSize: "11px", color: "var(--color-text-muted)" }}
          >
            <span>{dailySeries[0]?.day}</span>
            <span>{dailySeries[dailySeries.length - 1]?.day}</span>
          </Box>
        </Card>
      )}

      {/* Geographic Distribution Map */}
      <Box mb={3}>
        <WorldMap data={mapCountryData} regionData={mapRegionData} totalViews={totals.totalViews} />
      </Box>

      {/* Top Pages Table */}
      <Card>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
          <Box display="flex" alignItems="center" gap={2}>
            <GlobeIcon size={16} />
            <span style={{ fontWeight: 700, fontSize: "14px" }}>Top Pages ({topPages.length})</span>
          </Box>
          <span style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
            Ranked by total views over the last {analyticsDays} days
          </span>
        </Box>

        {topPages.length === 0 ? (
          <Box p={3} style={{ color: "var(--color-text-muted)", fontSize: "13px", textAlign: "center" }}>
            No page views recorded for the selected surface and time window yet.
          </Box>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>#</th>
                <th>Surface</th>
                <th>Route Path</th>
                <th>Total Views</th>
                <th>Unique Visitors</th>
                <th>Traffic Share</th>
              </tr>
            </thead>
            <tbody>
              {topPages.map((row, idx) => {
                const sharePct =
                  totals.totalViews > 0 ? Math.min(100, Math.round((row.views / totals.totalViews) * 100)) : 0;
                return (
                  <tr key={`${row.surface}:${row.path}`}>
                    <td style={{ color: "var(--color-text-muted)" }}>{idx + 1}</td>
                    <td>
                      <Badge $variant={row.surface === "docs" ? "approved" : "neutral"}>
                        {row.surface.toUpperCase()}
                      </Badge>
                    </td>
                    <td>
                      <code style={{ fontSize: "12px" }}>{row.path}</code>
                    </td>
                    <td>
                      <strong>{row.views.toLocaleString()}</strong>
                    </td>
                    <td>{row.uniqueViews.toLocaleString()}</td>
                    <td style={{ color: "var(--color-text-muted)" }}>{sharePct}%</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Retention & Pruning Management */}
      <Card>
        <span style={{ fontWeight: 700, fontSize: "14px" }}>Analytics Retention &amp; Rollup Pruning</span>
        <span style={{ fontSize: "13px", color: "var(--color-text-muted)" }}>
          Page view rollups store only daily aggregate counts by route and ISO country/region code. You can prune
          historical daily buckets older than a retention threshold at any time.
        </span>
        <Box display="flex" alignItems="center" gap={2} mt={2} flexWrap="wrap">
          <Select
            aria-label="Retention window in days"
            value={retainDays}
            onChange={(e) => setRetainDays(Number(e.target.value))}
          >
            <option value={90}>Retain last 90 days</option>
            <option value={30}>Retain last 30 days</option>
            <option value={7}>Retain last 7 days</option>
          </Select>
          <ActionButton $variant="danger" disabled={loading} onClick={() => void onPruneAnalytics(retainDays)}>
            <TrashIcon size={14} />
            <span>Prune Historical Rollups</span>
          </ActionButton>
        </Box>
      </Card>
    </div>
  );
};
