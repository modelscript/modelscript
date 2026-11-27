// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  getContractHierarchyInAnsatz,
  getRequirementsInAnsatz,
  getRtmMatrixInAnsatz,
  type AnsatzContractHierarchyResult,
  type AnsatzRequirementItem,
  type AnsatzRtmMatrixResult,
} from "../util/lsp-bridge";

export interface AnsatzRtmContractsPanelProps {
  documentUri: string;
  colorMode: "light" | "dark";
  onRevealLine?: ((line: number) => void) | undefined;
}

type SubViewTab = "requirements" | "rtm" | "contracts";

interface NormalizedContractNode {
  name: string;
  role?: "system" | "component" | "contract" | undefined;
  status?: string | undefined;
  assumptions: string[];
  guarantees: string[];
  line?: number | undefined;
  children: NormalizedContractNode[];
}

interface NormalizedContractView {
  nodes: NormalizedContractNode[];
  isCompatible?: boolean | undefined;
  isRefined?: boolean | undefined;
  compatibilityViolations: string[];
  refinementViolations: string[];
  summary?: string | undefined;
  error?: string | undefined;
}

interface NormalizedRtmAxisItem {
  id: string;
  rawId?: string | number | undefined;
  name: string;
  subtitle?: string | undefined;
  domain?: string | undefined;
  line?: number | undefined;
}

interface NormalizedRtmLink {
  key: string;
  sourceId?: string | number | undefined;
  targetId?: string | number | undefined;
  sourceName?: string | undefined;
  targetName?: string | undefined;
  linkKind: string;
  status: string;
  isSuspect: boolean;
  line?: number | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const rec = asRecord(item);
      return asString(rec?.message) ?? asString(rec?.text) ?? asString(rec?.expression) ?? asString(rec?.name);
    })
    .filter((item): item is string => Boolean(item));
}

function offsetToLineNumber(source: string | undefined, offset: number): number | undefined {
  if (!source || !Number.isFinite(offset) || offset < 0) return undefined;
  const clamped = Math.min(offset, source.length);
  let line = 1;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function extractLine(item: unknown, sourceCode?: string): number | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;

  const directLine = asNumber(rec.line) ?? asNumber(rec.startLine);
  if (directLine !== undefined) return directLine;

  const range = asRecord(rec.range);
  const rangeStart = asRecord(range?.start);
  const rangeLine = asNumber(rangeStart?.line);
  if (rangeLine !== undefined) return rangeLine;

  const location = asRecord(rec.location);
  const locRange = asRecord(location?.range);
  const locStart = asRecord(locRange?.start);
  const locLine = asNumber(locStart?.line);
  if (locLine !== undefined) return locLine;

  const startOffset = asNumber(rec.startOffset) ?? asNumber(asRecord(rec.span)?.startOffset);
  if (startOffset !== undefined) {
    return offsetToLineNumber(sourceCode, startOffset);
  }
  return undefined;
}

function normalizeContractNode(
  raw: unknown,
  role?: "system" | "component" | "contract",
): NormalizedContractNode | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const name = asString(rec.name) ?? asString(rec.id) ?? asString(rec.title) ?? "Unnamed Contract";
  const assumptions = asStringArray(rec.assumptions ?? rec.assume);
  const guarantees = asStringArray(rec.guarantees ?? rec.guarantee);
  const status = asString(rec.status);
  const line = extractLine(rec);

  const rawChildren = Array.isArray(rec.children) ? rec.children : Array.isArray(rec.components) ? rec.components : [];
  const children = rawChildren
    .map((child) => normalizeContractNode(child, "component"))
    .filter((node): node is NormalizedContractNode => node !== null);

  return {
    name,
    role,
    status,
    assumptions,
    guarantees,
    line,
    children,
  };
}

