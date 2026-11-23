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
import { renderIhexMemoryMapSvg } from "../diagram/index.js";
import { lintIhex } from "../lints/index.js";
import { hexByte, hexDword, parseIhex } from "../parser/index.js";
import { solveIhexImage } from "../solver/index.js";

type IhexTabId = "map" | "dump" | "segments" | "lints";

interface HexDumpRow {
  address: number;
  bytes: Array<number | null>;
  ascii: string;
}

function buildHexDumpRows(startAddress: number, data: Uint8Array, maxRows: number = 256): HexDumpRow[] {
  const rows: HexDumpRow[] = [];
  const alignedStart = startAddress & ~0xf;
  const endAddress = startAddress + data.length;

  for (let addr = alignedStart; addr < endAddress && rows.length < maxRows; addr += 16) {
    const bytes: Array<number | null> = [];
    let ascii = "";
    for (let col = 0; col < 16; col++) {
      const cur = addr + col;
      if (cur >= startAddress && cur < endAddress) {
        const val = data[cur - startAddress] ?? 0;
        bytes.push(val);
        ascii += val >= 0x20 && val <= 0x7e ? String.fromCharCode(val) : ".";
      } else {
        bytes.push(null);
        ascii += " ";
      }
    }
    rows.push({ address: addr >>> 0, bytes, ascii });
  }
  return rows;
}

export const IhexPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<IhexTabId>("map");
  const [selectedSegIdx, setSelectedSegIdx] = useState<number>(0);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        model: null,
        solved: null,
        lints: [] as ReturnType<typeof lintIhex>,
        error: undefined as string | undefined,
      };
    }
    try {
      const model = parseIhex(code);
      const solved = solveIhexImage(model);
      const lints = lintIhex(model);
      return { model, solved, lints, error: undefined };
    } catch (err) {
      return {
        model: null,
        solved: null,
        lints: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    (computed.model ? `Intel HEX (${computed.model.format})` : "Intel HEX Firmware Image");

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderIhexMemoryMapSvg(computed.model, { title });
    } catch {
      return "";
    }
  }, [computed.model, title]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const map = computed.solved?.memoryMap;
    const totalBytes = map?.totalDataBytes ?? 0;
    const segCount = map?.segments.length ?? 0;
    const crc = computed.solved ? `0x${hexDword(computed.solved.imageCrc32)}` : "—";
    const diagCount = computed.lints.length;
    return [
      { label: "Data Bytes", value: totalBytes, tone: "info" },
      { label: "Segments", value: segCount },
      { label: "CRC-32", value: crc },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.solved, computed.lints]);

  const segments = computed.solved?.memoryMap.segments ?? [];
  const activeSegment = segments[Math.min(selectedSegIdx, Math.max(0, segments.length - 1))];
  const dumpRows = useMemo(() => {
    if (!activeSegment) return [];
    return buildHexDumpRows(activeSegment.startAddress, activeSegment.data, 256);
  }, [activeSegment]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="Intel HEX Firmware Memory Map & Hex Dump"
        badge={
          computed.error
            ? { label: "Parse Error", tone: "danger" }
            : { label: computed.model?.format ?? "IHEX", tone: "info" }
        }
        actions={
          <>
            {activeTab === "map" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("ihex-memory-map.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "ihex", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<IhexTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "map", label: "Memory Map" },
          { id: "dump", label: "Hex / ASCII Dump", count: dumpRows.length },
          { id: "segments", label: "Segments", count: segments.length },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "map" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an Intel HEX (.hex / .ihx / .ihex) image to render the memory map."}
        />
      )}

      {activeTab === "dump" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", fontFamily: "monospace", fontSize: "11px" }}>
          {segments.length > 1 && (
            <div style={{ marginBottom: "8px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {segments.map((seg) => (
                <PanelButton
                  key={seg.index}
                  variant={seg.index === activeSegment?.index ? "primary" : undefined}
                  onClick={() => setSelectedSegIdx(seg.index)}
                >
                  SEG {seg.index}: 0x{hexDword(seg.startAddress)} ({seg.length} B)
                </PanelButton>
              ))}
            </div>
          )}
          {dumpRows.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)", padding: "12px 0" }}>No data bytes to display.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}
                >
                  <th style={{ padding: "4px 8px" }}>Offset</th>
                  <th style={{ padding: "4px 8px" }}>00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</th>
                  <th style={{ padding: "4px 8px" }}>ASCII</th>
                </tr>
              </thead>
              <tbody>
                {dumpRows.map((row) => {
                  const lo = row.bytes
                    .slice(0, 8)
                    .map((b) => (b === null ? "  " : hexByte(b)))
                    .join(" ");
                  const hi = row.bytes
                    .slice(8, 16)
                    .map((b) => (b === null ? "  " : hexByte(b)))
                    .join(" ");
                  return (
                    <tr key={row.address} style={{ borderBottom: "1px solid var(--ms-border)" }}>
                      <td style={{ padding: "3px 8px", color: "var(--ms-accent)" }}>0x{hexDword(row.address)}</td>
                      <td style={{ padding: "3px 8px", whiteSpace: "pre" }}>
                        {lo} {hi}
                      </td>
                      <td style={{ padding: "3px 8px", whiteSpace: "pre", color: "var(--ms-text-2)" }}>{row.ascii}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "segments" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Seg</th>
                <th style={{ padding: "5px 6px" }}>Start</th>
                <th style={{ padding: "5px 6px" }}>End</th>
                <th style={{ padding: "5px 6px" }}>Length</th>
                <th style={{ padding: "5px 6px" }}>CRC-32</th>
                <th style={{ padding: "5px 6px" }}>Fletcher-16</th>
                <th style={{ padding: "5px 6px" }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg) => (
                <tr
                  key={seg.index}
                  onClick={() => host.onRevealLine?.(seg.startLine)}
                  style={{ borderBottom: "1px solid var(--ms-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "5px 6px" }}>#{seg.index}</td>
                  <td style={{ padding: "5px 6px" }}>0x{hexDword(seg.startAddress)}</td>
                  <td style={{ padding: "5px 6px" }}>0x{hexDword(seg.endAddress)}</td>
                  <td style={{ padding: "5px 6px" }}>{seg.length} B</td>
                  <td style={{ padding: "5px 6px" }}>0x{hexDword(seg.crc32)}</td>
                  <td style={{ padding: "5px 6px" }}>0x{seg.fletcher16.toString(16).toUpperCase().padStart(4, "0")}</td>
                  <td style={{ padding: "5px 6px" }}>{seg.recordCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "lints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", fontSize: "11px" }}>
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)", padding: "12px 0" }}>
              No diagnostics — all Intel HEX records, checksums, and segments are valid.
            </div>
          ) : (
            computed.lints.map((diag, i) => (
              <div
                key={`${diag.code}-${diag.line}-${i}`}
                onClick={() => host.onRevealLine?.(diag.line)}
                style={{
                  padding: "6px 8px",
                  marginBottom: "6px",
                  borderRadius: "4px",
                  border: "1px solid var(--ms-border)",
                  cursor: "pointer",
                }}
              >
                <strong>[{diag.code}]</strong> ({diag.severity}) Line {diag.line}: {diag.message}
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default IhexPanel;
