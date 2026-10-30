// SPDX-License-Identifier: AGPL-3.0-or-later

import { CopyIcon, DatabaseIcon, DownloadIcon, ShieldCheckIcon, VerifiedIcon } from "@primer/octicons-react";
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
import { DepRow, GlassCard, SectionTitle } from "../types";

export interface PackageDependenciesTabProps {
  name?: string | undefined;
  version?: string | undefined;
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string> | undefined;
  resources?: DataPackageResourceSummary[] | undefined;
}

export const PackageDependenciesTab: React.FC<PackageDependenciesTabProps> = ({
  name,
  version,
  dependencies,
  devDependencies,
  resources,
}) => {
  const [lockfile, setLockfile] = useState<DataPackageLockJsonSummary | null>(null);
  const [copiedLockfile, setCopiedLockfile] = useState(false);

  useEffect(() => {
    if (!name || !version) return;
    let cancelled = false;
    getPackageLockfile(name, version).then((res) => {
      if (!cancelled) setLockfile(res);
    });
    return () => {
      cancelled = true;
    };
  }, [name, version]);

  const handleCopyLockfile = () => {
    if (!lockfile) return;
    navigator.clipboard.writeText(JSON.stringify(lockfile, null, 2));
    setCopiedLockfile(true);
    setTimeout(() => setCopiedLockfile(false), 2000);
  };

  return (
    <>
      <SectionTitle as="h3">Dependencies</SectionTitle>
      <GlassCard>
        {Object.keys(dependencies).length > 0 ? (
          Object.entries(dependencies).map(([dep, range]) => (
            <DepRow key={dep}>
              <Link
                to={`/packages/${dep}`}
                style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
              >
                {dep}
              </Link>
              <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>{range}</Text>
            </DepRow>
          ))
        ) : (
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
            No dependencies.
          </Text>
        )}
      </GlassCard>

      {devDependencies && Object.keys(devDependencies).length > 0 && (
        <>
          <SectionTitle as="h3" style={{ marginTop: 24 }}>
            Dev Dependencies
          </SectionTitle>
          <GlassCard>
            {Object.entries(devDependencies).map(([dep, range]) => (
              <DepRow key={dep}>
                <Link
                  to={`/packages/${dep}`}
                  style={{ color: "var(--color-link)", textDecoration: "none", fontSize: 14 }}
                >
                  {dep}
                </Link>
                <Text style={{ color: "var(--color-text-muted)", fontSize: 13, fontFamily: "monospace" }}>{range}</Text>
              </DepRow>
            ))}
          </GlassCard>
        </>
      )}

      {resources && resources.length > 0 && (
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
                          background: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.08)",
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

      {lockfile && (
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