function normalizeContractHierarchy(raw: AnsatzContractHierarchyResult | null): NormalizedContractView {
  if (!raw) {
    return {
      nodes: [],
      compatibilityViolations: [],
      refinementViolations: [],
    };
  }

  const rec = asRecord(raw);
  const hierarchy = asRecord(rec?.hierarchy) ?? rec;
  const error = asString(raw.error) ?? asString(hierarchy?.error);
  const summary = asString(hierarchy?.summary);
  const isCompatible = typeof hierarchy?.isCompatible === "boolean" ? hierarchy.isCompatible : undefined;
  const isRefined = typeof hierarchy?.isRefined === "boolean" ? hierarchy.isRefined : undefined;
  const compatibilityViolations = asStringArray(hierarchy?.compatibilityViolations);
  const refinementViolations = asStringArray(hierarchy?.refinementViolations);

  const nodes: NormalizedContractNode[] = [];

  if (hierarchy?.system) {
    const sysNode = normalizeContractNode(hierarchy.system, "system");
    if (sysNode) {
      const comps = Array.isArray(hierarchy.components)
        ? hierarchy.components
            .map((c) => normalizeContractNode(c, "component"))
            .filter((node): node is NormalizedContractNode => node !== null)
        : [];
      if (comps.length > 0) {
        sysNode.children = [...sysNode.children, ...comps];
      }
      const hasContent = sysNode.assumptions.length > 0 || sysNode.guarantees.length > 0 || sysNode.children.length > 0;
      if (hasContent || !summary) {
        nodes.push(sysNode);
      }
    }
  } else if (raw.root) {
    const rootNode = normalizeContractNode(raw.root, "system");
    if (rootNode) nodes.push(rootNode);
  }

  if (Array.isArray(raw.contracts)) {
    for (const c of raw.contracts) {
      const node = normalizeContractNode(c, "contract");
      if (node) nodes.push(node);
    }
  }

  return {
    nodes,
    isCompatible,
    isRefined,
    compatibilityViolations,
    refinementViolations,
    summary,
    error,
  };
}

function normalizeRtmAxis(items: unknown[]): NormalizedRtmAxisItem[] {
  return items.map((item, idx) => {
    if (typeof item === "string") {
      return { id: item, name: item };
    }
    const rec = asRecord(item);
    const meta = asRecord(rec?.metadata);
    const rawId = typeof rec?.id === "string" || typeof rec?.id === "number" ? (rec.id as string | number) : undefined;
    const name = asString(rec?.name) ?? asString(rec?.qualifiedName) ?? asString(meta?.reqId) ?? `Item ${idx + 1}`;
    const subtitle = asString(meta?.reqId) ?? asString(rec?.type) ?? asString(rec?.domain);
    return {
      id: rawId !== undefined ? String(rawId) : `${name}-${idx}`,
      rawId,
      name,
      subtitle: subtitle && subtitle !== name ? subtitle : undefined,
      domain: asString(rec?.domain),
      line: extractLine(rec),
    };
  });
}

