// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  CopyIcon,
  DatabaseIcon,
  DependabotIcon,
  DownloadIcon,
  GraphIcon,
  ListUnorderedIcon,
  PackageIcon,
  SearchIcon,
  ShieldCheckIcon,
  VerifiedIcon,
} from "@primer/octicons-react";
import { Button, Label, Text } from "@primer/react";
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getPackageDataPackageExportUrl,
  getPackageLockfile,
  getPackageLockfileExportUrl,
  type DataPackageLockJsonSummary,
  type DataPackageResourceSummary,
  type PackageDependent,
} from "../../../api";
import Box from "../../../components/Box";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { DependentBadge, DepRow, GlassCard, SectionTitle } from "../types";

export interface PackageDependenciesTabProps {
  name?: string | undefined;
  version?: string | undefined;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
  resources?: DataPackageResourceSummary[] | undefined;
  dependents?: PackageDependent[] | undefined;
}

function renderDepRow(dep: string, range: string, kindLabel: string) {
  const isScoped = dep.startsWith("@") && dep.includes("/");
  const [scope, baseName] = isScoped ? dep.split("/", 2) : [null, dep];

  return (
    <DepRow key={dep} style={{ padding: "12px 0", gap: 12 }}>
      <Box display="flex" alignItems="center" gap="12px" style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: "var(--color-canvas-subtle, rgba(6, 182, 212, 0.08))",
            border: "1px solid var(--color-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "var(--color-accent-cyan, #06b6d4)",
          }}
        >
          <PackageIcon size={16} />
        </div>
        <Box style={{ minWidth: 0 }}>
          <Link
            to={`/packages/${dep}`}
            style={{
              color: "var(--color-link)",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-mono, monospace)",
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            {scope && <span style={{ color: "var(--color-text-muted)", fontWeight: 500 }}>{scope}/</span>}
            <span>{baseName}</span>
          </Link>
          <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
            {kindLabel}
          </Text>
        </Box>
      </Box>

      <Box display="flex" alignItems="center" gap="12px">
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 6,
            background: "var(--color-canvas-subtle)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-mono, monospace)",
          }}
        >
          {range}
        </span>
        <Link
          to={`/packages/${dep}`}
          title={`Inspect ${dep}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: "var(--color-text-muted)",
            textDecoration: "none",
          }}
        >
          <ArrowRightIcon size={14} />
        </Link>
      </Box>
    </DepRow>
  );
}

interface DagNode {
  id: string;
  name: string;
  scope: string | null;
  baseName: string;
  version?: string | undefined;
  range?: string | undefined;
  level: number;
  isRoot: boolean;
  isDirect: boolean;
  domains?: string[] | undefined;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DagEdge {
  id: string;
  from: string;
  to: string;
  range?: string | undefined;
  isDirect: boolean;
}

const DependencyDagExplorer: React.FC<{
  rootName: string;
  rootVersion: string;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
  lockfile: DataPackageLockJsonSummary | null;
}> = ({ rootName, rootVersion, dependencies, devDependencies: _devDependencies, lockfile }) => {
  const [search, setSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];
  const nodeMap = new Map<string, DagNode>();

  const splitScope = (fullName: string): { scope: string | null; baseName: string } => {
    if (fullName.startsWith("@") && fullName.includes("/")) {
      const parts = fullName.split("/", 2);
      return { scope: parts[0]!, baseName: parts[1]! };
    }
    return { scope: null, baseName: fullName };
  };

  // 1. Root node
  const rootSplit = splitScope(rootName);
  const rootNode: DagNode = {
    id: rootName,
    name: rootName,
    scope: rootSplit.scope,
    baseName: rootSplit.baseName,
    version: rootVersion,
    level: 0,
    isRoot: true,
    isDirect: true,
    x: 40,
    y: 0,
    width: 210,
    height: 56,
  };
  nodes.push(rootNode);
  nodeMap.set(rootName, rootNode);

  // 2. Direct dependencies (Level 1)
  const directEntries = Object.entries(dependencies);
  directEntries.forEach(([dep, range]) => {
    const s = splitScope(dep);
    const locked = lockfile?.packages?.[dep];
    const n: DagNode = {
      id: dep,
      name: dep,
      scope: s.scope,
      baseName: s.baseName,
      range,
      version: locked?.version,
      level: 1,
      isRoot: false,
      isDirect: true,
      domains: locked?.domains ? Object.keys(locked.domains) : undefined,
      x: 320,
      y: 0,
      width: 210,
      height: 56,
    };
    nodes.push(n);
    nodeMap.set(dep, n);
    edges.push({
      id: `${rootName}->${dep}`,
      from: rootName,
      to: dep,
      range,
      isDirect: true,
    });
  });

  // 3. Transitive dependencies (Level 2)
  if (lockfile?.packages) {
    for (const [depName] of directEntries) {
      const locked = lockfile.packages[depName];
      if (locked && locked.dependencies) {
        for (const [transDep, transRange] of Object.entries(locked.dependencies)) {
          if (!nodeMap.has(transDep)) {
            const s = splitScope(transDep);
            const subLocked = lockfile.packages[transDep];
            const tn: DagNode = {
              id: transDep,
              name: transDep,
              scope: s.scope,
              baseName: s.baseName,
              range: transRange,
              version: subLocked?.version,
              level: 2,
              isRoot: false,
              isDirect: false,
              domains: subLocked?.domains ? Object.keys(subLocked.domains) : undefined,
              x: 600,
              y: 0,
              width: 210,
              height: 56,
            };
            nodes.push(tn);
            nodeMap.set(transDep, tn);
          }
          edges.push({
            id: `${depName}->${transDep}`,
            from: depName,
            to: transDep,
            range: transRange,
            isDirect: false,
          });
        }
      }
    }
  }

  // Layout positions: Group by level
  const levelGroups = new Map<number, DagNode[]>();
  for (const n of nodes) {
    if (!levelGroups.has(n.level)) levelGroups.set(n.level, []);
    levelGroups.get(n.level)!.push(n);
  }

  const maxLevelCount = Math.max(...Array.from(levelGroups.values()).map((g) => g.length), 1);
  const totalSvgHeight = Math.max(340, maxLevelCount * 76 + 50);
  const totalSvgWidth = Math.max(860, (levelGroups.size || 1) * 280 + 80);

  levelGroups.forEach((group) => {
    const colHeight = group.length * 76;
    const startY = (totalSvgHeight - colHeight) / 2 + 10;
    group.forEach((node, i) => {
      node.y = Math.round(startY + i * 76);
    });
  });

  const isMatched = (n: DagNode) => {
    if (!search.trim()) return true;
    return n.name.toLowerCase().includes(search.toLowerCase());
  };

  return (
    <GlassCard style={{ padding: 16, overflow: "hidden" }}>
      {/* Controls Bar */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} gap={2} flexWrap="wrap">
        <div style={{ position: "relative", minWidth: 240, maxWidth: 360, flex: 1 }}>
          <SearchIcon size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--color-text-muted)" }} />
          <input
            type="text"
            placeholder="Search dependency by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "6px 12px 6px 32px",
              borderRadius: 6,
              background: "var(--color-canvas-subtle)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
              fontSize: 12.5,
              outline: "none",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {nodes.length} nodes · {edges.length} edges
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="small" onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}>
              -
            </Button>
            <Button size="small" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button size="small" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))}>
              +
            </Button>
          </div>
        </div>
      </Box>

      {/* SVG Canvas */}
      <div
        style={{
          width: "100%",
          height: 420,
          overflow: "auto",
          background: "radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.03) 0%, transparent 80%)",
          borderRadius: 8,
          border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.06))",
          position: "relative",
        }}
      >
        <svg
          width={totalSvgWidth * zoom}
          height={totalSvgHeight * zoom}
          viewBox={`0 0 ${totalSvgWidth} ${totalSvgHeight}`}
          style={{ display: "block" }}
        >
          <defs>
            <marker
              id="dag-arrow-solid"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--color-accent-cyan, #06b6d4)" />
            </marker>
            <marker
              id="dag-arrow-dashed"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="var(--color-text-muted, #8b949e)" />
            </marker>
          </defs>

          {/* Render Edges */}
          {edges.map((edge) => {
            const from = nodeMap.get(edge.from);
            const to = nodeMap.get(edge.to);
            if (!from || !to) return null;

            const x1 = from.x + from.width;
            const y1 = from.y + from.height / 2;
            const x2 = to.x;
            const y2 = to.y + to.height / 2;
            const dx = Math.max(30, (x2 - x1) / 2);

            const isEdgeHovered = hoveredNode === edge.from || hoveredNode === edge.to;
            const strokeColor = isEdgeHovered
              ? "var(--color-accent-cyan, #06b6d4)"
              : edge.isDirect
                ? "rgba(6, 182, 212, 0.4)"
                : "rgba(139, 148, 158, 0.35)";

            return (
              <g key={edge.id}>
                <path
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={isEdgeHovered ? 2.5 : edge.isDirect ? 1.75 : 1.25}
                  strokeDasharray={edge.isDirect ? undefined : "4,4"}
                  markerEnd={edge.isDirect ? "url(#dag-arrow-solid)" : "url(#dag-arrow-dashed)"}
                />
              </g>
            );
          })}

          {/* Render Nodes */}
          {nodes.map((node) => {
            const matched = isMatched(node);
            const isHovered = hoveredNode === node.id;

            return (
              <foreignObject
                key={node.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: 8,
                    background: node.isRoot
                      ? "linear-gradient(135deg, rgba(6, 182, 212, 0.16) 0%, rgba(59, 130, 246, 0.12) 100%)"
                      : "var(--color-canvas-default, rgba(22, 27, 34, 0.85))",
                    backdropFilter: "blur(12px)",
                    border: isHovered
                      ? "1.5px solid var(--color-accent-cyan, #06b6d4)"
                      : matched
                        ? node.isRoot
                          ? "1.5px solid rgba(6, 182, 212, 0.6)"
                          : "1px solid var(--color-border, rgba(255,255,255,0.12))"
                        : "1px dashed rgba(139, 148, 158, 0.2)",
                    opacity: matched ? 1 : 0.35,
                    boxShadow: isHovered
                      ? "0 0 16px rgba(6, 182, 212, 0.35)"
                      : node.isRoot
                        ? "0 2px 8px rgba(6, 182, 212, 0.15)"
                        : "none",
                    padding: "6px 10px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    boxSizing: "border-box",
                    cursor: node.isRoot ? "default" : "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <Link
                      to={node.isRoot ? "#" : `/packages/${encodeURIComponent(node.id)}`}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "var(--font-mono, monospace)",
                        color: node.isRoot ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-primary)",
                        textDecoration: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                      title={node.name}
                    >
                      {node.scope && <span style={{ opacity: 0.6 }}>{node.scope}/</span>}
                      <span>{node.baseName}</span>
                    </Link>
                    {node.version && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: node.isRoot ? "rgba(6, 182, 212, 0.2)" : "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border)",
                          fontFamily: "var(--font-mono, monospace)",
                          fontWeight: 600,
                          color: "var(--color-text-secondary)",
                          flexShrink: 0,
                        }}
                      >
                        v{node.version}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                    <span
                      style={{
                        fontSize: 9.5,
                        color: node.isRoot ? "var(--color-accent-cyan, #06b6d4)" : "var(--color-text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      {node.isRoot ? "Root Package" : node.isDirect ? "Direct" : "Transitive"}
                    </span>
                    {node.range && (
                      <span style={{ fontSize: 9.5, color: "var(--color-text-muted)", fontFamily: "monospace" }}>
                        ({node.range})
                      </span>
                    )}
                    {node.domains && node.domains.length > 0 && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 9,
                          padding: "0 4px",
                          borderRadius: 3,
                          background: "rgba(59, 130, 246, 0.15)",
                          color: "#60a5fa",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {node.domains[0]}
                      </span>
                    )}
                  </div>
                </div>
              </foreignObject>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <Box
        display="flex"
        alignItems="center"
        gap={16}
        mt={2}
        flexWrap="wrap"
        style={{ fontSize: 11, color: "var(--color-text-muted)" }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{ width: 14, height: 2, background: "var(--color-accent-cyan, #06b6d4)", display: "inline-block" }}
          />
          Direct Dependency
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{ width: 14, height: 2, borderTop: "2px dashed var(--color-text-muted)", display: "inline-block" }}
          />
          Transitive Dependency
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: "rgba(6, 182, 212, 0.25)",
              border: "1px solid var(--color-accent-cyan)",
              display: "inline-block",
            }}
          />
          Root Package
        </span>
      </Box>
    </GlassCard>
  );
};

export const PackageDependenciesTab: React.FC<PackageDependenciesTabProps> = ({
  name,
  version,
  dependencies,
  devDependencies,
  resources,
  dependents,
}) => {
  const hasAdvancedExports = useFeatureFlag("package_advanced_exports");
  const [viewMode, setViewMode] = useState<"list" | "dag">("list");
  const [lockfile, setLockfile] = useState<DataPackageLockJsonSummary | null>(null);
  const [copiedLockfile, setCopiedLockfile] = useState(false);

  useEffect(() => {
    if (!hasAdvancedExports || !name || !version) return;
    let cancelled = false;
    getPackageLockfile(name, version).then((res) => {
      if (!cancelled) setLockfile(res);
    });
    return () => {
      cancelled = true;
    };
  }, [hasAdvancedExports, name, version]);

  const handleCopyLockfile = () => {
    if (!lockfile) return;
    navigator.clipboard.writeText(JSON.stringify(lockfile, null, 2));
    setCopiedLockfile(true);
    setTimeout(() => setCopiedLockfile(false), 2000);
  };

  const depEntries = Object.entries(dependencies);
  const devDepEntries = Object.entries(devDependencies || {});

  return (
    <>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={3} flexWrap="wrap" gap={2}>
        <Box display="flex" alignItems="center" gap="8px">
          <DependabotIcon size={16} fill="var(--color-text-muted)" />
          <SectionTitle as="h3" style={{ margin: 0 }}>
            Dependencies
          </SectionTitle>
          <Label variant="secondary" style={{ fontSize: 11, padding: "0 6px" }}>
            {depEntries.length}
          </Label>
        </Box>
        <div style={{ display: "flex", gap: 4 }}>
          <Button
            size="small"
            variant={viewMode === "list" ? "primary" : "invisible"}
            leadingVisual={ListUnorderedIcon}
            onClick={() => setViewMode("list")}
          >
            List
          </Button>
          <Button
            size="small"
            variant={viewMode === "dag" ? "primary" : "invisible"}
            leadingVisual={GraphIcon}
            onClick={() => setViewMode("dag")}
          >
            DAG Explorer
          </Button>
        </div>
      </Box>

      {viewMode === "dag" ? (
        <DependencyDagExplorer
          rootName={name || "root"}
          rootVersion={version || "latest"}
          dependencies={dependencies}
          devDependencies={devDependencies}
          lockfile={lockfile}
        />
      ) : (
        <>
          <GlassCard style={{ padding: depEntries.length > 0 ? "6px 20px" : "24px 20px" }}>
            {depEntries.length > 0 ? (
              depEntries.map(([dep, range]) => renderDepRow(dep, range, "Required package dependency"))
            ) : (
              <Box display="flex" alignItems="center" gap="12px">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: "rgba(45, 164, 78, 0.1)",
                    border: "1px solid rgba(45, 164, 78, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <ShieldCheckIcon size={18} fill="var(--color-success-fg, #2da44e)" />
                </div>
                <Box>
                  <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)", display: "block" }}>
                    Zero Runtime Dependencies
                  </Text>
                  <Text as="p" style={{ color: "var(--color-text-muted)", fontSize: 13, margin: "2px 0 0" }}>
                    This package is self-contained and requires no external libraries.
                  </Text>
                </Box>
              </Box>
            )}
          </GlassCard>

          {devDepEntries.length > 0 && (
            <>
              <Box display="flex" alignItems="center" gap="8px" mt={4} mb={3}>
                <SectionTitle as="h3" style={{ margin: 0 }}>
                  Development Dependencies
                </SectionTitle>
                <Label variant="secondary" style={{ fontSize: 11, padding: "0 6px" }}>
                  {devDepEntries.length}
                </Label>
              </Box>
              <GlassCard style={{ padding: "6px 20px" }}>
                {devDepEntries.map(([dep, range]) => renderDepRow(dep, range, "Development & verification dependency"))}
              </GlassCard>
            </>
          )}
        </>
      )}

      {hasAdvancedExports && resources && resources.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 24,
              marginBottom: 8,
            }}
          >
            <SectionTitle as="h3" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <DatabaseIcon size={16} />
              Data Package Resources ({resources.length})
            </SectionTitle>
            {name && version && (
              <Button
                as="a"
                href={getPackageDataPackageExportUrl(name, version)}
                download
                size="small"
                leadingVisual={DownloadIcon}
              >
                datapackage.json
              </Button>
            )}
          </div>
          <GlassCard>
            {resources.map((res) => (
              <div
                key={res.path || res.name}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid var(--color-border-subtle, rgba(255,255,255,0.06))",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={{ fontWeight: 600, fontSize: 13.5 }}>{res.title || res.name}</Text>
                    {res.path && <code style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>{res.path}</code>}
                    {res.format && (
                      <Label variant="secondary" style={{ fontSize: 10 }}>
                        {res.format.toUpperCase()}
                      </Label>
                    )}
                    <Label
                      variant={res.storage === "cas" || res.storage === "s3" ? "accent" : "secondary"}
                      style={{ fontSize: 10 }}
                    >
                      {res.storage || "inline"}
                    </Label>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      fontSize: 11.5,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {typeof res.rowCount === "number" && res.rowCount > 0 && <span>{res.rowCount} rows</span>}
                    {res.hash && (
                      <code title={res.hash} style={{ fontSize: 11 }}>
                        {res.hash.slice(0, 19)}…
                      </code>
                    )}
                  </div>
                </div>
                {res.schema?.fields && res.schema.fields.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {res.schema.fields.map((field) => (
                      <span
                        key={field.name}
                        style={{
                          fontSize: 11,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "var(--color-canvas-subtle)",
                          border: "1px solid var(--color-border)",
                          fontFamily: "var(--font-mono, monospace)",
                        }}
                      >
                        {field.name}
                        {field.unit ? (
                          <strong style={{ color: "var(--color-accent-cyan, #22d3ee)", marginLeft: 4 }}>
                            [{field.unit}]
                          </strong>
                        ) : null}
                        <span style={{ color: "var(--color-text-muted)", marginLeft: 4 }}>:{field.type}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </GlassCard>
        </>
      )}

      {hasAdvancedExports && lockfile && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 24,
              marginBottom: 8,
            }}
          >
            <SectionTitle as="h3" style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheckIcon size={16} />
              Reproducible Lockfile (datapackage.lock.json)
            </SectionTitle>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                size="small"
                onClick={handleCopyLockfile}
                leadingVisual={copiedLockfile ? VerifiedIcon : CopyIcon}
              >
                {copiedLockfile ? "Copied" : "Copy Lockfile"}
              </Button>
              {name && version && (
                <Button
                  as="a"
                  href={getPackageLockfileExportUrl(name, version)}
                  download
                  size="small"
                  leadingVisual={DownloadIcon}
                >
                  Download .lock.json
                </Button>
              )}
            </div>
          </div>
          <GlassCard>
            <pre
              style={{
                margin: 0,
                maxHeight: 280,
                overflow: "auto",
                fontSize: 11.5,
                lineHeight: 1.45,
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--color-text-secondary)",
              }}
            >
              {JSON.stringify(lockfile, null, 2)}
            </pre>
          </GlassCard>
        </>
      )}

      {dependents && dependents.length > 0 && (
        <>
          <SectionTitle
            as="h3"
            style={{ marginTop: 24, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}
          >
            <PackageIcon size={16} />
            Used by ({dependents.length})
          </SectionTitle>
          <GlassCard style={{ padding: 16 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {dependents.map((dep) => (
                <DependentBadge key={dep.name} to={`/packages/${dep.name}/${dep.version}`}>
                  <PackageIcon size={12} />
                  <span>{dep.name}</span>
                  <span style={{ opacity: 0.65, fontSize: 11 }}>v{dep.version}</span>
                </DependentBadge>
              ))}
            </div>
          </GlassCard>
        </>
      )}
    </>
  );
};
