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
import { renderArinc429Svg, renderArinc429WordSvg } from "../diagram/index.js";
import { lintArinc429 } from "../lints/index.js";
import { encodeArinc429Word, formatArinc429Hex } from "../parser/codec.js";
import { parseArinc429 } from "../parser/schema-parser.js";
import { analyzeBusUtilization, decodeFlightState } from "../solver/index.js";
import type { Arinc429Encoding, Arinc429SsmCode } from "../types.js";

type Arinc429TabId = "pfd" | "word" | "labels" | "frames" | "lints";

export const Arinc429Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Arinc429TabId>("pfd");
  const [selectedFrameIdx, setSelectedFrameIdx] = useState<number>(0);

  // Interactive 32-bit word encoder/inspector controls
  const [encLabel, setEncLabel] = useState<string>("203");
  const [encEncoding, setEncEncoding] = useState<Arinc429Encoding>("BNR");
  const [encSdi, setEncSdi] = useState<number>(0);
  const [encSsm, setEncSsm] = useState<Arinc429SsmCode>(3);
  const [encValue, setEncValue] = useState<string>("35000");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        doc: null,
        flight: null,
        util: null,
        lints: [] as ReturnType<typeof lintArinc429>,
        error: undefined as string | undefined,
      };
    }
    try {
      const doc = parseArinc429(code);
      const flight = decodeFlightState(doc);
      const util = analyzeBusUtilization(doc);
      const lints = lintArinc429(doc);
      return { doc, flight, util, lints, error: undefined };
    } catch (err) {
      return {
        doc: null,
        flight: null,
        util: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.busName ||
    "ARINC 429 Avionics Bus";

  const dashboardSvg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const safeIdx =
        computed.flight && computed.flight.decodedFrames.length > 0
          ? Math.min(selectedFrameIdx, computed.flight.decodedFrames.length - 1)
          : 0;
      return renderArinc429Svg(computed.doc, { selectedFrameIndex: safeIdx });
    } catch {
      return "";
    }
  }, [computed.doc, computed.flight, selectedFrameIdx]);

  const interactiveWord = useMemo(() => {
    try {
      const numVal = Number.parseFloat(encValue);
      const word = encodeArinc429Word({
        label: encLabel,
        encoding: encEncoding,
        sdi: encSdi,
        ssm: encSsm,
        value: Number.isFinite(numVal) ? numVal : 0,
      });
      return {
        word,
        hex: formatArinc429Hex(word),
        svg: renderArinc429WordSvg(word, { encoding: encEncoding }),
        error: undefined as string | undefined,
      };
    } catch (err) {
      return {
        word: 0,
        hex: "0x00000000",
        svg: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [encLabel, encEncoding, encSdi, encSsm, encValue]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const labelCount = computed.doc?.labels.length ?? 0;
    const frameCount = computed.doc?.frames.length ?? 0;
    const utilPct = computed.util ? `${computed.util.utilizationPct.toFixed(1)}%` : "0.0%";
    const diagCount = computed.lints.length;
    return [
      { label: "Bus Rate", value: computed.doc ? computed.doc.rate : "—", tone: "info" },
      { label: "Labels", value: labelCount },
      { label: "Frames", value: frameCount },
      {
        label: "Bus Load",
        value: utilPct,
        tone: computed.util?.overloaded ? "danger" : (computed.util?.utilizationPct ?? 0) > 80 ? "warning" : "success",
      },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, computed.util, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ARINC 429 Mark 33 DITS"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "ARINC 429", tone: "info" }}
        actions={
          <>
            {activeTab === "pfd" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("arinc429-pfd.svg", dashboardSvg, "image/svg+xml")}
                disabled={!dashboardSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "arinc429", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Arinc429TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "pfd", label: "PFD & Word" },
          { id: "word", label: "Word Builder" },
          { id: "labels", label: "Labels", count: computed.doc?.labels.length ?? 0 },
          { id: "frames", label: "Frames", count: computed.doc?.frames.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "pfd" && (
        <PanelSvgStage
          svg={dashboardSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ?? "Load an ARINC 429 (.a429) bus schema or trace to render the PFD and 32-bit word view."
          }
        />
      )}

      {activeTab === "word" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", fontSize: "11px" }}>
            <label>
              Label (octal):{" "}
              <input
                value={encLabel}
                onChange={(e) => setEncLabel(e.target.value)}
                style={{ width: "54px", fontFamily: "var(--ms-font-mono)" }}
              />
            </label>
            <label>
              Encoding:{" "}
              <select
                value={encEncoding}
                onChange={(e) => setEncEncoding(e.target.value as Arinc429Encoding)}
                style={{ fontFamily: "var(--ms-font-mono)" }}
              >
                <option value="BNR">BNR</option>
                <option value="BCD">BCD</option>
                <option value="DISCRETE">DISCRETE</option>
              </select>
            </label>
            <label>
              SDI:{" "}
              <select value={encSdi} onChange={(e) => setEncSdi(Number(e.target.value))}>
                <option value={0}>00 (0)</option>
                <option value={1}>01 (1)</option>
                <option value={2}>10 (2)</option>
                <option value={3}>11 (3)</option>
              </select>
            </label>
            <label>
              SSM:{" "}
              <select value={encSsm} onChange={(e) => setEncSsm(Number(e.target.value) as Arinc429SsmCode)}>
                <option value={3}>11</option>
                <option value={0}>00</option>
                <option value={1}>01 (NCD)</option>
                <option value={2}>10 (FT)</option>
              </select>
            </label>
            <label>
              Value:{" "}
              <input
                value={encValue}
                onChange={(e) => setEncValue(e.target.value)}
                style={{ width: "90px", fontFamily: "var(--ms-font-mono)" }}
              />
            </label>
            <span style={{ fontFamily: "var(--ms-font-mono)", fontWeight: 700 }}>{interactiveWord.hex}</span>
          </div>
          {interactiveWord.error ? (
            <div style={{ color: "var(--ms-danger)", fontSize: "11px" }}>{interactiveWord.error}</div>
          ) : (
            <PanelSvgStage svg={interactiveWord.svg} emptyMessage="Enter a valid octal label and value." />
          )}
        </div>
      )}

      {activeTab === "labels" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Label</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Encoding</th>
                <th style={{ padding: "5px 6px" }}>Range</th>
                <th style={{ padding: "5px 6px" }}>Units</th>
                <th style={{ padding: "5px 6px" }}>Rate (Hz)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.labels ?? []).map((l, idx) => (
                <tr
                  key={`${l.labelOctal}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{l.labelOctal}</td>
                  <td style={{ padding: "4px 6px" }}>{l.name}</td>
                  <td style={{ padding: "4px 6px" }}>{l.encoding}</td>
                  <td style={{ padding: "4px 6px" }}>{l.range ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{l.units ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{l.rateHz ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "frames" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>t (s)</th>
                <th style={{ padding: "5px 6px" }}>Word</th>
                <th style={{ padding: "5px 6px" }}>Label</th>
                <th style={{ padding: "5px 6px" }}>Value</th>
                <th style={{ padding: "5px 6px" }}>SSM</th>
                <th style={{ padding: "5px 6px" }}>Parity</th>
              </tr>
            </thead>
            <tbody>
              {(computed.flight?.decodedFrames ?? []).map((f, idx) => (
                <tr
                  key={idx}
                  onClick={() => {
                    setSelectedFrameIdx(idx);
                    setActiveTab("pfd");
                  }}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                  }}
                >
                  <td style={{ padding: "4px 6px" }}>{f.timestampSec.toFixed(3)}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{f.word.rawHex}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {f.word.labelOctal} {f.word.labelName}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {f.word.engineeringValue.toFixed(3)} {f.word.units}
                  </td>
                  <td style={{ padding: "4px 6px" }}>{f.word.ssmMeaning}</td>
                  <td style={{ padding: "4px 6px" }}>{f.word.parityValid ? "OK" : "ERR"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Code</th>
                <th style={{ padding: "5px 6px" }}>Severity</th>
                <th style={{ padding: "5px 6px" }}>Line</th>
                <th style={{ padding: "5px 6px" }}>Message</th>
              </tr>
            </thead>
            <tbody>
              {computed.lints.map((d, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{d.code}</td>
                  <td style={{ padding: "4px 6px" }}>{d.severity}</td>
                  <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-mono)" }}>{d.line}</td>
                  <td style={{ padding: "4px 6px" }}>{d.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default Arinc429Panel;
