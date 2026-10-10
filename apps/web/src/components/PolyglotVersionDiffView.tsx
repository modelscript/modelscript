// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  EyeIcon,
  GitCompareIcon,
  PackageIcon,
} from "@primer/octicons-react";
import { Button, Flash, Label, Spinner } from "@primer/react";
import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { comparePackageVersions, type VersionComparisonResult } from "../api";
import { CadDiffViewer } from "./artifacts/CadDiffViewer";

interface PolyglotVersionDiffViewProps {
  packageName: string;
  currentVersion: string;
  allVersions: string[];
}

const DiffContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
`;

const HeaderCard = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

const VersionSelectGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);

  select {
    padding: 6px 12px;
    background: var(--color-canvas-default);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-primary);
    font-size: 13px;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;

    &:focus {
      outline: none;
      border-color: var(--color-accent-fg);
      box-shadow: 0 0 0 3px rgba(31, 111, 235, 0.2);
    }
  }
`;

const MetricsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const MetricBadge = styled.div<{ $color?: string; $bg?: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  color: ${(props) => props.$color || "var(--color-text-primary)"};
  background: ${(props) => props.$bg || "var(--color-canvas-subtle)"};
  border: 1px solid var(--color-border);
`;

const SectionCard = styled.div`
  background: var(--surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  overflow: hidden;
`;

const SectionHeader = styled.div`
  padding: 12px 16px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
`;

const DiffItemRow = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 8px;

  &:last-child {
    border-bottom: none;
  }
`;

const ParamChangeTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 12px;

  th {
    text-align: left;
    padding: 6px 10px;
    color: var(--color-text-secondary);
    font-weight: 600;
    border-bottom: 1px solid var(--color-border);
  }

  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  tr:last-child td {
    border-bottom: none;
  }
`;

const OldValue = styled.span`
  color: var(--color-danger-fg, #cf222e);
  text-decoration: line-through;
  background: rgba(207, 34, 46, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
`;

const NewValue = styled.span`
  color: var(--color-success-fg, #2da44e);
  font-weight: 600;
  background: rgba(45, 164, 78, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
`;

export const PolyglotVersionDiffView: React.FC<PolyglotVersionDiffViewProps> = ({
  packageName,
  currentVersion,
  allVersions,
}) => {
  // Default base to previous version if available, or first version
  const sortedVersions = [...allVersions];
  const currentIndex = sortedVersions.indexOf(currentVersion);
  const defaultBase =
    currentIndex > 0
      ? sortedVersions[currentIndex - 1]
      : sortedVersions.length > 1
        ? sortedVersions[0] === currentVersion
          ? sortedVersions[1]
          : sortedVersions[0]
        : currentVersion;

  const [baseVersion, setBaseVersion] = useState<string>(defaultBase);
  const [headVersion, setHeadVersion] = useState<string>(currentVersion);
  const [loading, setLoading] = useState<boolean>(false);
  const [diff, setDiff] = useState<VersionComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCadDiffFile, setActiveCadDiffFile] = useState<string | null>(null);

  useEffect(() => {
    if (!packageName || !baseVersion || !headVersion) return;
    if (baseVersion === headVersion) {
      setDiff(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    comparePackageVersions(packageName, baseVersion, headVersion)
      .then((data) => {
        if (active) {
          setDiff(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.response?.data?.error || err.message || "Failed to compare versions");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [packageName, baseVersion, headVersion]);

  return (
    <DiffContainer>
      {/* ── Version Selector Header ── */}
      <HeaderCard>
        <VersionSelectGroup>
          <GitCompareIcon size={18} />
          <span>Base version:</span>
          <select value={baseVersion} onChange={(e) => setBaseVersion(e.target.value)}>
            {allVersions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
          <ChevronRightIcon size={16} />
          <span>Head version:</span>
          <select value={headVersion} onChange={(e) => setHeadVersion(e.target.value)}>
            {allVersions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
        </VersionSelectGroup>

        {diff && (
          <MetricsRow>
            {diff.classes.added.length > 0 && (
              <MetricBadge $color="#2da44e" $bg="rgba(45, 164, 78, 0.1)">
                <DiffAddedIcon size={14} /> +{diff.classes.added.length} classes
              </MetricBadge>
            )}
            {diff.classes.removed.length > 0 && (
              <MetricBadge $color="#cf222e" $bg="rgba(207, 34, 46, 0.1)">
                <DiffRemovedIcon size={14} /> -{diff.classes.removed.length} classes
              </MetricBadge>
            )}
            {diff.classes.modified.length > 0 && (
              <MetricBadge $color="#bf8700" $bg="rgba(191, 135, 0, 0.1)">
                <DiffModifiedIcon size={14} /> {diff.classes.modified.length} modified
              </MetricBadge>
            )}
            {diff.cadChanges.length > 0 && (
              <MetricBadge $color="#8250df" $bg="rgba(130, 80, 223, 0.1)">
                <PackageIcon size={14} /> {diff.cadChanges.length} CAD models
              </MetricBadge>
            )}
            {diff.parityDrift.length > 0 && (
              <MetricBadge $color="#d97706" $bg="rgba(217, 119, 6, 0.15)">
                <AlertIcon size={14} /> {diff.parityDrift.length} unit shifts
              </MetricBadge>
            )}
          </MetricsRow>
        )}
      </HeaderCard>

      {/* ── Same version banner ── */}
      {baseVersion === headVersion && (
        <Flash variant="default">
          Selected versions are identical (v{baseVersion}). Select two different releases above to view the polyglot
          delta.
        </Flash>
      )}

      {/* ── Loading state ── */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 60, gap: 12 }}>
          <Spinner size="medium" />
          <span style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>
            Computing polyglot AST and CAD geometry diff...
          </span>
        </div>
      )}

      {/* ── Error state ── */}
      {error && <Flash variant="danger">{error}</Flash>}

      {/* ── Parity Drift Warnings ── */}
      {diff && diff.parityDrift.length > 0 && (
        <Flash variant="warning">
          <strong>Physical Unit Parity Drift Detected!</strong> The following parameters changed their dimensional unit
          type between v{baseVersion} and v{headVersion}:
          <ul style={{ margin: "8px 0 0 20px" }}>
            {diff.parityDrift.map((p, idx) => (
              <li key={idx}>
                <code>
                  {p.className}.{p.parameter}
                </code>
                : changed from <OldValue>{p.oldUnit}</OldValue> to <NewValue>{p.newUnit}</NewValue>
              </li>
            ))}
          </ul>
        </Flash>
      )}

      {/* ── Physical Classes & Parameter Drift ── */}
      {diff && (
        <SectionCard>
          <SectionHeader>
            <span>Physical Equations & Component Parameters</span>
            <Label variant="secondary">
              {diff.classes.added.length + diff.classes.removed.length + diff.classes.modified.length} changes
            </Label>
          </SectionHeader>

          {diff.classes.added.length === 0 &&
          diff.classes.removed.length === 0 &&
          diff.classes.modified.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-secondary)", fontSize: 13 }}>
              <CheckIcon size={16} style={{ color: "var(--color-success-fg)", marginRight: 6 }} />
              No equation or parameter changes between these versions.
            </div>
          ) : (
            <>
              {diff.classes.modified.map((cls) => (
                <DiffItemRow key={cls.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DiffModifiedIcon size={16} style={{ color: "var(--color-attention-fg, #bf8700)" }} />
                    <strong style={{ fontSize: 14 }}>{cls.name}</strong>
                    <Label variant="accent">{cls.kind}</Label>
                  </div>
                  <ParamChangeTable>
                    <thead>
                      <tr>
                        <th>Parameter</th>
                        <th>v{baseVersion} (Old)</th>
                        <th>v{headVersion} (New)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cls.parameterChanges.map((param) => (
                        <tr key={param.name}>
                          <td>
                            <code>{param.name}</code>
                          </td>
                          <td>
                            <OldValue>{param.old !== null ? String(param.old) : "None"}</OldValue>
                          </td>
                          <td>
                            <NewValue>{param.new !== null ? String(param.new) : "None"}</NewValue>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </ParamChangeTable>
                </DiffItemRow>
              ))}

              {diff.classes.added.map((cls) => (
                <DiffItemRow key={cls.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DiffAddedIcon size={16} style={{ color: "var(--color-success-fg, #2da44e)" }} />
                    <strong style={{ fontSize: 14 }}>{cls.name}</strong>
                    <Label variant="success">Added</Label>
                    <Label variant="accent">{cls.kind}</Label>
                    {cls.description && (
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{cls.description}</span>
                    )}
                  </div>
                </DiffItemRow>
              ))}

              {diff.classes.removed.map((cls) => (
                <DiffItemRow key={cls.name}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <DiffRemovedIcon size={16} style={{ color: "var(--color-danger-fg, #cf222e)" }} />
                    <strong style={{ fontSize: 14 }}>{cls.name}</strong>
                    <Label variant="danger">Removed</Label>
                    <Label variant="accent">{cls.kind}</Label>
                    {cls.description && (
                      <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{cls.description}</span>
                    )}
                  </div>
                </DiffItemRow>
              ))}
            </>
          )}
        </SectionCard>
      )}

      {/* ── 3D CAD Geometry & Volume Drift ── */}
      {diff && diff.cadChanges.length > 0 && (
        <SectionCard>
          <SectionHeader>
            <span>3D CAD Assemblies & B-Rep Volume Drift</span>
            <Label variant="secondary">{diff.cadChanges.length} files</Label>
          </SectionHeader>

          {diff.cadChanges.map((cad) => (
            <DiffItemRow key={cad.file}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PackageIcon size={16} style={{ color: "var(--color-accent-fg)" }} />
                  <code>{cad.file}</code>
                  {cad.status === "added" && <Label variant="success">New CAD Model</Label>}
                  {cad.status === "removed" && <Label variant="danger">Deleted CAD Model</Label>}
                  {cad.status === "modified" && <Label variant="attention">Geometry Modified</Label>}
                  {cad.status === "unchanged" && <Label variant="secondary">Identical Geometry</Label>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {cad.volumeDeltaPercent !== undefined && (
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {cad.volumeDeltaPercent > 0 ? (
                        <span style={{ color: "var(--color-success-fg, #2da44e)" }}>
                          +{cad.volumeDeltaPercent}% volume expansion
                        </span>
                      ) : (
                        <span style={{ color: "var(--color-attention-fg, #bf8700)" }}>
                          {cad.volumeDeltaPercent}% lightweighting
                        </span>
                      )}
                    </div>
                  )}
                  <Button
                    size="small"
                    variant={activeCadDiffFile === cad.file ? "primary" : "default"}
                    onClick={() => setActiveCadDiffFile(activeCadDiffFile === cad.file ? null : cad.file)}
                    sx={{ fontSize: 12 }}
                  >
                    <EyeIcon size={14} /> {activeCadDiffFile === cad.file ? "Hide 3D Diff" : "Inspect 3D Diff"}
                  </Button>
                </div>
              </div>

              {activeCadDiffFile === cad.file && (
                <div style={{ marginTop: 12 }}>
                  <CadDiffViewer
                    baseMeshUrl={`/api/v1/libraries/${encodeURIComponent(packageName)}/${encodeURIComponent(baseVersion)}/cad-mesh/${cad.file}`}
                    headMeshUrl={`/api/v1/libraries/${encodeURIComponent(packageName)}/${encodeURIComponent(headVersion)}/cad-mesh/${cad.file}`}
                    fileName={cad.file}
                    baseVersion={baseVersion}
                    headVersion={headVersion}
                    height={480}
                    onClose={() => setActiveCadDiffFile(null)}
                  />
                </div>
              )}
            </DiffItemRow>
          ))}
        </SectionCard>
      )}
    </DiffContainer>
  );
};
