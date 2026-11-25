// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiffEditor } from "@monaco-editor/react";
import { GitCompareIcon } from "@primer/octicons-react";
import { Dialog, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { getArtifactView } from "../../api";
import { useTheme } from "../../theme";
import { ensureMonacoThemesDefined, getMonacoThemeName } from "../../util/monaco-theme";
import { getCachedArtifact } from "../../util/offline-storage";
import Box from "../Box";
import Spinner from "../Spinner";

interface DiffArtifactConfig {
  code?: string | undefined;
  modelicaCode?: string | undefined;
  sysmlCode?: string | undefined;
  stepCode?: string | undefined;
  scadCode?: string | undefined;
  language?: string | undefined;
  dialect?: string | undefined;
  filename?: string | undefined;
  title?: string | undefined;
  [key: string]: unknown;
}

interface DiffArtifactRecord {
  id?: number | string | undefined;
  view_type?: string | undefined;
  viewType?: string | undefined;
  view_config?: string | DiffArtifactConfig | Record<string, unknown> | undefined;
  viewConfigJson?: string | DiffArtifactConfig | Record<string, unknown> | undefined;
  title?: string | null | undefined;
  artifactView?: DiffArtifactRecord | undefined;
  [key: string]: unknown;
}

function parseArtifactConfig(artifact: DiffArtifactRecord | null | undefined): DiffArtifactConfig {
  const raw = artifact?.view_config ?? artifact?.viewConfigJson;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as DiffArtifactConfig) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as DiffArtifactConfig;
  }
  return {};
}

interface ArtifactDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentArtifact: DiffArtifactRecord | null | undefined;
  forkedFromArtifactId: number | string;
}

const ModeButton = styled.button<{ $active: boolean }>`
  background: ${(props) => (props.$active ? "rgba(6, 182, 212, 0.2)" : "transparent")};
  color: ${(props) => (props.$active ? "#06b6d4" : "var(--color-fg-muted)")};
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--color-fg-default);
  }
`;

interface ParameterDelta {
  name: string;
  parentVal: string;
  forkVal: string;
  delta?: number | undefined;
  pctChange?: string | undefined;
  status: "modified" | "added" | "removed";
}

import { parseModelicaParameters } from "../../util/modelica-params";
import { AnsatzSemanticDiffStudio } from "../diff/AnsatzSemanticDiffStudio";

