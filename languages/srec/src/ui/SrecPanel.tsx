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
import { renderSrecMemoryMapSvg } from "../diagram/index.js";
import { lintSrec } from "../lints/index.js";
import { decodeHeaderAscii, parseSrec } from "../parser/index.js";
import { srecToIntelHex } from "../projections/index.js";
import { solveSrecMemory } from "../solver/index.js";

type SrecTabId = "memoryMap" | "hexDump" | "records" | "lints";

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, "0");
}

function formatAscii(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    out += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
  }
  return out;
}

export const SrecPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<SrecTabId>("memoryMap");
  const [selectedRegion, setSelectedRegion] = useState<number>(0);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        file: null,
        solved: null,
        lints: [] as ReturnType<typeof lintSrec>,
        error: undefined as string | undefined,
      };
    }
    try {
      const file = parseSrec(code);
      const solved = solveSrecMemory(file);
      const lints = lintSrec(file);
      return { file, solved, lints, error: undefined };
    } catch (err) {
      return {
        file: null,
        solved: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.file?.headerText ||
    computed.file?.name ||
    "Motorola S-Record Image";

  const svg = useMemo(() => {
    if (!computed.file) return "";
    try {
      return renderSrecMemoryMapSvg(computed.file);
    } catch {
      return "";
    }
  }, [computed.file]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const regions = computed.solved?.regions.length ?? 0;
    const totalBytes = computed.solved?.totalDataBytes ?? 0;
    const crc = computed.solved ? `0x${hex(computed.solved.overallCrc32, 8)}` : "—";
    const diagCount = computed.lints.length;
    return [
      { label: "Regions", value: regions, tone: "info" },
      { label: "Payload", value: `${totalBytes} B` },
      { label: "CRC-32", value: crc },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.solved, computed.lints]);

  const activeRegion = useMemo(() => {
    const regions = computed.solved?.regions ?? [];
    if (regions.length === 0) return null;
    return regions[Math.min(selectedRegion, regions.length - 1)] ?? regions[0]!;
  }, [computed.solved, selectedRegion]);

  const hexRows = useMemo(() => {
    if (!activeRegion) return [];
    const rows: Array<{ addr: string; hexCols: string; ascii: string }> = [];
    const maxBytes = Math.min(activeRegion.data.length, 4096);
    for (let offset = 0; offset < maxBytes; offset += 16) {
      const slice = activeRegion.data.subarray(offset, Math.min(offset + 16, maxBytes));
      const parts: string[] = [];
      for (let i = 0; i < 16; i++) {
        parts.push(i < slice.length ? hex(slice[i]!, 2) : "  ");
      }
      rows.push({
        addr: hex(activeRegion.startAddress + offset, 8),
        hexCols: `${parts.slice(0, 8).join(" ")}  ${parts.slice(8).join(" ")}`,
        ascii: formatAscii(slice),
      });
    }
    return rows;
  }, [activeRegion]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="Motorola S-Record (SREC)"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "SREC", tone: "info" }}
        actions={
          <>
            {activeTab === "memoryMap" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("srec-memory-map.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {host.exportFile && computed.file && (
              <PanelButton
                onClick={() => host.exportFile?.("firmware.hex", srecToIntelHex(computed.file!), "text/plain")}
              >
                Export Intel HEX
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "srec", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<SrecTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "memoryMap", label: "Memory Map" },
          { id: "hexDump", label: "Hex / ASCII", count: computed.solved?.regions.length ?? 0 },
          { id: "records", label: "Records", count: computed.file?.records.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "memoryMap" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a Motorola S-Record (.srec / .s19 / .s28 / .s37) image to inspect."}
        />
      )}

      {activeTab === "hexDump" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.solved?.regions.length ?? 0) > 1 && (
            <div style={{ display: "flex", gap: "6px", marginBottom: "8px", flexWrap: "wrap" }}>
              {computed.solved!.regions.map((r) => (
                <PanelButton
                  key={r.index}
                  variant={activeRegion?.index === r.index ? "primary" : "default"}
                  onClick={() => setSelectedRegion(r.index)}
                >
                  R{r.index}: 0x{hex(r.startAddress, 8)} ({r.size} B)
                </PanelButton>
              ))}
            </div>
          )}
          {hexRows.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No binary data records to display.</div>
          ) : (
            <table
              style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "var(--ms-font-mono)" }}
            >
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "4px 6px" }}>Address</th>
                  <th style={{ padding: "4px 6px" }}>Hex Bytes (00..0F)</th>
                  <th style={{ padding: "4px 6px" }}>ASCII</th>
                </tr>
              </thead>
              <tbody>
                {hexRows.map((row) => (
                  <tr key={row.addr} style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                    <td style={{ padding: "3px 6px", color: "var(--ms-text-2)" }}>0x{row.addr}</td>
                    <td style={{ padding: "3px 6px", whiteSpace: "pre" }}>{row.hexCols}</td>
                    <td style={{ padding: "3px 6px", whiteSpace: "pre", color: "var(--ms-text-2)" }}>{row.ascii}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "records" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "var(--ms-font-mono)" }}
          >
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Line</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Address</th>
                <th style={{ padding: "5px 6px" }}>Len</th>
                <th style={{ padding: "5px 6px" }}>Checksum</th>
                <th style={{ padding: "5px 6px" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {(computed.file?.records ?? []).map((r) => (
                <tr
                  key={`${r.line}-${r.type}`}
                  onClick={() => host.onRevealLine?.(r.line)}
                  style={{ borderBottom: "1px solid var(--ms-divider)", cursor: "pointer" }}
                >
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{r.line}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{r.type}</td>
                  <td style={{ padding: "4px 6px" }}>0x{hex(r.address, r.addressBytes * 2)}</td>
                  <td style={{ padding: "4px 6px" }}>{r.data.length} B</td>
                  <td style={{ padding: "4px 6px", color: r.checksumValid ? "#22c55e" : "#ef4444" }}>
                    0x{hex(r.checksum, 2)} {r.checksumValid ? "OK" : `(exp 0x${hex(r.computedChecksum, 2)})`}
                  </td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                    {r.type === "S0" ? decodeHeaderAscii(r.data) : `${r.addressBytes * 8}-bit`}
                  </td>
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
            <div style={{ color: "var(--ms-text-2)" }}>No Motorola S-Record lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                onClick={() => host.onRevealLine?.(d.line)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}] (L{d.line})
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

export default SrecPanel;
