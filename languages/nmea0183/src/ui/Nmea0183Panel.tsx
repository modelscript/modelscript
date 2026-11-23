// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { renderNmea0183SkyplotSvg, renderNmea0183Svg, renderNmea0183TrackSvg } from "../diagram/index.js";
import { lintNmea0183 } from "../lints/index.js";
import { parseNmea0183 } from "../parser/index.js";
import { nmea0183ToCsv, nmea0183ToGpx } from "../projections/index.js";
import { solveNmeaTrack } from "../solver/index.js";

type NmeaTabId = "overview" | "track" | "skyplot" | "sentences" | "satellites" | "lints";

export const Nmea0183Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<NmeaTabId>("overview");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        track: null,
        lints: [] as ReturnType<typeof lintNmea0183>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseNmea0183(code);
      const track = solveNmeaTrack(doc);
      const lints = lintNmea0183(doc);
      return { doc, track, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        track: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "NMEA 0183 GPS & Marine Telemetry";

  const overviewSvg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderNmea0183Svg(computed.doc);
    } catch {
      return "";
    }
  }, [computed.doc]);

  const trackSvg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderNmea0183TrackSvg(computed.doc);
    } catch {
      return "";
    }
  }, [computed.doc]);

  const skyplotSvg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderNmea0183SkyplotSvg(computed.doc);
    } catch {
      return "";
    }
  }, [computed.doc]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const fixCount = computed.track?.epochs.length ?? 0;
    const distM = computed.track?.totalDistanceVincentyM ?? 0;
    const satCount = computed.doc?.satellites.length ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Fixes", value: fixCount, tone: fixCount > 0 ? "info" : "neutral" },
      { label: "Distance", value: distM >= 1000 ? `${(distM / 1000).toFixed(2)} km` : `${distM.toFixed(1)} m` },
      { label: "Satellites", value: satCount, tone: satCount >= 4 ? "success" : "neutral" },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, computed.track, computed.lints]);

  const activeSvg = activeTab === "track" ? trackSvg : activeTab === "skyplot" ? skyplotSvg : overviewSvg;

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NMEA 0183 Marine & GNSS"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "NMEA 0183", tone: "info" }}
        actions={
          <>
            {(activeTab === "overview" || activeTab === "track" || activeTab === "skyplot") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`nmea0183-${activeTab}.svg`, activeSvg, "image/svg+xml")}
                disabled={!activeSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {host.exportFile && computed.doc && (
              <>
                <PanelButton
                  onClick={() =>
                    host.exportFile?.("track.gpx", nmea0183ToGpx(computed.doc!, title), "application/gpx+xml")
                  }
                >
                  Export GPX
                </PanelButton>
                <PanelButton onClick={() => host.exportFile?.("track.csv", nmea0183ToCsv(computed.doc!), "text/csv")}>
                  Export CSV
                </PanelButton>
              </>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "nmea0183", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<NmeaTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "overview", label: "Track & Skyplot" },
          { id: "track", label: "2D Track", count: computed.track?.epochs.length ?? 0 },
          { id: "skyplot", label: "Skyplot", count: computed.doc?.satellites.length ?? 0 },
          { id: "sentences", label: "Sentences", count: computed.doc?.sentences.length ?? 0 },
          { id: "satellites", label: "Satellites", count: computed.doc?.satellites.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {(activeTab === "overview" || activeTab === "track" || activeTab === "skyplot") && (
        <PanelSvgStage
          svg={activeSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an NMEA 0183 (.nmea / .gps) log to render the track and skyplot."}
        />
      )}

      {activeTab === "sentences" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Line</th>
                <th style={{ padding: "5px 6px" }}>Address</th>
                <th style={{ padding: "5px 6px" }}>Checksum</th>
                <th style={{ padding: "5px 6px" }}>Fields</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.sentences ?? []).map((s) => (
                <tr
                  key={`${s.line}-${s.index}`}
                  onClick={() => host.onRevealLine?.(s.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.line}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{`${s.delimiter}${s.address}`}</td>
                  <td style={{ padding: "4px 6px", color: s.checksumValid ? "#22c55e" : "#ef4444" }}>
                    {s.checksumProvided ? `*${s.checksumProvided}` : "missing"}
                  </td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.fields.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "satellites" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Talker</th>
                <th style={{ padding: "5px 6px" }}>PRN</th>
                <th style={{ padding: "5px 6px" }}>Elevation (°)</th>
                <th style={{ padding: "5px 6px" }}>Azimuth (°)</th>
                <th style={{ padding: "5px 6px" }}>SNR (dB-Hz)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.satellites ?? []).map((sat, idx) => (
                <tr
                  key={`${sat.talker}-${sat.prn}-${idx}`}
                  onClick={() => host.onRevealLine?.(sat.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: host.onRevealLine ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{sat.talker}</td>
                  <td style={{ padding: "4px 6px" }}>{sat.prn}</td>
                  <td style={{ padding: "4px 6px" }}>{sat.elevationDeg ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{sat.azimuthDeg ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{sat.snrDbHz ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No NMEA 0183 telemetry diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${d.line}-${idx}`}
                onClick={() => host.onRevealLine?.(d.line)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: host.onRevealLine ? "pointer" : "default",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}] L{d.line}
                </span>
                <span>{d.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default Nmea0183Panel;
