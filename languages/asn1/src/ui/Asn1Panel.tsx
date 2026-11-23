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
import { renderAsn1DiagramSvg, renderBerTlvSvg } from "../diagram/index.js";
import { lintAsn1 } from "../lints/index.js";
import { parseAsn1 } from "../parser/asn1-parser.js";
import { bytesToHex, decodeBer, encodeDer, formatBerTagName, hexToBytes } from "../parser/ber-der.js";
import { computeWireSizeBounds } from "../solver/wire-analyzer.js";
import type { BerTlvNode } from "../types.js";

type Asn1TabId = "graph" | "tlv" | "types" | "lints";

const PRESET_DER_PAYLOADS: Array<{ label: string; hex: string }> = [
  {
    label: "X.509 RSA AlgorithmIdentifier",
    hex: bytesToHex(
      encodeDer({
        kind: "sequence",
        items: [{ kind: "oid", value: "1.2.840.113549.1.1.1" }, { kind: "null" }],
      }),
    ),
  },
  {
    label: "SNMPv1 Envelope (v1, 'public')",
    hex: bytesToHex(
      encodeDer({
        kind: "sequence",
        items: [
          { kind: "integer", value: 0 },
          { kind: "octetString", value: new TextEncoder().encode("public") },
          {
            kind: "tagged",
            tagClass: "CONTEXT",
            tagNumber: 0,
            constructed: true,
            inner: {
              kind: "sequence",
              items: [
                { kind: "integer", value: 1024 },
                { kind: "integer", value: 0 },
                { kind: "integer", value: 0 },
              ],
            },
          },
        ],
      }),
    ),
  },
  {
    label: "Non-Canonical BER (0x01 Boolean)",
    hex: "30 06 01 01 01 02 01 2A",
  },
];

