// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import { applySplices, parsePscx, planPscadEdits } from "../index.js";

export interface PscadScriptSegmentsPanelProps {
  code: string;
  colorMode: "light" | "dark";
  onCodeChange?: ((nextCode: string) => void) | undefined;
}

const STANDARD_SEGMENTS = [
  "Computations",
  "Dsdyn",
  "Dsout",
  "Fortran",
  "C",
  "Checks",
  "Branch",
  "Transformers",
  "Matrix-Fill",
  "FlyBy",
];

export const PscadScriptSegmentsPanel: React.FC<PscadScriptSegmentsPanelProps> = ({
  code,
  colorMode,
  onCodeChange,
}) => {
  const isDark = colorMode === "dark";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#121214" : "#f6f8fa";
  const cardBg = isDark ? "#1b1d22" : "#ffffff";
  const muted = isDark ? "#8b949e" : "#57606a";

  const { definitions, parsedSettings } = useMemo(() => {
    try {
      const proj = parsePscx(code);
      const list: { name: string; segments: Record<string, string> }[] = [];
      const seen = new Set<string>();
      const canonName = (raw: string) => STANDARD_SEGMENTS.find((s) => s.toLowerCase() === raw.toLowerCase()) ?? raw;

      const rootSegs: Record<string, string> = {};
      if (proj.rootModule?.name) seen.add(proj.rootModule.name);
      const mainDef = proj.definitions?.get(proj.rootModule?.name || "Main") ?? proj.definitions?.get("Main");
      if (mainDef?.scriptSegments) {
        for (const [k, v] of mainDef.scriptSegments.entries()) {
          rootSegs[canonName(k)] = typeof v === "string" ? v : v.content;
        }
      }
      list.push({ name: proj.rootModule?.name || "Main", segments: rootSegs });

      for (const [defName, def] of proj.definitions?.entries() ?? []) {
        if (seen.has(defName)) continue;
        seen.add(defName);
        const segs: Record<string, string> = {};
        if (def.scriptSegments) {
          for (const [k, v] of def.scriptSegments.entries()) {
            segs[canonName(k)] = typeof v === "string" ? v : v.content;
          }
        }
        list.push({ name: defName, segments: segs });
      }
      return { definitions: list, parsedSettings: proj.settings };
    } catch {
      return { definitions: [], parsedSettings: null };
    }
  }, [code]);

  const [timeStepUs, setTimeStepUs] = useState(50);
  const [plotStepUs, setPlotStepUs] = useState(50);
  const [durationSec, setDurationSec] = useState(0.2);
  const [freqHz, setFreqHz] = useState(60);

  useEffect(() => {
    if (!parsedSettings) return;
    setTimeStepUs(parsedSettings.timeStepUs || 50);
    setPlotStepUs(parsedSettings.plotStepUs || parsedSettings.timeStepUs || 50);
    setDurationSec(parsedSettings.durationSec || 0.2);
    setFreqHz(parsedSettings.frequencyHz || 60);
  }, [parsedSettings]);

  const [selectedDef, setSelectedDef] = useState<string>(() => definitions[0]?.name || "");
  const activeDef = useMemo(
    () => definitions.find((d) => d.name === selectedDef) ?? definitions[0],
    [definitions, selectedDef],
  );

  const availableSegments = useMemo(() => {
    const keys = new Set<string>(Object.keys(activeDef?.segments ?? {}));
    for (const s of STANDARD_SEGMENTS) keys.add(s);
    return Array.from(keys);
  }, [activeDef]);

  const [selectedSeg, setSelectedSeg] = useState<string>(() => {
    const existing = Object.keys(activeDef?.segments ?? {});
    return existing[0] || "Dsdyn";
  });

  const [draftCode, setDraftCode] = useState<string>("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraftCode(activeDef?.segments[selectedSeg] ?? "");
  }, [activeDef, selectedSeg]);

  const handleApplySettings = () => {
    if (!onCodeChange) return;
    const plan = planPscadEdits(code, [
      {
        type: "setProjectSettings",
        settings: {
          time_step: timeStepUs,
          sample_step: plotStepUs,
          time_duration: durationSec,
          f_base: freqHz,
        },
      },
    ]);
    if (plan.errors.length > 0) {
      setStatusMsg(plan.errors.join("; "));
      return;
    }
    onCodeChange(applySplices(code, plan.splices));
    setStatusMsg("Updated project simulation settings.");
  };

  const handleApply = () => {
    if (!activeDef || !onCodeChange) return;
    const plan = planPscadEdits(code, [
      {
        type: "setScriptSegment",
        definition: activeDef.name,
        segment: selectedSeg,
        code: draftCode,
      },
    ]);
    if (plan.errors.length > 0) {
      setStatusMsg(plan.errors.join("; "));
      return;
    }
    const nextXml = applySplices(code, plan.splices);
    onCodeChange(nextXml);
    setStatusMsg(`Saved <segment name="${selectedSeg}"> in ${activeDef.name}.`);
  };

  if (definitions.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: bg,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          paddingBottom: 8,
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
          <strong style={{ fontSize: 12 }}>Project Settings</strong>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: muted }}>
            Δt (µs):
            <input
              type="number"
              value={timeStepUs}
              min={1}
              onChange={(e) => setTimeStepUs(Math.max(1, Number(e.target.value) || 50))}
              style={{
                width: 54,
                padding: "2px 4px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: muted }}>
            Plot (µs):
            <input
              type="number"
              value={plotStepUs}
              min={1}
              onChange={(e) => setPlotStepUs(Math.max(1, Number(e.target.value) || 50))}
              style={{
                width: 54,
                padding: "2px 4px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: muted }}>
            Duration (s):
            <input
              type="number"
              step={0.05}
              value={durationSec}
              min={0.01}
              onChange={(e) => setDurationSec(Math.max(0.01, Number(e.target.value) || 0.2))}
              style={{
                width: 58,
                padding: "2px 4px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: muted }}>
            f₀ (Hz):
            <input
              type="number"
              value={freqHz}
              onChange={(e) => setFreqHz(Number(e.target.value) || 60)}
              style={{
                width: 48,
                padding: "2px 4px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            />
          </label>
        </div>
        {onCodeChange && (
          <button
            type="button"
            onClick={handleApplySettings}
            style={{
              padding: "3px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              border: `1px solid ${borderColor}`,
              background: cardBg,
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Save Settings
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5 }}>PSCAD Script Segments</strong>
          <select
            value={activeDef?.name ?? ""}
            onChange={(e) => setSelectedDef(e.target.value)}
            aria-label="Select PSCAD Definition"
            style={{
              fontSize: 11.5,
              padding: "3px 8px",
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: cardBg,
              color: "inherit",
            }}
          >
            {definitions.map((d) => (
              <option key={d.name} value={d.name}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        {onCodeChange && (
          <button
            type="button"
            onClick={handleApply}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 600,
              border: "none",
              background: "var(--ms-brand, #2f81f7)",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Apply Segment
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {availableSegments.map((seg) => {
          const hasContent = Boolean(activeDef?.segments[seg]?.trim());
          const isSel = seg === selectedSeg;
          return (
            <button
              key={seg}
              type="button"
              onClick={() => setSelectedSeg(seg)}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                fontSize: 11,
                fontWeight: isSel ? 700 : 500,
                border: `1px solid ${isSel ? "var(--ms-brand, #2f81f7)" : borderColor}`,
                background: isSel ? "var(--ms-brand-soft, rgba(47,129,247,0.15))" : cardBg,
                color: isSel ? "var(--ms-brand, #2f81f7)" : hasContent ? "inherit" : muted,
                cursor: "pointer",
              }}
            >
              {seg}
              {hasContent ? " •" : ""}
            </button>
          );
        })}
      </div>

      <textarea
        value={draftCode}
        onChange={(e) => setDraftCode(e.target.value)}
        readOnly={!onCodeChange}
        spellCheck={false}
        placeholder={`Enter ${selectedSeg} code for ${activeDef?.name ?? "definition"}...`}
        style={{
          width: "100%",
          minHeight: 160,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 12,
          lineHeight: 1.45,
          padding: 10,
          borderRadius: 6,
          border: `1px solid ${borderColor}`,
          background: cardBg,
          color: "inherit",
          resize: "vertical",
          boxSizing: "border-box",
        }}
      />

      {statusMsg && <div style={{ fontSize: 11, color: muted }}>{statusMsg}</div>}
    </div>
  );
};
