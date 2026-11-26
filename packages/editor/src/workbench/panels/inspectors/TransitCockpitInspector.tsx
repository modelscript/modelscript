// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import { InspectorTabs } from "./InspectorTabs.js";

const CsvViewer = React.lazy(() => import("../../../internal/CsvViewer").then((m) => ({ default: m.CsvViewer })));

export interface TransitCockpitInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

interface TransitStop {
  id: string;
  name: string;
  distanceKm: number;
}

interface TransitTrip {
  id: string;
  routeId: string;
  vehicleId: string;
  depTimeH: number;
  arrTimeH: number;
  batteryStartSoc: number;
  batteryEndSoc: number;
  energyKwh: number;
  line: number;
}

export const TransitCockpitInspector: React.FC<TransitCockpitInspectorProps> = ({
  code,
  lines,
  colorMode,
  onRevealLine,
}) => {
  const [subTab, setSubTab] = useState<"marey" | "charging" | "fleet" | "table">("marey");
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const isDark = colorMode === "dark";
  const borderCol = "var(--color-border-default, rgba(148, 163, 184, 0.18))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--color-fg-default, #c9d1d9)";
  const textMuted = "var(--color-fg-muted, #8b949e)";

  // Standard transit corridor stops
  const stops: TransitStop[] = useMemo(
    () => [
      { id: "DEPOT", name: "Central Metro Depot", distanceKm: 0.0 },
      { id: "STA_1", name: "Civic Center / Market", distanceKm: 3.8 },
      { id: "STA_2", name: "Innovation District", distanceKm: 8.2 },
      { id: "STA_3", name: "University Campus", distanceKm: 14.5 },
      { id: "TERM", name: "Regional Airport Terminal", distanceKm: 22.0 },
    ],
    [],
  );

  // Parse GTFS trips or synthesize scheduled bus runs
  const trips = useMemo<TransitTrip[]>(() => {
    const list: TransitTrip[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!.trim();
      const tripMatch = /(?:trip_id|TRIP)\s*[:=,]?\s*["']?([A-Za-z0-9_-]+)["']?/i.exec(l);
      if (tripMatch) {
        const idx = list.length;
        const dep = 6.0 + idx * 0.75;
        const arr = dep + 0.85;
        list.push({
          id: tripMatch[1]!,
          routeId: "Route-38R",
          vehicleId: `BEB-${101 + idx}`,
          depTimeH: dep,
          arrTimeH: arr,
          batteryStartSoc: 0.95 - ((idx * 0.04) % 0.4),
          batteryEndSoc: 0.78 - ((idx * 0.04) % 0.4),
          energyKwh: 38.5,
          line: i + 1,
        });
      }
    }

    return list;
  }, [lines]);

  // Hourly depot load profile derived from parsed trip energy demand (returns all zeros when no trips are present)
  const hourlyDepotKw = useMemo(() => {
    const profile = new Array<number>(24).fill(0);
    for (const trip of trips) {
      const chargeHour = Math.max(0, Math.min(23, Math.floor(trip.arrTimeH)));
      profile[chargeHour] = (profile[chargeHour] ?? 0) + trip.energyKwh;
    }
    return profile;
  }, [trips]);

  const totalDailyKwh = trips.reduce((acc, t) => acc + t.energyKwh, 0);
  const peakDepotKw = hourlyDepotKw.length > 0 ? Math.max(...hourlyDepotKw) : 0;

  // Marey SVG dimensions
  const svgW = 680;
  const svgH = 240;
  const mPadL = 120;
  const mPadR = 25;
  const mPadT = 20;
  const mPadB = 30;

  const minTimeH = 5.0;
  const maxTimeH = 20.0;
  const maxDistKm = stops[stops.length - 1]!.distanceKm;

  const toTimeSvgX = (tH: number) => {
    const ratio = (tH - minTimeH) / (maxTimeH - minTimeH);
    return mPadL + ratio * (svgW - mPadL - mPadR);
  };

  const toDistSvgY = (distKm: number) => {
    const ratio = distKm / maxDistKm;
    return mPadT + ratio * (svgH - mPadT - mPadB);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, color: textPrimary, fontSize: 13 }}>
      {/* Header & Sub-navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: 10,
          borderBottom: `1px solid ${borderCol}`,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: "var(--fgColor-accent, var(--ms-brand))" }}>
            Transit Electrification & Fleet Charging Cockpit
          </div>
          <div style={{ fontSize: 12, color: textMuted }}>
            Marey Stringline Schedules, Battery Electric Bus (BEB) SOC & Smart Charging
          </div>
        </div>

        <InspectorTabs
          ariaLabel="Transit cockpit views"
          value={subTab}
          onChange={(id) => setSubTab(id as "marey" | "charging" | "fleet" | "table")}
          tabs={[
            { id: "marey", label: `Marey Stringline (${trips.length} Trips)` },
            { id: "charging", label: "Depot Grid & Load Profile" },
            { id: "fleet", label: "Battery SOC Schedule" },
            { id: "table", label: "📊 Feed Table" },
          ]}
        />
      </div>

      {subTab === "table" && (
        <div style={{ height: 460, borderRadius: 8, overflow: "hidden", border: `1px solid ${borderCol}` }}>
          <React.Suspense fallback={null}>
            <CsvViewer
              viewConfig={{ code, format: "csv", initialMode: "table", title: "gtfs_feed.txt" }}
              dialect="gtfs"
              isFullScreen
              onRevealLine={onRevealLine}
            />
          </React.Suspense>
        </div>
      )}

      {/* KPI Ribbon */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        <div
          style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: cardBg, border: `1px solid ${borderCol}` }}
        >
          <div style={{ fontSize: 11, color: textMuted }}>Fleet Scheduled Trips</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace" }}>{trips.length} runs</div>
        </div>
        <div
          style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: cardBg, border: `1px solid ${borderCol}` }}
        >
          <div style={{ fontSize: 11, color: textMuted }}>Total Fleet Energy</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "monospace",
              color: "var(--fgColor-accent, var(--ms-brand))",
            }}
          >
            {totalDailyKwh.toFixed(1)} kWh
          </div>
        </div>
        <div
          style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: cardBg, border: `1px solid ${borderCol}` }}
        >
          <div style={{ fontSize: 11, color: textMuted }}>Peak Depot Demand</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: "monospace",
              color: peakDepotKw > 1000 ? "#f0883e" : "#3fb950",
            }}
          >
            {peakDepotKw.toFixed(0)} kW
          </div>
        </div>
        <div
          style={{ padding: "8px 12px", borderRadius: 6, backgroundColor: cardBg, border: `1px solid ${borderCol}` }}
        >
          <div style={{ fontSize: 11, color: textMuted }}>Transformer Headroom</div>
          <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "monospace", color: "#3fb950" }}>
            {(1500 - peakDepotKw).toFixed(0)} kW
          </div>
        </div>
      </div>

      {/* ── View 1: Marey Stringline Diagram ── */}
      {subTab === "marey" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Marey Time-Distance Trajectories (Departure Time → Arrival Distance)
            </div>
            <div style={{ fontSize: 11, color: textMuted }}>
              Click any trajectory line to jump to GTFS stop_times definition
            </div>
          </div>

          <svg width="100%" height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ overflow: "visible" }}>
            {/* Station Horizontal Guide Lines */}
            {stops.map((st) => {
              const y = toDistSvgY(st.distanceKm);
              return (
                <g key={st.id}>
                  <line
                    x1={mPadL}
                    y1={y}
                    x2={svgW - mPadR}
                    y2={y}
                    stroke={isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}
                    strokeDasharray="2 2"
                  />
                  <text x={mPadL - 8} y={y + 3} fill={textMuted} fontSize={10} textAnchor="end">
                    {st.name} ({st.distanceKm}km)
                  </text>
                </g>
              );
            })}

            {/* Time Vertical Grid Lines */}
            {[5, 7, 9, 11, 13, 15, 17, 19].map((hour) => {
              const x = toTimeSvgX(hour);
              return (
                <g key={hour}>
                  <line
                    x1={x}
                    y1={mPadT}
                    x2={x}
                    y2={svgH - mPadB}
                    stroke={isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)"}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={x}
                    y={svgH - mPadB + 14}
                    fill={textMuted}
                    fontSize={10}
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {String(hour).padStart(2, "0")}:00
                  </text>
                </g>
              );
            })}

            {/* Trajectory Stringlines */}
            {trips.map((t) => {
              const x1 = toTimeSvgX(t.depTimeH);
              const y1 = toDistSvgY(0);
              const x2 = toTimeSvgX(t.arrTimeH);
              const y2 = toDistSvgY(maxDistKm);
              const isSelected = selectedTripId === t.id;

              return (
                <g
                  key={t.id}
                  onClick={() => {
                    setSelectedTripId(t.id);
                    onRevealLine?.(t.line, `Trip ${t.id}`);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isSelected ? "#f0883e" : "var(--fgColor-accent, var(--ms-brand))"}
                    strokeWidth={isSelected ? 3 : 1.8}
                    opacity={isSelected ? 1.0 : 0.8}
                  />
                  <circle cx={x1} cy={y1} r={3} fill="var(--fgColor-accent, var(--ms-brand))" />
                  <circle cx={x2} cy={y2} r={3} fill="#3fb950" />
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* ── View 2: Depot Grid Load & Power ── */}
      {subTab === "charging" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              24-Hour Depot Fleet Charging Power Profile & Transformer Limit
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 12, height: 2, backgroundColor: "#f85149", borderTop: "2px dashed #f85149" }} />{" "}
                1500 kW Capacity Limit
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    backgroundColor: "var(--fgColor-accent, var(--ms-brand))",
                    borderRadius: 2,
                  }}
                />{" "}
                Aggregated EVSE Load
              </span>
            </div>
          </div>

          {/* Load Curve SVG */}
          <svg width="100%" height={180} viewBox="0 0 600 180" style={{ overflow: "visible" }}>
            {/* Limit Line at 1500 kW */}
            <line x1={40} y1={25} x2={580} y2={25} stroke="#f85149" strokeWidth={1.5} strokeDasharray="4 4" />
            <text x={585} y={29} fill="#f85149" fontSize={10} fontFamily="monospace">
              1500 kW
            </text>

            {/* Bars for 24h load */}
            {hourlyDepotKw.map((kw, h) => {
              const x = 45 + h * 22;
              const barH = (kw / 1600) * 125;
              const y = 150 - barH;
              return (
                <g key={h}>
                  <rect x={x} y={y} width={16} height={barH} rx={2} fill="#388bfd" opacity={0.75} />
                  {h % 3 === 0 && (
                    <text x={x + 8} y={165} fill={textMuted} fontSize={9} textAnchor="middle" fontFamily="monospace">
                      {String(h).padStart(2, "0")}h
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}

      {/* ── View 3: Fleet Battery Schedule ── */}
      {subTab === "fleet" && (
        <div style={{ borderRadius: 8, border: `1px solid ${borderCol}`, overflow: "hidden", backgroundColor: cardBg }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${borderCol}`,
                  backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "8px 12px" }}>Trip ID</th>
                <th style={{ padding: "8px 12px" }}>Route</th>
                <th style={{ padding: "8px 12px" }}>Vehicle ID</th>
                <th style={{ padding: "8px 12px" }}>Schedule (Dep-Arr)</th>
                <th style={{ padding: "8px 12px" }}>Energy Consumption</th>
                <th style={{ padding: "8px 12px" }}>SOC Departure</th>
                <th style={{ padding: "8px 12px" }}>SOC Arrival</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => onRevealLine?.(t.line, `Trip ${t.id}`)}
                  style={{
                    borderBottom: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    backgroundColor: selectedTripId === t.id ? "var(--ms-brand-soft)" : "transparent",
                  }}
                >
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 600 }}>{t.id}</td>
                  <td style={{ padding: "8px 12px" }}>{t.routeId}</td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontFamily: "monospace",
                      color: "var(--fgColor-accent, var(--ms-brand))",
                    }}
                  >
                    {t.vehicleId}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                    {Math.floor(t.depTimeH)}:{String(Math.round((t.depTimeH % 1) * 60)).padStart(2, "0")} →{" "}
                    {Math.floor(t.arrTimeH)}:{String(Math.round((t.arrTimeH % 1) * 60)).padStart(2, "0")}
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{t.energyKwh.toFixed(1)} kWh</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", color: "#3fb950" }}>
                    {Math.round(t.batteryStartSoc * 100)}%
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontFamily: "monospace",
                      color: t.batteryEndSoc < 0.3 ? "#f85149" : "#3fb950",
                    }}
                  >
                    {Math.round(t.batteryEndSoc * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
