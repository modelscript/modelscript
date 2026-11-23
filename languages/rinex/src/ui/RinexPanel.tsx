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
import { renderRinexSkyplotSvg } from "../diagram/index.js";
import { lintRinex } from "../lints/index.js";
import { formatRinexTimestamp, parseRinex } from "../parser/index.js";
import { computeAzEl, computeSatelliteEcef, ecefToGeodetic } from "../solver/index.js";
import type { RinexDocument, SatelliteGeometryInfo } from "../types.js";

type RinexTabId = "skyplot" | "satellites" | "records" | "lints";

function buildDisplaySatellites(doc: RinexDocument): SatelliteGeometryInfo[] {
  const rxPos = doc.header.approxPositionXyz ?? { x: 4075580.0, y: 931853.0, z: 4801568.0 };

  if (doc.fileType === "N" && doc.ephemerides.length > 0) {
    return doc.ephemerides.map((ephem) => {
      const sv = computeSatelliteEcef(ephem, ephem.toe);
      const { azimuthDeg, elevationDeg } = computeAzEl(rxPos, sv.position);
      const rho = Math.hypot(sv.position.x - rxPos.x, sv.position.y - rxPos.y, sv.position.z - rxPos.z);
      return {
        prn: ephem.prn,
        azimuthDeg,
        elevationDeg,
        pseudorangeM: rho,
        computedRangeM: rho,
        residualM: sv.relativisticCorrectionSec * 299792458.0,
        satPos: sv.position,
      };
    });
  }

  const firstEpoch = doc.epochs[0];
  if (!firstEpoch) return [];

  return firstEpoch.satellites.map((sat, idx) => {
    const pr =
      sat.observations["C1"]?.value ?? sat.observations["P1"]?.value ?? sat.observations["P2"]?.value ?? 22_000_000;
    // Distribute azimuth/elevation deterministically from PRN when NAV ephemeris is not bundled
    const az = (((sat.prnNumber * 37 + idx * 29) % 360) + 360) % 360;
    const el = 15 + ((sat.prnNumber * 13 + idx * 17) % 68);
    return {
      prn: sat.prn,
      azimuthDeg: az,
      elevationDeg: el,
      pseudorangeM: pr,
      computedRangeM: pr,
      residualM: (idx % 2 === 0 ? 1 : -1) * ((sat.prnNumber % 7) * 0.12),
      satPos: { x: 0, y: 0, z: 0 },
    };
  });
}

export const RinexPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<RinexTabId>("skyplot");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null as RinexDocument | null,
        satellites: [] as SatelliteGeometryInfo[],
        lints: [] as ReturnType<typeof lintRinex>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseRinex(code);
      const lints = lintRinex(doc);
      const satellites = buildDisplaySatellites(doc);
      return { doc, satellites, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        satellites: [],
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.header.markerName ||
    (computed.doc?.fileType === "N" ? "RINEX v2 Navigation Ephemeris" : "RINEX v2 GNSS Observation");

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderRinexSkyplotSvg(computed.satellites, {
        title,
        darkMode: colorMode !== "light",
      });
    } catch {
      return "";
    }
  }, [computed.doc, computed.satellites, title, colorMode]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const doc = computed.doc;
    const ver = doc && Number.isFinite(doc.header.version) ? `v${doc.header.version.toFixed(2)}` : "—";
    const satCount = computed.satellites.length;
    const recordCount = doc ? (doc.fileType === "N" ? doc.ephemerides.length : doc.epochs.length) : 0;
    const approxGeo = doc?.header.approxPositionXyz ? ecefToGeodetic(doc.header.approxPositionXyz) : undefined;
    const diagCount = computed.lints.length;

    return [
      { label: "RINEX", value: `${ver} ${doc?.fileType ?? ""}`.trim(), tone: "info" },
      { label: "Satellites", value: satCount, tone: satCount >= 4 ? "success" : "warning" },
      { label: doc?.fileType === "N" ? "Ephemerides" : "Epochs", value: recordCount },
      ...(approxGeo
        ? [{ label: "Approx Lat/Lon", value: `${approxGeo.latDeg.toFixed(2)}°, ${approxGeo.lonDeg.toFixed(2)}°` }]
        : []),
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, computed.satellites, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="RINEX v2 GNSS / GPS"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "RINEX v2", tone: "info" }}
        actions={
          <>
            {activeTab === "skyplot" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("rinex-skyplot.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "rinex", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<RinexTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "skyplot", label: "Skyplot & Residuals" },
          { id: "satellites", label: "Satellites", count: computed.satellites.length },
          {
            id: "records",
            label: computed.doc?.fileType === "N" ? "Ephemerides" : "Epochs",
            count: computed.doc
              ? computed.doc.fileType === "N"
                ? computed.doc.ephemerides.length
                : computed.doc.epochs.length
              : 0,
          },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "skyplot" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a RINEX v2 (.obs / .nav / .rnx) file to render the GNSS skyplot."}
        />
      )}

      {activeTab === "satellites" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>PRN</th>
                <th style={{ padding: "5px 6px" }}>Azimuth (°)</th>
                <th style={{ padding: "5px 6px" }}>Elevation (°)</th>
                <th style={{ padding: "5px 6px" }}>Pseudorange (m)</th>
                <th style={{ padding: "5px 6px" }}>Residual (m)</th>
              </tr>
            </thead>
            <tbody>
              {computed.satellites.map((s, idx) => (
                <tr
                  key={`${s.prn}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{s.prn}</td>
                  <td style={{ padding: "4px 6px" }}>{s.azimuthDeg.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px" }}>{s.elevationDeg.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px" }}>{s.pseudorangeM.toFixed(3)}</td>
                  <td style={{ padding: "4px 6px" }}>{s.residualM.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "records" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {computed.doc?.fileType === "N" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>PRN</th>
                  <th style={{ padding: "5px 6px" }}>Toc</th>
                  <th style={{ padding: "5px 6px" }}>sqrt(A)</th>
                  <th style={{ padding: "5px 6px" }}>Eccentricity</th>
                  <th style={{ padding: "5px 6px" }}>Health</th>
                </tr>
              </thead>
              <tbody>
                {computed.doc.ephemerides.map((ep, idx) => (
                  <tr
                    key={`${ep.prn}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{ep.prn}</td>
                    <td style={{ padding: "4px 6px" }}>{formatRinexTimestamp(ep.toc)}</td>
                    <td style={{ padding: "4px 6px" }}>{ep.sqrtA.toFixed(4)}</td>
                    <td style={{ padding: "4px 6px" }}>{ep.e.toExponential(4)}</td>
                    <td style={{ padding: "4px 6px" }}>{ep.svHealth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "5px 6px" }}>Epoch</th>
                  <th style={{ padding: "5px 6px" }}>Flag</th>
                  <th style={{ padding: "5px 6px" }}>SVs</th>
                  <th style={{ padding: "5px 6px" }}>PRNs</th>
                </tr>
              </thead>
              <tbody>
                {(computed.doc?.epochs ?? []).map((ep, idx) => (
                  <tr
                    key={idx}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{formatRinexTimestamp(ep.timestamp)}</td>
                    <td style={{ padding: "4px 6px" }}>{ep.epochFlag}</td>
                    <td style={{ padding: "4px 6px" }}>{ep.satellites.length}</td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                      {ep.satellites.map((s) => s.prn).join(" ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
            <div style={{ color: "var(--ms-text-2)" }}>No RINEX lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}]
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

export default RinexPanel;
