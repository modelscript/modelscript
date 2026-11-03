// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArrowRightIcon,
  CopyIcon,
  DatabaseIcon,
  DependabotIcon,
  DownloadIcon,
  PackageIcon,
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
} from "../../../api";
import Box from "../../../components/Box";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { DepRow, GlassCard, SectionTitle } from "../types";

export interface PackageDependenciesTabProps {
  name?: string | undefined;
  version?: string | undefined;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
  resources?: DataPackageResourceSummary[] | undefined;
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

export const PackageDependenciesTab: React.FC<PackageDependenciesTabProps> = ({
  name,
  version,
  dependencies,
  devDependencies,
  resources,
}) => {
  const hasAdvancedExports = useFeatureFlag("package_advanced_exports");
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
            Runtime Dependencies
          </SectionTitle>
          <Label variant="secondary" style={{ fontSize: 11, padding: "0 6px" }}>
            {depEntries.length}
          </Label>
        </Box>
      </Box>

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
    </>
  );
};
