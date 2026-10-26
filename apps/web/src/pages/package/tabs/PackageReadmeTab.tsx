// SPDX-License-Identifier: AGPL-3.0-or-later

import { SyncIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import React, { useState } from "react";
import { getDiagramUrl, rewriteModelicaUris, type ClassDetail, type NpmPackument } from "../../../api";
import Box from "../../../components/Box";
import InvertedSvg from "../../../components/InvertedSvg";
import { DiagramWrap, DocCard, GlassCard } from "../types";

export interface PackageReadmeTabProps {
  name: string;
  version: string;
  rootClassName?: string | undefined;
  rootClass?: ClassDetail | null | undefined;
  packument?: NpmPackument | null | undefined;
  availableDomains: { id: string; label: string; count: number }[];
  onNavigateToDigitalThread: () => void;
  jobStatus?: string | undefined;
}

export const PackageReadmeTab: React.FC<PackageReadmeTabProps> = ({
  name,
  version,
  rootClassName,
  rootClass,
  packument,
  availableDomains,
  onNavigateToDigitalThread,
  jobStatus,
}) => {
  const [diagramLoaded, setDiagramLoaded] = useState(false);
  const [diagramError, setDiagramError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  return (
    <>
      {/* Cyber-Physical Digital Thread Banner */}
      {availableDomains.length > 2 && (
        <GlassCard
          style={{
            padding: "14px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(168, 85, 247, 0.08))",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: 12,
          }}
        >
          <Box display="flex" alignItems="center" gap={3}>
            <SyncIcon size={20} fill="#06b6d4" />
            <div>
              <Text style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text-heading)" }}>
                Cross-Domain Digital Thread Active
              </Text>
              <Text as="p" style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 0" }}>
                Multi-language twins bound across Modelica, SysML v2, and STEP CAD with verified unit parity.
              </Text>
            </div>
          </Box>
          <Button size="small" variant="primary" onClick={onNavigateToDigitalThread}>
            Explore Twins
          </Button>
        </GlassCard>
      )}

      {/* Root class diagram */}
      {!diagramError && (
        <div style={diagramLoaded ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}>
          <DiagramWrap>
            <InvertedSvg
              src={`${getDiagramUrl(name, version, rootClassName || name)}?t=${retryCount}`}
              alt={`${name} diagram`}
              onLoad={() => setDiagramLoaded(true)}
              onError={() => {
                if (jobStatus && jobStatus !== "completed" && jobStatus !== "failed") {
                  setTimeout(() => setRetryCount((p) => p + 1), 3000);
                } else {
                  setDiagramError(true);
                }
              }}
            />
          </DiagramWrap>
        </div>
      )}

      <DocCard>
        {rootClass?.documentation ? (
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(rewriteModelicaUris(rootClass.documentation, version, name)),
            }}
          />
        ) : packument?.readme && !packument.readme.includes("ERROR: No README data found!") ? (
          <div
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(
                rewriteModelicaUris(
                  marked.parse(packument.readme, { breaks: true, gfm: true }) as string,
                  version,
                  name,
                ),
              ),
            }}
          />
        ) : rootClass?.description ? (
          <Text as="p" style={{ color: "var(--color-text-primary)", lineHeight: 1.7, margin: 0 }}>
            {rootClass.description}
          </Text>
        ) : (
          <Text as="p" style={{ color: "var(--color-text-muted)", fontStyle: "italic", margin: 0 }}>
            No documentation available for this artifact.
          </Text>
        )}
      </DocCard>
    </>
  );
};