function flattenTlvTree(root: BerTlvNode): Array<{ node: BerTlvNode; depth: number }> {
  const out: Array<{ node: BerTlvNode; depth: number }> = [];
  const walk = (n: BerTlvNode, depth: number): void => {
    out.push({ node: n, depth });
    if (n.children) {
      for (const c of n.children) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

export const Asn1Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Asn1TabId>("graph");
  const [tlvHex, setTlvHex] = useState<string>(PRESET_DER_PAYLOADS[0]!.hex);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        model: null,
        lints: [] as ReturnType<typeof lintAsn1>,
        bounds: new Map() as ReturnType<typeof computeWireSizeBounds>,
        error: undefined as string | undefined,
      };
    }
    try {
      const model = parseAsn1(code);
      const lints = lintAsn1(model);
      const bounds = computeWireSizeBounds(model);
      return { model, lints, bounds, error: undefined };
    } catch (err) {
      return {
        model: null,
        lints: [],
        bounds: new Map() as ReturnType<typeof computeWireSizeBounds>,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const tlvDecoded = useMemo(() => {
    try {
      const bytes = hexToBytes(tlvHex);
      const res = decodeBer(bytes);
      const svg = res.root ? renderBerTlvSvg(res.root) : "";
      const rows = res.root ? flattenTlvTree(res.root) : [];
      return { bytes, res, svg, rows, parseError: undefined as string | undefined };
    } catch (err) {
      return {
        bytes: new Uint8Array(0),
        res: null,
        svg: "",
        rows: [] as Array<{ node: BerTlvNode; depth: number }>,
        parseError: err instanceof Error ? err.message : String(err),
      };
    }
  }, [tlvHex]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.name ||
    "ASN.1 Schema & BER/DER Inspector";

  const graphSvg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderAsn1DiagramSvg(computed.model, tlvDecoded.res?.root ?? undefined);
    } catch {
      return "";
    }
  }, [computed.model, tlvDecoded.res?.root]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const typeCount = computed.model?.types.length ?? 0;
    const tagMode = computed.model?.tagDefault ?? "EXPLICIT";
    const diagCount = computed.lints.length;
    const tlvLen = tlvDecoded.bytes.length;
    return [
      { label: "ASN.1 Types", value: typeCount, tone: "info" },
      { label: "Tag Mode", value: tagMode },
      { label: "Sample TLV", value: `${tlvLen} B` },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.model, computed.lints, tlvDecoded.bytes.length]);

  const activeSvg = activeTab === "tlv" ? tlvDecoded.svg : graphSvg;

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ISO/ITU-T X.680 ASN.1 · X.690 BER/DER"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "ASN.1", tone: "info" }}
        actions={
          <>
            {(activeTab === "graph" || activeTab === "tlv") && host.exportFile && (
              <PanelButton
                onClick={() =>
                  host.exportFile?.(activeTab === "tlv" ? "asn1-tlv.svg" : "asn1-graph.svg", activeSvg, "image/svg+xml")
                }
                disabled={!activeSvg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "asn1", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Asn1TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "graph", label: "Type Graph" },
          { id: "tlv", label: "BER/DER TLV Inspector", count: tlvDecoded.rows.length },
          { id: "types", label: "Types", count: computed.model?.types.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "graph" && (
        <PanelSvgStage
          svg={graphSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ?? "Load an ASN.1 (.asn / .asn1 / .mib) module to render the type dependency graph."
          }
        />
      )}

      {activeTab === "tlv" && (
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
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            {PRESET_DER_PAYLOADS.map((p) => (
              <PanelButton key={p.label} onClick={() => setTlvHex(p.hex)}>
                {p.label}
              </PanelButton>
            ))}
          </div>
          <textarea
            aria-label="BER/DER Hex Payload"
            value={tlvHex}
            onChange={(e) => setTlvHex(e.target.value)}
            rows={2}
            style={{
              width: "100%",
              fontFamily: "var(--ms-font-mono)",
              fontSize: "11px",
              padding: "6px 8px",
              borderRadius: "6px",
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg-alt)",
              color: "var(--ms-text-1)",
            }}
          />
          {tlvDecoded.parseError && (
            <div style={{ color: "var(--ms-danger)", fontSize: "11px" }}>{tlvDecoded.parseError}</div>
          )}
          {tlvDecoded.res && tlvDecoded.res.derIssues.length > 0 && (
            <div
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--ms-warning)",
                background: "var(--ms-bg-alt)",
                fontSize: "11px",
              }}
            >
              <strong>DER Canonicality Warnings:</strong>{" "}
              {tlvDecoded.res.derIssues.map((iss) => `[${iss.code}] ${iss.message}`).join(" | ")}
            </div>
          )}
          {tlvDecoded.svg && (
            <div
              style={{ border: "1px solid var(--ms-border)", borderRadius: "6px", overflow: "auto" }}
              dangerouslySetInnerHTML={{ __html: tlvDecoded.svg }}
            />
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Offset</th>
                <th style={{ padding: "5px 6px" }}>Tag</th>
                <th style={{ padding: "5px 6px" }}>Length</th>
                <th style={{ padding: "5px 6px" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {tlvDecoded.rows.map(({ node, depth }, idx) => (
                <tr
                  key={`${node.offset}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>@{node.offset}</td>
                  <td style={{ padding: "4px 6px", paddingLeft: `${6 + depth * 12}px`, fontWeight: 600 }}>
                    {formatBerTagName(node)} ({bytesToHex(node.rawTagBytes, "")})
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {node.length} B ({node.lengthForm})
                  </td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                    {node.constructed
                      ? `{ ${node.children?.length ?? 0} children }`
                      : typeof node.decodedValue === "bigint"
                        ? node.decodedValue.toString()
                        : typeof node.decodedValue === "string" || typeof node.decodedValue === "boolean"
                          ? String(node.decodedValue)
                          : bytesToHex(node.valueBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "types" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Kind</th>
                <th style={{ padding: "5px 6px" }}>BER/DER Size</th>
                <th style={{ padding: "5px 6px" }}>TLV Overhead</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.types ?? []).map((t, idx) => {
                const b = computed.bounds.get(t.name);
                return (
                  <tr
                    key={`${t.name}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: "4px 6px" }}>{t.type.kind.toUpperCase()}</td>
                    <td style={{ padding: "4px 6px" }}>
                      {b ? `${b.minBytes}..${b.maxBytes}${b.isUnbounded ? "+" : ""} B` : "—"}
                    </td>
                    <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                      {b ? `${b.minTlvOverhead}..${b.maxTlvOverhead} B` : "—"}
                    </td>
                  </tr>
                );
              })}
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
            <div style={{ color: "var(--ms-text-2)" }}>No ASN.1 lint diagnostics.</div>
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

export default Asn1Panel;