export const ArtifactDiffModal: React.FC<ArtifactDiffModalProps> = ({
  isOpen,
  onClose,
  currentArtifact,
  forkedFromArtifactId,
}) => {
  const { theme } = useTheme();
  const [parentArtifact, setParentArtifact] = useState<DiffArtifactRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"studio" | "diff" | "parameters">("studio");

  useEffect(() => {
    if (!isOpen || !forkedFromArtifactId) return;
    let active = true;
    setLoading(true);
    setError(null);

    getArtifactView(forkedFromArtifactId)
      .then((data) => {
        if (!active) return;
        const viewRecord = (data as DiffArtifactRecord | undefined)?.artifactView;
        if (viewRecord) {
          setParentArtifact(viewRecord);
        } else {
          throw new Error("Upstream artifact not found.");
        }
      })
      .catch(async () => {
        const cached = await getCachedArtifact(forkedFromArtifactId);
        if (active) {
          if (cached) {
            setParentArtifact(cached as unknown as DiffArtifactRecord);
          } else {
            setError(`Could not retrieve upstream parent artifact #${forkedFromArtifactId}.`);
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, forkedFromArtifactId]);

  const currentCode = useMemo(() => {
    const config = parseArtifactConfig(currentArtifact);
    return (
      config.code ||
      config.modelicaCode ||
      config.sysmlCode ||
      config.stepCode ||
      config.scadCode ||
      "// No code available for forked model\n"
    );
  }, [currentArtifact]);

  const parentCode = useMemo(() => {
    const config = parseArtifactConfig(parentArtifact);
    return (
      config.code ||
      config.modelicaCode ||
      config.sysmlCode ||
      config.stepCode ||
      config.scadCode ||
      "// No code available for upstream model\n"
    );
  }, [parentArtifact]);

  const parameterDeltas = useMemo<ParameterDelta[]>(() => {
    const parentParams = parseModelicaParameters(parentCode);
    const forkParams = parseModelicaParameters(currentCode);
    const deltas: ParameterDelta[] = [];

    const allKeys = Array.from(new Set([...Object.keys(parentParams), ...Object.keys(forkParams)]));

    for (const key of allKeys) {
      const parentVal = parentParams[key];
      const forkVal = forkParams[key]!;

      if (parentVal !== undefined && forkVal !== undefined) {
        if (parentVal !== forkVal) {
          const numP = parseFloat(parentVal);
          const numF = parseFloat(forkVal);
          let delta: number | undefined;
          let pct: string | undefined;

          if (!isNaN(numP) && !isNaN(numF)) {
            delta = numF - numP;
            if (numP !== 0) {
              const p = ((numF - numP) / Math.abs(numP)) * 100;
              pct = `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
            }
          }

          deltas.push({
            name: key,
            parentVal,
            forkVal,
            delta,
            pctChange: pct,
            status: "modified",
          });
        }
      } else if (parentVal === undefined) {
        deltas.push({
          name: key,
          parentVal: "—",
          forkVal,
          status: "added",
        });
      } else {
        deltas.push({
          name: key,
          parentVal,
          forkVal: "—",
          status: "removed",
        });
      }
    }

    return deltas;
  }, [parentCode, currentCode]);

  const diffLanguage = useMemo(() => {
    const config = parseArtifactConfig(currentArtifact);

    const rawType = String(
      config.language ||
        config.dialect ||
        currentArtifact?.view_type ||
        currentArtifact?.viewType ||
        parentArtifact?.view_type ||
        config.filename ||
        config.title ||
        "",
    ).toLowerCase();

    if (rawType.includes("sysml") || rawType.endsWith(".sysml") || rawType.endsWith(".kerml") || config.sysmlCode) {
      return "sysml2";
    }
    if (rawType.includes("step") || rawType.endsWith(".step") || rawType.endsWith(".stp") || config.stepCode) {
      return "step";
    }
    if (rawType.includes("scad") || rawType.includes("csg") || rawType.endsWith(".scad") || config.scadCode) {
      return "scad";
    }
    if (
      rawType.includes("xml") ||
      rawType.includes("ssp") ||
      rawType.includes("pscad") ||
      rawType.includes("sbml") ||
      rawType.includes("jsbsim") ||
      rawType.includes("urdf") ||
      rawType.includes("autosar") ||
      rawType.includes("reqif") ||
      rawType.includes("openscenario") ||
      rawType.includes("opendrive")
    ) {
      return "xml";
    }
    if (rawType.includes("json")) {
      return "json";
    }
    if (rawType.includes("csv") || rawType.includes("tsv")) {
      return "plaintext";
    }
    if (rawType.includes("c99") || rawType === "c" || rawType.endsWith(".c") || rawType.endsWith(".h")) {
      return "c";
    }
    if (rawType.includes("python") || rawType.endsWith(".py")) {
      return "python";
    }
    if (rawType.includes("modelscript") || rawType.includes("msx") || rawType.endsWith(".msx")) {
      return "modelscript";
    }
    return "modelica";
  }, [currentArtifact, parentArtifact]);

  if (!isOpen) return null;

  return (
    <Dialog
      title={
        <Box display="flex" alignItems="center" gap={2}>
          <GitCompareIcon size={18} fill="var(--ms-accent, #06b6d4)" />
          <Text fontWeight="bold" fontSize="14px" color="var(--color-fg-default)">
            Model Changes vs Upstream #{forkedFromArtifactId}
          </Text>
        </Box>
      }
      width="xlarge"
      onClose={onClose}
    >
      <Box display="flex" flexDirection="column" height="75vh" overflow="hidden">
        <Box
          display="flex"
          alignItems="center"
          justifyContent="flex-end"
          pb={2}
          mb={2}
          borderBottom="1px solid var(--ms-border-subtle, var(--color-border-default))"
        >
          <Box
            display="flex"
            bg="var(--ms-surface-subtle, rgba(0, 0, 0, 0.3))"
            p="3px"
            borderRadius="8px"
            border="1px solid var(--ms-border-subtle, var(--color-border-default))"
          >
            <ModeButton $active={activeTab === "studio"} onClick={() => setActiveTab("studio")}>
              ⚡ Semantic Studio
            </ModeButton>
            <ModeButton $active={activeTab === "diff"} onClick={() => setActiveTab("diff")}>
              Source Diff
            </ModeButton>
            <ModeButton $active={activeTab === "parameters"} onClick={() => setActiveTab("parameters")}>
              Parameters ({parameterDeltas.length})
            </ModeButton>
          </Box>
        </Box>

        <Box flex={1} position="relative" overflow="hidden">
          {loading ? (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              height="100%"
              flexDirection="column"
              gap={2}
            >
              <Spinner size="medium" />
              <Text fontSize="13px" color="var(--color-fg-muted)">
                Loading upstream artifact #{forkedFromArtifactId}…
              </Text>
            </Box>
          ) : error ? (
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              height="100%"
              flexDirection="column"
              gap={2}
              p={4}
            >
              <Text color="var(--color-danger-fg)" fontWeight="bold">
                {error}
              </Text>
              <Button size="small" onClick={onClose}>
                Close
              </Button>
            </Box>
          ) : activeTab === "studio" ? (
            <Box height="100%" overflow="auto" p={3} bg="var(--color-canvas-default)">
              <AnsatzSemanticDiffStudio
                oldCode={parentCode}
                newCode={currentCode}
                filename={`Artifact #${currentArtifact?.id || "fork"}`}
                language={diffLanguage}
                baseLabel={`Upstream #${forkedFromArtifactId}`}
                headLabel={`Fork #${currentArtifact?.id || "current"}`}
                editorHeight={380}
              />
            </Box>
          ) : activeTab === "diff" ? (
            <DiffEditor
              height="100%"
              original={parentCode}
              modified={currentCode}
              language={diffLanguage}
              theme={getMonacoThemeName(theme)}
              beforeMount={ensureMonacoThemesDefined}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                renderSideBySide: true,
                automaticLayout: true,
                scrollBeyondLastLine: false,
                fontSize: 13,
                wordWrap: "on",
              }}
            />
          ) : (
            <Box height="100%" overflow="auto" p={4} bg="var(--color-canvas-default)">
              {parameterDeltas.length === 0 ? (
                <Box textAlign="center" py={6} color="var(--color-fg-muted)">
                  No parameter differences detected between models.
                </Box>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "13px",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <thead>
                    <tr
                      style={{
                        borderBottom: "1px solid var(--color-border-default)",
                        color: "var(--color-fg-muted)",
                        textAlign: "left",
                      }}
                    >
                      <th style={{ padding: "8px 12px" }}>Parameter</th>
                      <th style={{ padding: "8px 12px" }}>Original #{forkedFromArtifactId}</th>
                      <th style={{ padding: "8px 12px" }}>Fork #{currentArtifact?.id}</th>
                      <th style={{ padding: "8px 12px" }}>Delta</th>
                      <th style={{ padding: "8px 12px" }}>% Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parameterDeltas.map((delta) => {
                      const isModified = delta.status === "modified";
                      const isAdded = delta.status === "added";
                      const isRemoved = delta.status === "removed";
                      return (
                        <tr
                          key={delta.name}
                          style={{
                            borderBottom: "1px solid var(--color-border-subtle)",
                            backgroundColor: isAdded
                              ? "rgba(46, 160, 67, 0.1)"
                              : isRemoved
                                ? "rgba(248, 81, 73, 0.1)"
                                : "transparent",
                          }}
                        >
                          <td style={{ padding: "10px 12px", fontWeight: "bold", color: "var(--color-fg-default)" }}>
                            {delta.name}
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--color-fg-muted)" }}>{delta.parentVal}</td>
                          <td
                            style={{
                              padding: "10px 12px",
                              color: isAdded ? "var(--ms-success)" : isModified ? "var(--ms-accent-cyan)" : "inherit",
                              fontWeight: 600,
                            }}
                          >
                            {delta.forkVal}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {delta.delta !== undefined ? (
                              <span
                                style={{
                                  color:
                                    delta.delta > 0
                                      ? "var(--ms-success)"
                                      : delta.delta < 0
                                        ? "var(--ms-danger)"
                                        : "inherit",
                                }}
                              >
                                {delta.delta > 0 ? `+${delta.delta}` : delta.delta}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {delta.pctChange ? (
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: delta.pctChange.startsWith("+") ? "var(--ms-success)" : "var(--ms-danger)",
                                }}
                              >
                                {delta.pctChange}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Dialog>
  );
};

export default ArtifactDiffModal;