function normalizeRtmLinks(linksObj: Record<string, unknown> | undefined): NormalizedRtmLink[] {
  if (!linksObj || typeof linksObj !== "object") return [];
  const out: NormalizedRtmLink[] = [];
  const seen = new Set<string>();
  for (const [key, val] of Object.entries(linksObj)) {
    const rec = asRecord(val);
    if (!rec) continue;
    const sourceId =
      typeof rec.sourceId === "string" || typeof rec.sourceId === "number"
        ? (rec.sourceId as string | number)
        : undefined;
    const targetId =
      typeof rec.targetId === "string" || typeof rec.targetId === "number"
        ? (rec.targetId as string | number)
        : undefined;
    const sourceName = asString(rec.sourceName);
    const targetName = asString(rec.targetName);
    const linkKind = asString(rec.linkKind) ?? asString(rec.kind) ?? "link";
    const dedupKey = `${sourceId ?? sourceName ?? key}|${targetId ?? targetName ?? ""}|${linkKind}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    out.push({
      key,
      sourceId,
      targetId,
      sourceName,
      targetName,
      linkKind,
      status: asString(rec.status) ?? "unverified",
      isSuspect: Boolean(rec.isSuspect),
      line: extractLine(rec),
    });
  }
  return out;
}

function getStatusColors(status: string | undefined, isDark: boolean): { bg: string; fg: string; border: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "passed" || s === "pass" || s === "satisfied" || s === "verified" || s === "ok" || s === "sat") {
    return isDark
      ? { bg: "rgba(46, 160, 67, 0.16)", fg: "#3fb950", border: "rgba(46, 160, 67, 0.4)" }
      : { bg: "rgba(26, 127, 55, 0.1)", fg: "#1a7f37", border: "rgba(26, 127, 55, 0.3)" };
  }
  if (s === "failed" || s === "fail" || s === "violated" || s === "error" || s === "unsat") {
    return isDark
      ? { bg: "rgba(248, 81, 73, 0.16)", fg: "#f85149", border: "rgba(248, 81, 73, 0.4)" }
      : { bg: "rgba(207, 34, 46, 0.1)", fg: "#cf222e", border: "rgba(207, 34, 46, 0.3)" };
  }
  if (s === "suspect" || s === "warning" || s === "stale") {
    return isDark
      ? { bg: "rgba(210, 153, 34, 0.16)", fg: "#d29922", border: "rgba(210, 153, 34, 0.4)" }
      : { bg: "rgba(154, 103, 0, 0.1)", fg: "#9a6700", border: "rgba(154, 103, 0, 0.3)" };
  }
  return isDark
    ? { bg: "rgba(110, 118, 129, 0.18)", fg: "#8b949e", border: "rgba(110, 118, 129, 0.35)" }
    : { bg: "rgba(175, 184, 193, 0.2)", fg: "#57606a", border: "rgba(175, 184, 193, 0.45)" };
}

function formatLinkGlyph(linkKind: string): string {
  const k = linkKind.toLowerCase();
  if (k === "satisfy") return "S";
  if (k === "verify") return "V";
  if (k === "allocate") return "A";
  if (k === "mitigate") return "M";
  if (k === "refine") return "R";
  if (k === "derive") return "D";
  if (k === "connect") return "C";
  return k.slice(0, 1).toUpperCase() || "•";
}

export const AnsatzRtmContractsPanel: React.FC<AnsatzRtmContractsPanelProps> = ({
  documentUri,
  colorMode,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const [activeTab, setActiveTab] = useState<SubViewTab>("requirements");
  const [filterText, setFilterText] = useState("");
  const [loading, setLoading] = useState(false);

  const [requirements, setRequirements] = useState<AnsatzRequirementItem[]>([]);
  const [rtmMatrix, setRtmMatrix] = useState<AnsatzRtmMatrixResult | null>(null);
  const [contractHierarchy, setContractHierarchy] = useState<AnsatzContractHierarchyResult | null>(null);

  const [errors, setErrors] = useState<{
    requirements?: string | undefined;
    rtm?: string | undefined;
    contracts?: string | undefined;
  }>({});

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrors({});

    const [reqRes, rtmRes, contractRes] = await Promise.allSettled([
      getRequirementsInAnsatz(documentUri),
      getRtmMatrixInAnsatz({ uri: documentUri }),
      getContractHierarchyInAnsatz(documentUri),
    ]);

    const nextErrors: {
      requirements?: string | undefined;
      rtm?: string | undefined;
      contracts?: string | undefined;
    } = {};

    if (reqRes.status === "fulfilled") {
      setRequirements(Array.isArray(reqRes.value) ? reqRes.value : []);
    } else {
      setRequirements([]);
      nextErrors.requirements = reqRes.reason instanceof Error ? reqRes.reason.message : String(reqRes.reason);
    }

    if (rtmRes.status === "fulfilled") {
      setRtmMatrix(rtmRes.value ?? null);
    } else {
      setRtmMatrix(null);
      nextErrors.rtm = rtmRes.reason instanceof Error ? rtmRes.reason.message : String(rtmRes.reason);
    }

    if (contractRes.status === "fulfilled") {
      setContractHierarchy(contractRes.value ?? null);
    } else {
      setContractHierarchy(null);
      nextErrors.contracts =
        contractRes.reason instanceof Error ? contractRes.reason.message : String(contractRes.reason);
    }

    setErrors(nextErrors);
    setLoading(false);
  }, [documentUri]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const filteredRequirements = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return requirements;
    return requirements.filter((item) => {
      const reqId = asString(item.reqId) ?? asString(item.id) ?? "";
      const name = asString(item.name) ?? "";
      const text = asString(item.text) ?? "";
      const status = asString(item.status) ?? "";
      return (
        reqId.toLowerCase().includes(q) ||
        name.toLowerCase().includes(q) ||
        text.toLowerCase().includes(q) ||
        status.toLowerCase().includes(q)
      );
    });
  }, [requirements, filterText]);

  const rtmRows = useMemo(() => normalizeRtmAxis(rtmMatrix?.rows ?? []), [rtmMatrix]);
  const rtmCols = useMemo(() => normalizeRtmAxis(rtmMatrix?.cols ?? []), [rtmMatrix]);
  const rtmLinks = useMemo(() => normalizeRtmLinks(rtmMatrix?.links), [rtmMatrix]);

  const rtmLinkLookup = useMemo(() => {
    const map = new Map<string, NormalizedRtmLink>();
    for (const link of rtmLinks) {
      map.set(link.key, link);
      if (link.sourceId !== undefined && link.targetId !== undefined) {
        map.set(`${String(link.sourceId)}:${String(link.targetId)}`, link);
        map.set(`${String(link.sourceId)}->${String(link.targetId)}`, link);
      }
      if (link.sourceName && link.targetName) {
        map.set(`${link.sourceName}:${link.targetName}`, link);
        map.set(`${link.sourceName}->${link.targetName}`, link);
      }
    }
    return map;
  }, [rtmLinks]);

  const normalizedContracts = useMemo(() => normalizeContractHierarchy(contractHierarchy), [contractHierarchy]);

  const countContractNodes = useCallback((nodes: NormalizedContractNode[]): number => {
    return nodes.reduce((acc, n) => acc + 1 + countContractNodes(n.children), 0);
  }, []);

  const totalContracts = useMemo(
    () => countContractNodes(normalizedContracts.nodes),
    [normalizedContracts.nodes, countContractNodes],
  );

  const colors = useMemo(
    () => ({
      bg: "var(--bgColor-default, " + (isDark ? "#0d1117" : "#ffffff") + ")",
      bgMuted: "var(--bgColor-muted, " + (isDark ? "#161b22" : "#f6f8fa") + ")",
      border: "var(--color-border-default, " + (isDark ? "#30363d" : "#d0d7de") + ")",
      fg: "var(--color-fg-default, " + (isDark ? "#e6edf3" : "#1f2328") + ")",
      fgMuted: "var(--color-fg-muted, " + (isDark ? "#8b949e" : "#656d76") + ")",
      accent: isDark ? "#58a6ff" : "#0969da",
      accentSoft: isDark ? "rgba(88, 166, 255, 0.14)" : "rgba(9, 105, 218, 0.1)",
    }),
    [isDark],
  );

  const handleReveal = useCallback(
    (line: number | undefined) => {
      if (line !== undefined && onRevealLine) {
        onRevealLine(line);
      }
    },
    [onRevealLine],
  );

  const renderContractNode = (node: NormalizedContractNode, depth: number): React.ReactNode => {
    const clickable = node.line !== undefined && Boolean(onRevealLine);
    const roleBadgeColors =
      node.role === "system"
        ? { bg: colors.accentSoft, fg: colors.accent, border: colors.accent }
        : getStatusColors(node.status, isDark);

    return (
      <div
        key={`${node.name}-${depth}`}
        style={{
          marginLeft: depth > 0 ? 14 : 0,
          marginBottom: 8,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          backgroundColor: colors.bg,
          overflow: "hidden",
        }}
      >
        <div
          role={clickable ? "button" : undefined}
          tabIndex={clickable ? 0 : undefined}
          onClick={clickable ? () => handleReveal(node.line) : undefined}
          onKeyDown={
            clickable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleReveal(node.line);
                  }
                }
              : undefined
          }
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "6px 10px",
            backgroundColor: colors.bgMuted,
            borderBottom:
              node.assumptions.length > 0 || node.guarantees.length > 0 ? `1px solid ${colors.border}` : "none",
            cursor: clickable ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontWeight: 600,
                fontSize: 12,
                color: colors.fg,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.name}
            </span>
            {node.role && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  padding: "1px 5px",
                  borderRadius: 999,
                  backgroundColor: roleBadgeColors.bg,
                  color: roleBadgeColors.fg,
                  border: `1px solid ${roleBadgeColors.border}`,
                }}
              >
                {node.role}
              </span>
            )}
          </div>
          {node.line !== undefined && (
            <span style={{ fontSize: 10, color: colors.fgMuted, fontFamily: "monospace", flexShrink: 0 }}>
              L{node.line}
            </span>
          )}
        </div>

        {(node.assumptions.length > 0 || node.guarantees.length > 0) && (
          <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
            {node.assumptions.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: colors.fgMuted,
                    marginBottom: 3,
                  }}
                >
                  Assumptions ({node.assumptions.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, fontFamily: "monospace" }}>
                  {node.assumptions.map((expr, idx) => (
                    <li key={idx} style={{ color: colors.fg, marginBottom: 2 }}>
                      {expr}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {node.guarantees.length > 0 && (
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: colors.fgMuted,
                    marginBottom: 3,
                  }}
                >
                  Guarantees ({node.guarantees.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, fontFamily: "monospace" }}>
                  {node.guarantees.map((expr, idx) => (
                    <li key={idx} style={{ color: colors.fg, marginBottom: 2 }}>
                      {expr}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {node.children.length > 0 && (
          <div style={{ padding: "6px 8px 2px 8px", borderTop: `1px solid ${colors.border}` }}>
            {node.children.map((child) => renderContractNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderRequirementsTab = () => {
    if (errors.requirements) {
      return (
        <div
          style={{
            padding: 12,
            borderRadius: 6,
            border: `1px solid ${getStatusColors("failed", isDark).border}`,
            backgroundColor: getStatusColors("failed", isDark).bg,
            color: getStatusColors("failed", isDark).fg,
            fontSize: 12,
          }}
        >
          Failed to load requirements: {errors.requirements}
        </div>
      );
    }

    if (!loading && requirements.length === 0) {
      return (
        <div style={{ padding: "24px 12px", textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>
          No requirements found for this document.
        </div>
      );
    }

    const passedCount = requirements.filter((r) => (r.status ?? "").toLowerCase() === "passed").length;
    const failedCount = requirements.filter((r) => (r.status ?? "").toLowerCase() === "failed").length;
    const pendingCount = requirements.length - passedCount - failedCount;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: colors.fgMuted }}>
              Total: <strong style={{ color: colors.fg }}>{requirements.length}</strong>
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                ...(() => {
                  const c = getStatusColors("passed", isDark);
                  return { backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` };
                })(),
              }}
            >
              Passed {passedCount}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                ...(() => {
                  const c = getStatusColors("failed", isDark);
                  return { backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` };
                })(),
              }}
            >
              Failed {failedCount}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 999,
                ...(() => {
                  const c = getStatusColors("pending", isDark);
                  return { backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` };
                })(),
              }}
            >
              Pending {pendingCount}
            </span>
          </div>

          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter requirements..."
            aria-label="Filter requirements"
            style={{
              fontSize: 11,
              padding: "3px 8px",
              borderRadius: 5,
              border: `1px solid ${colors.border}`,
              backgroundColor: colors.bg,
              color: colors.fg,
              outline: "none",
              minWidth: 140,
            }}
          />
        </div>

        {filteredRequirements.length === 0 ? (
          <div style={{ padding: "16px 8px", textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>
            No requirements match "{filterText}".
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredRequirements.map((req, idx) => {
              const reqId = asString(req.reqId) ?? asString(req.id) ?? `REQ-${idx + 1}`;
              const name = asString(req.name) ?? reqId;
              const text = asString(req.text);
              const status = asString(req.status) ?? "Pending";
              const tier = asString(req.tier);
              const margin = asNumber(req.margin);
              const peakValue = asNumber(req.peakValue);
              const limitValue = asNumber(req.limitValue);
              const line = extractLine(req);
              const clickable = line !== undefined && Boolean(onRevealLine);
              const statusStyle = getStatusColors(status, isDark);

              return (
                <div
                  key={`${reqId}-${name}-${idx}`}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => handleReveal(line) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleReveal(line);
                          }
                        }
                      : undefined
                  }
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: colors.bgMuted,
                    cursor: clickable ? "pointer" : "default",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "monospace",
                          fontWeight: 600,
                          color: colors.accent,
                          backgroundColor: colors.accentSoft,
                          padding: "1px 5px",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      >
                        {reqId}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: colors.fg,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {name}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {line !== undefined && (
                        <span style={{ fontSize: 10, color: colors.fgMuted, fontFamily: "monospace" }}>L{line}</span>
                      )}
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 999,
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.fg,
                          border: `1px solid ${statusStyle.border}`,
                        }}
                      >
                        {status}
                      </span>
                    </div>
                  </div>

                  {text && <div style={{ fontSize: 11, color: colors.fgMuted, lineHeight: 1.4 }}>{text}</div>}

                  {(tier || margin !== undefined || peakValue !== undefined || limitValue !== undefined) && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        fontSize: 10,
                        color: colors.fgMuted,
                        fontFamily: "monospace",
                      }}
                    >
                      {tier && <span>tier: {tier}</span>}
                      {peakValue !== undefined && <span>peak: {peakValue.toPrecision(4)}</span>}
                      {limitValue !== undefined && <span>limit: {limitValue.toPrecision(4)}</span>}
                      {margin !== undefined && <span>margin: {margin.toPrecision(4)}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderRtmTab = () => {
    if (errors.rtm) {
      return (
        <div
          style={{
            padding: 12,
            borderRadius: 6,
            border: `1px solid ${getStatusColors("failed", isDark).border}`,
            backgroundColor: getStatusColors("failed", isDark).bg,
            color: getStatusColors("failed", isDark).fg,
            fontSize: 12,
          }}
        >
          Failed to load traceability matrix: {errors.rtm}
        </div>
      );
    }

    const analytics = asRecord(rtmMatrix?.analytics);
    const totalReqs = asNumber(analytics?.totalRequirements);
    const satisfiedPct = asNumber(analytics?.satisfiedPercentage);
    const verifiedPct = asNumber(analytics?.verifiedPercentage);
    const suspectCount = asNumber(analytics?.suspectLinkCount);
    const failingCount = asNumber(analytics?.failingLinkCount);

    if (!loading && rtmRows.length === 0 && rtmCols.length === 0) {
      return (
        <div style={{ padding: "24px 12px", textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>
          No traceability matrix elements found for this document.
        </div>
      );
    }

    const findLink = (row: NormalizedRtmAxisItem, col: NormalizedRtmAxisItem): NormalizedRtmLink | undefined => {
      return (
        rtmLinkLookup.get(`${row.id}:${col.id}`) ??
        rtmLinkLookup.get(`${row.id}->${col.id}`) ??
        rtmLinkLookup.get(`${row.name}:${col.name}`) ??
        rtmLinkLookup.get(`${row.name}->${col.name}`)
      );
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
            padding: "6px 8px",
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bgMuted,
            fontSize: 11,
          }}
        >
          <span style={{ color: colors.fgMuted }}>
            <strong style={{ color: colors.fg }}>{rtmMatrix?.rowDomain ?? "rows"}</strong> ×{" "}
            <strong style={{ color: colors.fg }}>{rtmMatrix?.colDomain ?? "cols"}</strong>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {totalReqs !== undefined && (
              <span style={{ color: colors.fgMuted }}>
                Reqs: <strong style={{ color: colors.fg }}>{totalReqs}</strong>
              </span>
            )}
            {satisfiedPct !== undefined && (
              <span style={{ color: colors.fgMuted }}>
                Satisfied: <strong style={{ color: colors.fg }}>{Math.round(satisfiedPct)}%</strong>
              </span>
            )}
            {verifiedPct !== undefined && (
              <span style={{ color: colors.fgMuted }}>
                Verified: <strong style={{ color: colors.fg }}>{Math.round(verifiedPct)}%</strong>
              </span>
            )}
            {suspectCount !== undefined && suspectCount > 0 && (
              <span style={{ color: getStatusColors("suspect", isDark).fg, fontWeight: 600 }}>
                Suspect: {suspectCount}
              </span>
            )}
            {failingCount !== undefined && failingCount > 0 && (
              <span style={{ color: getStatusColors("failed", isDark).fg, fontWeight: 600 }}>
                Failing: {failingCount}
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            overflow: "auto",
            maxHeight: 460,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 11,
              color: colors.fg,
            }}
          >
            <thead>
              <tr style={{ backgroundColor: colors.bgMuted }}>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 3,
                    backgroundColor: colors.bgMuted,
                    textAlign: "left",
                    padding: "6px 8px",
                    borderBottom: `1px solid ${colors.border}`,
                    borderRight: `1px solid ${colors.border}`,
                    color: colors.fgMuted,
                    fontWeight: 600,
                    minWidth: 120,
                  }}
                >
                  Element
                </th>
                {rtmCols.map((col) => {
                  const clickable = col.line !== undefined && Boolean(onRevealLine);
                  return (
                    <th
                      key={col.id}
                      title={col.subtitle ? `${col.name} (${col.subtitle})` : col.name}
                      onClick={clickable ? () => handleReveal(col.line) : undefined}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        backgroundColor: colors.bgMuted,
                        textAlign: "center",
                        padding: "6px 8px",
                        borderBottom: `1px solid ${colors.border}`,
                        borderRight: `1px solid ${colors.border}`,
                        fontWeight: 600,
                        cursor: clickable ? "pointer" : "default",
                        whiteSpace: "nowrap",
                        maxWidth: 130,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {col.name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rtmRows.map((row) => {
                const rowClickable = row.line !== undefined && Boolean(onRevealLine);
                return (
                  <tr key={row.id}>
                    <td
                      onClick={rowClickable ? () => handleReveal(row.line) : undefined}
                      title={row.subtitle ? `${row.name} (${row.subtitle})` : row.name}
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        padding: "6px 8px",
                        borderBottom: `1px solid ${colors.border}`,
                        borderRight: `1px solid ${colors.border}`,
                        backgroundColor: colors.bgMuted,
                        fontWeight: 500,
                        cursor: rowClickable ? "pointer" : "default",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span>{row.name}</span>
                      {row.line !== undefined && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            color: colors.fgMuted,
                            fontFamily: "monospace",
                          }}
                        >
                          L{row.line}
                        </span>
                      )}
                    </td>
                    {rtmCols.map((col) => {
                      const link = findLink(row, col);
                      const cellLine = link?.line ?? row.line ?? col.line;
                      const cellClickable = Boolean(link) && cellLine !== undefined && Boolean(onRevealLine);
                      const statusStyle = link
                        ? getStatusColors(link.isSuspect ? "suspect" : link.status, isDark)
                        : null;

                      return (
                        <td
                          key={`${row.id}-${col.id}`}
                          onClick={cellClickable ? () => handleReveal(cellLine) : undefined}
                          title={link ? `${link.linkKind} (${link.isSuspect ? "suspect" : link.status})` : undefined}
                          style={{
                            textAlign: "center",
                            padding: "5px 6px",
                            borderBottom: `1px solid ${colors.border}`,
                            borderRight: `1px solid ${colors.border}`,
                            cursor: cellClickable ? "pointer" : "default",
                          }}
                        >
                          {link && statusStyle ? (
                            <span
                              style={{
                                display: "inline-block",
                                minWidth: 20,
                                padding: "1px 5px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                backgroundColor: statusStyle.bg,
                                color: statusStyle.fg,
                                border: `1px solid ${statusStyle.border}`,
                              }}
                            >
                              {formatLinkGlyph(link.linkKind)}
                            </span>
                          ) : (
                            <span style={{ color: colors.fgMuted, opacity: 0.35 }}>·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderContractsTab = () => {
    const errMsg = errors.contracts ?? normalizedContracts.error;
    if (errMsg) {
      return (
        <div
          style={{
            padding: 12,
            borderRadius: 6,
            border: `1px solid ${getStatusColors("failed", isDark).border}`,
            backgroundColor: getStatusColors("failed", isDark).bg,
            color: getStatusColors("failed", isDark).fg,
            fontSize: 12,
          }}
        >
          Failed to load contract hierarchy: {errMsg}
        </div>
      );
    }

    if (!loading && normalizedContracts.nodes.length === 0) {
      return (
        <div style={{ padding: "24px 12px", textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>
          {normalizedContracts.summary ?? "No assume-guarantee contracts found for this document."}
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(normalizedContracts.isCompatible !== undefined || normalizedContracts.isRefined !== undefined) && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {normalizedContracts.isCompatible !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  ...(() => {
                    const c = getStatusColors(normalizedContracts.isCompatible ? "passed" : "failed", isDark);
                    return { backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` };
                  })(),
                }}
              >
                {normalizedContracts.isCompatible ? "Compatible" : "Incompatible"}
              </span>
            )}
            {normalizedContracts.isRefined !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 7px",
                  borderRadius: 999,
                  ...(() => {
                    const c = getStatusColors(normalizedContracts.isRefined ? "passed" : "failed", isDark);
                    return { backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` };
                  })(),
                }}
              >
                {normalizedContracts.isRefined ? "Refined" : "Refinement Violated"}
              </span>
            )}
          </div>
        )}

        {(normalizedContracts.compatibilityViolations.length > 0 ||
          normalizedContracts.refinementViolations.length > 0) && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: `1px solid ${getStatusColors("failed", isDark).border}`,
              backgroundColor: getStatusColors("failed", isDark).bg,
              color: getStatusColors("failed", isDark).fg,
              fontSize: 11,
            }}
          >
            {normalizedContracts.compatibilityViolations.map((v, idx) => (
              <div key={`compat-${idx}`}>Compatibility: {v}</div>
            ))}
            {normalizedContracts.refinementViolations.map((v, idx) => (
              <div key={`refine-${idx}`}>Refinement: {v}</div>
            ))}
          </div>
        )}

        <div>{normalizedContracts.nodes.map((node) => renderContractNode(node, 0))}</div>
      </div>
    );
  };

  const tabs: Array<{ id: SubViewTab; label: string; count: number }> = [
    { id: "requirements", label: "Requirements", count: requirements.length },
    { id: "rtm", label: "Traceability Matrix (RTM)", count: rtmLinks.length },
    { id: "contracts", label: "Contract Hierarchy", count: totalContracts },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        backgroundColor: colors.bg,
        color: colors.fg,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "8px 10px",
          borderBottom: `1px solid ${colors.border}`,
          backgroundColor: colors.bgMuted,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  borderRadius: 6,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  backgroundColor: active ? colors.accentSoft : colors.bg,
                  color: active ? colors.accent : colors.fg,
                  cursor: "pointer",
                }}
              >
                <span>{tab.label}</span>
                <span
                  style={{
                    fontSize: 10,
                    padding: "0 5px",
                    borderRadius: 999,
                    backgroundColor: active ? colors.accent : colors.bgMuted,
                    color: active ? "#ffffff" : colors.fgMuted,
                  }}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={loading}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            backgroundColor: colors.bg,
            color: colors.fg,
            cursor: loading ? "wait" : "pointer",
            opacity: loading ? 0.65 : 1,
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 10 }}>
        {loading && requirements.length === 0 && !rtmMatrix && !contractHierarchy ? (
          <div style={{ padding: "24px 12px", textAlign: "center", color: colors.fgMuted, fontSize: 12 }}>
            Loading requirements, traceability matrix, and contracts...
          </div>
        ) : activeTab === "requirements" ? (
          renderRequirementsTab()
        ) : activeTab === "rtm" ? (
          renderRtmTab()
        ) : (
          renderContractsTab()
        )}
      </div>
    </div>
  );
};

export default AnsatzRtmContractsPanel;
