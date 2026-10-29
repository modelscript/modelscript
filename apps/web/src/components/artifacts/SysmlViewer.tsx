// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  CpuIcon,
  DotFillIcon,
  SearchIcon,
  ShieldCheckIcon,
  WorkflowIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface SysmlPart {
  name: string;
  type: string;
  multiplicity?: string | undefined;
  ports?: string[] | undefined;
  description?: string | undefined;
}

export interface SysmlRequirement {
  id: string;
  name: string;
  text: string;
  status: "satisfied" | "verified" | "unverified" | "violated" | string;
}

export interface SysmlConnection {
  source: string;
  target: string;
  flowType?: string | undefined;
}

export interface SysmlViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    format?: "SysML2" | "KerML" | string | undefined;
    systemName?: string | undefined;
    title?: string | undefined;
    code?: string | undefined;
    source?: string | undefined;
    url?: string | undefined;
    svg?: string | undefined;
    parts?: SysmlPart[] | undefined;
    requirements?: SysmlRequirement[] | undefined;
    connections?: SysmlConnection[] | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "440px")};
  background: var(--color-canvas-default, #0d1117);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default, #30363d)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, rgba(14, 20, 36, 0.7));
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const SystemTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, #f0f6fc);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Badge = styled.span<{ $variant?: "sysml" | "req-pass" | "req-warn" | "kerml" | undefined }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 7px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;

  ${(props) => {
    switch (props.$variant) {
      case "sysml":
        return `
          background: rgba(59, 130, 246, 0.15);
          color: var(--color-accent-blue, #60a5fa);
          border: 1px solid rgba(59, 130, 246, 0.4);
        `;
      case "kerml":
        return `
          background: rgba(168, 85, 247, 0.15);
          color: var(--color-accent-purple, #c084fc);
          border: 1px solid rgba(168, 85, 247, 0.4);
        `;
      case "req-pass":
        return `
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.4);
        `;
      case "req-warn":
        return `
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
          border: 1px solid rgba(245, 158, 11, 0.4);
        `;
      default:
        return `
          background: rgba(255, 255, 255, 0.05);
          color: var(--color-text-muted, #8b949e);
          border: 1px solid rgba(255, 255, 255, 0.08);
        `;
    }
  }}
`;

const TabNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--color-canvas-subtle, #161b22);
  border-bottom: 1px solid var(--color-border-default, #30363d);
  padding: 0 12px;
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: none;
  border: none;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: ${(props) => (props.$active ? "700" : "500")};
  color: ${(props) => (props.$active ? "var(--color-text-primary, #ffffff)" : "var(--color-text-muted, #8b949e)")};
  cursor: pointer;
  position: relative;
  outline: none;
  font-family: inherit;

  ${(props) =>
    props.$active &&
    `
    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 8px;
      right: 8px;
      height: 2px;
      background: var(--color-accent-blue, #3b82f6);
      border-radius: 9999px;
    }
  `}

  &:hover {
    color: var(--color-text-primary, #ffffff);
  }
`;

const ContentBody = styled.div`
  flex: 1;
  overflow: auto;
  padding: 12px;
  background: var(--color-canvas-default, #0d1117);
`;

const TreeCard = styled.div`
  background: var(--color-canvas-subtle, #161b22);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: rgba(59, 130, 246, 0.4);
  }
`;

const CodeEditor = styled.pre`
  margin: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 6px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-primary, #e6edf3);
  overflow: auto;
  white-space: pre;
`;

function parseSysmlSource(code: string): {
  parts: SysmlPart[];
  requirements: SysmlRequirement[];
  connections: SysmlConnection[];
} {
  const parts: SysmlPart[] = [];
  const requirements: SysmlRequirement[] = [];
  const connections: SysmlConnection[] = [];

  if (!code.trim()) {
    return { parts, requirements, connections };
  }

  // Extract part definitions and usages
  const partDefRe = /\bpart\s+def\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let m: RegExpExecArray | null;
  const defPorts = new Map<string, string[]>();
  while ((m = partDefRe.exec(code)) !== null) {
    const defName = m[1]!;
    const body = m[2] || "";
    const ports: string[] = [];
    const portRe = /\bport\s+([A-Za-z_]\w*)/g;
    let pm: RegExpExecArray | null;
    while ((pm = portRe.exec(body)) !== null) {
      ports.push(pm[1]!);
    }
    defPorts.set(defName, ports);
  }

  const partUsageRe = /\bpart\s+(?!def\b)([A-Za-z_]\w*)\s*:\s*([A-Za-z_]\w*)(?:\[([^\]]+)\])?/g;
  while ((m = partUsageRe.exec(code)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const mult = m[3] || "1";
    parts.push({
      name,
      type,
      multiplicity: mult,
      ports: defPorts.get(type) || [],
    });
  }

  if (parts.length === 0) {
    for (const [defName, ports] of defPorts.entries()) {
      parts.push({
        name: defName,
        type: "PartDefinition",
        multiplicity: "1",
        ports,
      });
    }
  }

  // Extract requirement definitions and usages
  const verifyTargetSet = new Set<string>();
  const satisfyTargetSet = new Set<string>();
  const verifyRe = /\bverify\s+(?:requirement\s+)?([A-Za-z_]\w*)\b/g;
  while ((m = verifyRe.exec(code)) !== null) {
    verifyTargetSet.add(m[1]!);
  }
  const satisfyRe = /\bsatisfy\s+(?:requirement\s+)?([A-Za-z_]\w*)\b/g;
  while ((m = satisfyRe.exec(code)) !== null) {
    satisfyTargetSet.add(m[1]!);
  }

  const reqRe = /\brequirement\s+(?:def\s+)?([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g;
  let reqIdx = 1;
  while ((m = reqRe.exec(code)) !== null) {
    const reqName = m[1]!;
    const body = m[2] || "";
    const docMatch = body.match(/\/\*([\s\S]*?)\*\//);
    const text = docMatch ? docMatch[1]!.trim() : `Requirement specification for ${reqName}`;
    let status: SysmlRequirement["status"] = "unverified";
    if (verifyTargetSet.size > 0 || satisfyTargetSet.size > 0) {
      if (verifyTargetSet.has(reqName)) {
        status = "verified";
      } else if (satisfyTargetSet.has(reqName)) {
        status = "satisfied";
      } else {
        status = "unsatisfied";
      }
    }
    requirements.push({
      id: `REQ-${String(reqIdx++).padStart(2, "0")}`,
      name: reqName,
      text,
      status,
    });
  }

  // Extract connections
  const connRe = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRe.exec(code)) !== null) {
    connections.push({
      source: m[1]!,
      target: m[2]!,
    });
  }

  return { parts, requirements, connections };
}

const SysmlViewer: React.FC<SysmlViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"diagram" | "architecture" | "requirements" | "source">("diagram");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [fetchedCode, setFetchedCode] = useState<string | null>(null);

  const inlineCode = (viewConfig.code as string) || (viewConfig.source as string) || "";
  useEffect(() => {
    if (!inlineCode && typeof viewConfig.url === "string") {
      fetch(viewConfig.url)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (txt) setFetchedCode(txt);
        })
        .catch(() => {});
    }
  }, [inlineCode, viewConfig.url]);

  const sourceCode = inlineCode || fetchedCode || "";
  const format = viewConfig.format || "SysML2";
  const systemName = viewConfig.systemName || (viewConfig.title as string) || "System Architecture";

  const parsedModel = useMemo(() => parseSysmlSource(sourceCode), [sourceCode]);

  // Parts list strictly from viewConfig or parsed source code (no hardcoded Quadcopter mock)
  const parts: SysmlPart[] = useMemo(() => {
    if (Array.isArray(viewConfig.parts) && viewConfig.parts.length > 0) {
      return viewConfig.parts;
    }
    return parsedModel.parts;
  }, [viewConfig.parts, parsedModel.parts]);

  // Requirements list strictly from viewConfig or parsed source code
  const requirements: SysmlRequirement[] = useMemo(() => {
    if (Array.isArray(viewConfig.requirements) && viewConfig.requirements.length > 0) {
      return viewConfig.requirements;
    }
    return parsedModel.requirements;
  }, [viewConfig.requirements, parsedModel.requirements]);

  // Connections list strictly from viewConfig or parsed source code
  const connections: SysmlConnection[] = useMemo(() => {
    if (Array.isArray(viewConfig.connections) && viewConfig.connections.length > 0) {
      return viewConfig.connections;
    }
    return parsedModel.connections;
  }, [viewConfig.connections, parsedModel.connections]);

  const svgMarkup = useMemo(() => {
    if (typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg);
    }
    if (parts.length === 0) return "";
    const width = 680;
    const cols = Math.min(3, Math.max(1, parts.length));
    const rows = Math.ceil(parts.length / cols);
    const height = Math.max(240, rows * 110 + 70);
    const boxW = 180;
    const boxH = 68;
    const posMap = new Map<string, { x: number; y: number }>();
    const nodesSvg = parts.map((p, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 40 + col * 210;
      const y = 55 + row * 100;
      posMap.set(p.name, { x: x + boxW / 2, y: y + boxH / 2 });
      return `<g transform="translate(${x}, ${y})">
        <rect width="${boxW}" height="${boxH}" rx="6" fill="var(--ms-bg-alt)" stroke="#3b82f6" stroke-width="1.5"/>
        <text x="10" y="18" fill="#60a5fa" font-family="monospace" font-size="9">«part» ${p.type}</text>
        <text x="10" y="38" fill="var(--ms-text-1)" font-family="monospace" font-size="12" font-weight="bold">${p.name}${p.multiplicity ? ` [${p.multiplicity}]` : ""}</text>
        <text x="10" y="56" fill="var(--ms-text-3)" font-family="monospace" font-size="9">${(p.ports || []).slice(0, 3).join(", ")}</text>
      </g>`;
    });
    const edgesSvg = connections.map((c) => {
      const srcPart = c.source.split(".")[0]!;
      const tgtPart = c.target.split(".")[0]!;
      const p1 = posMap.get(srcPart);
      const p2 = posMap.get(tgtPart);
      if (!p1 || !p2) return "";
      return `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#34d399" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    });
    return sanitizeSvgMarkup(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
      <rect width="${width}" height="${height}" rx="8" fill="var(--ms-bg)"/>
      <text x="20" y="28" fill="var(--ms-text-1)" font-family="monospace" font-size="12" font-weight="bold">bdd [package] ${systemName}</text>
      ${edgesSvg.join("\n")}
      ${nodesSvg.join("\n")}
    </svg>`);
  }, [viewConfig.svg, parts, connections, systemName]);

  const effectiveTab =
    activeTab === "diagram" && !svgMarkup
      ? parts.length > 0
        ? "architecture"
        : requirements.length > 0
          ? "requirements"
          : "source"
      : activeTab;

  const satisfiedCount = requirements.filter((r) => r.status === "satisfied" || r.status === "verified").length;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sourceCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleOpenPlayground = () => {
    const hash = compressMorselPayload({
      v: 1,
      lang: "sysml2" as any,
      code: sourceCode || `package ${systemName.replace(/\W+/g, "_")} {\n}\n`,
      title: systemName,
    });
    const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
    navigate(`/playground${fromArtifact}#m=${hash}`);
  };

  const filteredParts = useMemo(() => {
    if (!searchQuery.trim()) return parts;
    const q = searchQuery.toLowerCase();
    return parts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)),
    );
  }, [parts, searchQuery]);

  const codeLines = useMemo(() => (sourceCode ? sourceCode.split(/\r?\n/) : []), [sourceCode]);

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      {!isFullScreen && (
        <Toolbar>
          <HeaderLeft>
            <CpuIcon size={16} fill="var(--color-accent-blue, #60a5fa)" />
            <SystemTitle title={systemName}>{systemName}</SystemTitle>
            <Badge $variant={format === "KerML" ? "kerml" : "sysml"}>{format}</Badge>
            {requirements.length > 0 && (
              <Badge $variant={satisfiedCount === requirements.length ? "req-pass" : "req-warn"}>
                <ShieldCheckIcon size={12} /> {satisfiedCount}/{requirements.length} Reqs Satisfied
              </Badge>
            )}
          </HeaderLeft>

          <Box display="flex" alignItems="center" gap={2}>
            {sourceCode && (
              <Button size="small" onClick={handleCopyCode} title="Copy SysML v2 source">
                {copiedCode ? <CheckIcon size={14} fill="var(--color-accent-cyan)" /> : <CopyIcon size={14} />}
                <Text style={{ fontSize: "11px", marginLeft: "4px" }}>{copiedCode ? "Copied" : "Copy"}</Text>
              </Button>
            )}
            {Boolean(viewConfig?.standalone) && (
              <Button
                size="small"
                variant="primary"
                onClick={handleOpenPlayground}
                title="Open SysML v2 model in Playground"
              >
                <CodeIcon size={14} />
                <Text style={{ fontSize: "11px", marginLeft: "4px" }}>Open in Playground</Text>
              </Button>
            )}
          </Box>
        </Toolbar>
      )}

      <TabNav>
        {svgMarkup && (
          <TabButton $active={effectiveTab === "diagram"} onClick={() => setActiveTab("diagram")}>
            <WorkflowIcon size={12} /> BDD / IBD Diagram
          </TabButton>
        )}
        <TabButton $active={effectiveTab === "architecture"} onClick={() => setActiveTab("architecture")}>
          System Architecture ({parts.length})
        </TabButton>
        <TabButton $active={effectiveTab === "requirements"} onClick={() => setActiveTab("requirements")}>
          Requirements Matrix ({requirements.length})
        </TabButton>
        <TabButton $active={effectiveTab === "source"} onClick={() => setActiveTab("source")}>
          SysML v2 Source
        </TabButton>
      </TabNav>

      <ContentBody>
        {effectiveTab === "diagram" && svgMarkup && (
          <Box
            display="flex"
            justifyContent="center"
            alignItems="center"
            style={{ minHeight: "260px", height: "100%", overflow: "hidden" }}
          >
            <div
              style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center" }}
              dangerouslySetInnerHTML={{ __html: svgMarkup }}
            />
          </Box>
        )}

        {effectiveTab === "architecture" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                Composition breakdown &amp; internal port bindings
              </Text>
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search parts or ports..."
                size="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: "220px" }}
              />
            </Box>

            <Box display="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} gap={2}>
              {filteredParts.map((p) => (
                <TreeCard key={p.name}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap={1}>
                      <DotFillIcon size={12} fill="var(--color-accent-blue, #60a5fa)" />
                      <Text style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                        {p.name}
                      </Text>
                      {p.multiplicity && (
                        <Text
                          style={{ fontSize: "11px", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}
                        >
                          [{p.multiplicity}]
                        </Text>
                      )}
                    </Box>
                    <Badge>{p.type}</Badge>
                  </Box>

                  {p.description && (
                    <Text style={{ fontSize: "11.5px", color: "var(--color-text-muted)" }}>{p.description}</Text>
                  )}

                  {p.ports && p.ports.length > 0 && (
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                      <Text style={{ fontSize: "10.5px", color: "var(--color-text-muted)" }}>Ports:</Text>
                      {p.ports.map((port) => (
                        <span
                          key={port}
                          style={{
                            fontSize: "10.5px",
                            fontFamily: "var(--font-mono, monospace)",
                            background: "rgba(255, 255, 255, 0.05)",
                            padding: "1px 5px",
                            borderRadius: "4px",
                            border: "1px solid rgba(255, 255, 255, 0.08)",
                          }}
                        >
                          {port}
                        </span>
                      ))}
                    </Box>
                  )}
                </TreeCard>
              ))}
            </Box>

            {connections.length > 0 && (
              <Box mt={3}>
                <Heading as="h5" style={{ fontSize: "12px", color: "var(--color-text-muted)", marginBottom: "6px" }}>
                  Internal Flow Connections ({connections.length})
                </Heading>
                <Box
                  p={2}
                  bg="rgba(0, 0, 0, 0.2)"
                  borderRadius="6px"
                  border="1px solid var(--color-border-default)"
                  display="flex"
                  flexDirection="column"
                  gap={1}
                >
                  {connections.map((c, idx) => (
                    <Box
                      key={idx}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      py={1}
                      px={1}
                      style={{
                        fontSize: "11.5px",
                        fontFamily: "var(--font-mono, monospace)",
                        borderBottom: idx < connections.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                      }}
                    >
                      <Box display="flex" alignItems="center" gap={1}>
                        <span style={{ color: "#60a5fa" }}>{c.source}</span>
                        <span style={{ color: "var(--color-text-muted)" }}>&rarr;</span>
                        <span style={{ color: "#34d399" }}>{c.target}</span>
                      </Box>
                      {c.flowType && (
                        <span style={{ color: "var(--color-text-muted)", fontSize: "10.5px" }}>[{c.flowType}]</span>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {effectiveTab === "requirements" && (
          <Box display="flex" flexDirection="column" gap={2}>
            {requirements.length > 0 ? (
              requirements.map((req) => {
                const isVerified = req.status === "satisfied" || req.status === "verified";
                return (
                  <Box
                    key={req.id}
                    p={3}
                    bg="var(--color-canvas-subtle)"
                    border="1px solid var(--color-border-default)"
                    borderRadius="6px"
                    display="flex"
                    flexDirection="column"
                    gap={1}
                  >
                    <Box display="flex" alignItems="center" justifyContent="space-between">
                      <Box display="flex" alignItems="center" gap={2}>
                        {isVerified ? (
                          <CheckCircleFillIcon size={16} fill="#34d399" />
                        ) : req.status === "violated" ? (
                          <XCircleFillIcon size={16} fill="#f87171" />
                        ) : (
                          <DotFillIcon size={16} fill="#fbbf24" />
                        )}
                        <Text style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                          {req.id}: {req.name}
                        </Text>
                      </Box>

                      <Badge $variant={isVerified ? "req-pass" : "req-warn"}>{req.status.toUpperCase()}</Badge>
                    </Box>

                    <Text style={{ fontSize: "12px", color: "var(--color-text-secondary)", paddingLeft: "24px" }}>
                      {req.text}
                    </Text>
                  </Box>
                );
              })
            ) : (
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>
                No requirement definitions found in this SysML v2 model.
              </Text>
            )}
          </Box>
        )}

        {effectiveTab === "source" && (
          <CodeEditor>
            {codeLines.length > 0 ? (
              codeLines.map((line, i) => (
                <div key={i} style={{ display: "flex" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "34px",
                      minWidth: "34px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-text-muted)",
                      fontSize: "11px",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ whiteSpace: "pre" }}>{highlightPolyglotLine(line, "sysml")}</span>
                </div>
              ))
            ) : (
              <Text style={{ fontSize: "12px", color: "var(--color-text-muted)" }}>No SysML v2 source available.</Text>
            )}
          </CodeEditor>
        )}
      </ContentBody>
    </CardWrapper>
  );
};

export default SysmlViewer;
