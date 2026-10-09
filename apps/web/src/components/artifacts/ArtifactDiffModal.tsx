// SPDX-License-Identifier: AGPL-3.0-or-later

import { DiffEditor } from "@monaco-editor/react";
import { GitCompareIcon, XIcon } from "@primer/octicons-react";
import { Button, IconButton, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { getArtifactView } from "../../api";
import { useTheme } from "../../theme";
import { getCachedArtifact } from "../../util/offline-storage";
import Box from "../Box";

interface ArtifactDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentArtifact: any;
  forkedFromArtifactId: number | string;
}

const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
`;

const ModalContainer = styled.div`
  width: 100%;
  max-width: 1100px;
  height: 85vh;
  background: var(--color-canvas-default, #0d1117);
  border: 1px solid var(--color-border-default, #30363d);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const ModalHeader = styled.div`
  height: 54px;
  min-height: 54px;
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border-default, #30363d);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-canvas-subtle, #161b22);
`;

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
  delta?: number;
  pctChange?: string;
  status: "modified" | "added" | "removed";
}

function parseModelicaParameters(code: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!code) return result;
  const regex = /parameter\s+(?:Real|Integer|Boolean|String)\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(code)) !== null) {
    const [, name, rawVal] = match;
    let val = rawVal.trim();
    const commentMatch = val.match(/^(.*?)\s*("[^"]*")\s*$/);
    if (commentMatch) {
      const exprPart = commentMatch[1].trim();
      if (exprPart.length > 0) {
        val = exprPart;
      }
    }
    result[name.trim()] = val.trim();
  }
  return result;
}

export const ArtifactDiffModal: React.FC<ArtifactDiffModalProps> = ({
  isOpen,
  onClose,
  currentArtifact,
  forkedFromArtifactId,
}) => {
  const { theme } = useTheme();
  const [parentArtifact, setParentArtifact] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"diff" | "parameters">("diff");

  useEffect(() => {
    if (!isOpen || !forkedFromArtifactId) return;
    let active = true;
    setLoading(true);
    setError(null);

    getArtifactView(forkedFromArtifactId)
      .then((data) => {
        if (!active) return;
        if (data?.artifactView) {
          setParentArtifact(data.artifactView);
        } else {
          throw new Error("Upstream artifact not found.");
        }
      })
      .catch(async () => {
        const cached = await getCachedArtifact(forkedFromArtifactId);
        if (active) {
          if (cached) {
            setParentArtifact(cached);
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
    const config =
      typeof currentArtifact?.view_config === "string"
        ? JSON.parse(currentArtifact.view_config || "{}")
        : currentArtifact?.view_config || {};
    return config.code || "// No code available for forked model\n";
  }, [currentArtifact]);

  const parentCode = useMemo(() => {
    const config =
      typeof parentArtifact?.view_config === "string"
        ? JSON.parse(parentArtifact.view_config || "{}")
        : parentArtifact?.view_config || {};
    return config.code || "// No code available for upstream model\n";
  }, [parentArtifact]);

  const parameterDeltas = useMemo<ParameterDelta[]>(() => {
    const parentParams = parseModelicaParameters(parentCode);
    const forkParams = parseModelicaParameters(currentCode);
    const deltas: ParameterDelta[] = [];

    const allKeys = Array.from(new Set([...Object.keys(parentParams), ...Object.keys(forkParams)]));

    for (const key of allKeys) {
      const parentVal = parentParams[key];
      const forkVal = forkParams[key];

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

  if (!isOpen) return null;

  return (
    <Overlay onClick={onClose}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <Box display="flex" alignItems="center" gap={2}>
            <GitCompareIcon size={18} fill="var(--color-accent-cyan, #06b6d4)" />
            <Text fontWeight="bold" fontSize="14px" color="var(--color-fg-default)">
              Model Changes vs Upstream #{forkedFromArtifactId}
            </Text>
          </Box>

          <Box display="flex" alignItems="center" gap={3}>
            <Box
              display="flex"
              bg="rgba(0,0,0,0.3)"
              p="3px"
              borderRadius="8px"
              border="1px solid var(--color-border-default)"
            >
              <ModeButton $active={activeTab === "diff"} onClick={() => setActiveTab("diff")}>
                Source Diff
              </ModeButton>
              <ModeButton $active={activeTab === "parameters"} onClick={() => setActiveTab("parameters")}>
                Parameters ({parameterDeltas.length})
              </ModeButton>
            </Box>

            <IconButton
              aria-label="Close"
              icon={XIcon}
              variant="invisible"
              onClick={onClose}
              sx={{ color: "var(--color-fg-muted)" }}
            />
          </Box>
        </ModalHeader>

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
          ) : activeTab === "diff" ? (
            <DiffEditor
              height="100%"
              original={parentCode}
              modified={currentCode}
              language="modelica"
              theme={theme === "dark" ? "vs-dark" : "light"}
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
                      <th style={{ padding: "8px 12px" }}>Fork #{currentArtifact.id}</th>
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
                              color: isAdded ? "#3fb950" : isModified ? "#06b6d4" : "inherit",
                              fontWeight: 600,
                            }}
                          >
                            {delta.forkVal}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {delta.delta !== undefined ? (
                              <span
                                style={{ color: delta.delta > 0 ? "#3fb950" : delta.delta < 0 ? "#f85149" : "inherit" }}
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
                                  color: delta.pctChange.startsWith("+") ? "#3fb950" : "#f85149",
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
      </ModalContainer>
    </Overlay>
  );
};

export default ArtifactDiffModal;
