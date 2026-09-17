// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { CheckIcon, CopyIcon, DownloadIcon, FileCodeIcon, PackageIcon, ToolsIcon } from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useState } from "react";
import Box from "../Box";
import CadStepViewer from "./CadStepViewer";

export interface AasPackageViewerProps {
  viewConfig: {
    packageName: string;
    version: string;
    manifest?: any;
    cadUrl?: string;
    variants?: string[];
    instances?: Array<{
      serialNumber: string;
      variant?: string;
      birthData?: Record<string, any>;
    }>;
  };
  isFullScreen?: boolean;
}

export const AasPackageViewer: React.FC<AasPackageViewerProps> = ({ viewConfig, isFullScreen }) => {
  const [activeTab, setActiveTab] = useState<"nameplate" | "bom" | "cad" | "instructions" | "instances">("nameplate");
  const [selectedVariant, setSelectedVariant] = useState<string>(viewConfig.variants?.[0] || "default");
  const [copiedNpm, setCopiedNpm] = useState(false);

  const manifest = viewConfig.manifest || {};
  const bom = manifest.bom || [];
  const instructions = manifest.makingInstructions || [];
  const variants = viewConfig.variants || Object.keys(manifest.variants || {});
  const instances = viewConfig.instances || [];

  const copyNpmCmd = () => {
    navigator.clipboard.writeText(`npm install ${viewConfig.packageName}@${viewConfig.version}`);
    setCopiedNpm(true);
    setTimeout(() => setCopiedNpm(false), 2000);
  };

  const exportAasxUrl = `/api/v1/libraries/${encodeURIComponent(viewConfig.packageName)}/${viewConfig.version}/export/aasx${selectedVariant !== "default" ? `?variant=${selectedVariant}` : ""}`;
  const exportOkhUrl = `/api/v1/libraries/${encodeURIComponent(viewConfig.packageName)}/${viewConfig.version}/export/okh${selectedVariant !== "default" ? `?variant=${selectedVariant}` : ""}`;
  const exportTgzUrl = `/api/v1/libraries/${encodeURIComponent(viewConfig.packageName)}/${viewConfig.version}/download`;

  return (
    <Box
      display="flex"
      flexDirection="column"
      bg="var(--color-canvas-subtle)"
      borderRadius="12px"
      border="1px solid var(--color-border-default)"
      overflow="hidden"
      height={isFullScreen ? "100vh" : "620px"}
    >
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <Box
        p={3}
        bg="var(--color-canvas-default)"
        borderBottom="1px solid var(--color-border-default)"
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        gap={2}
      >
        <Box display="flex" alignItems="center" gap={2}>
          <Box p={2} bg="rgba(9, 105, 218, 0.1)" borderRadius="8px">
            <PackageIcon size={20} fill="#0969da" />
          </Box>
          <Box>
            <Box display="flex" alignItems="center" gap={2}>
              <Text fontSize={3} fontWeight="bold">
                {manifest.title || viewConfig.packageName}
              </Text>
              <Text
                fontSize={1}
                px={2}
                py="2px"
                bg="var(--color-neutral-muted)"
                borderRadius="12px"
                color="var(--color-fg-muted)"
              >
                v{viewConfig.version}
              </Text>
              <Text
                fontSize={1}
                px={2}
                py="2px"
                bg="rgba(46, 160, 67, 0.15)"
                color="#2ea043"
                borderRadius="12px"
                fontWeight="bold"
              >
                IEC 63278 AAS
              </Text>
            </Box>
            <Text fontSize={1} color="var(--color-fg-muted)">
              {manifest.globalAssetId || `urn:modelscript:${viewConfig.packageName}`}
            </Text>
          </Box>
        </Box>

        {/* ── Action & Export Controls ─────────────────────────────── */}
        <Box display="flex" alignItems="center" gap={2}>
          {variants.length > 0 && (
            <select
              value={selectedVariant}
              onChange={(e) => setSelectedVariant(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                background: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontSize: "12px",
              }}
            >
              {variants.map((v) => (
                <option key={v} value={v}>
                  Variant: {v}
                </option>
              ))}
            </select>
          )}

          <Button size="small" onClick={copyNpmCmd} leadingVisual={copiedNpm ? CheckIcon : CopyIcon}>
            {copiedNpm ? "Copied!" : "npm i"}
          </Button>

          <Button size="small" as="a" href={exportAasxUrl} target="_blank" download leadingVisual={DownloadIcon}>
            Export .aasx
          </Button>

          <Button size="small" as="a" href={exportOkhUrl} target="_blank" leadingVisual={FileCodeIcon}>
            okh.json
          </Button>

          <Button size="small" as="a" href={exportTgzUrl} target="_blank" leadingVisual={DownloadIcon}>
            .tgz
          </Button>
        </Box>
      </Box>

      {/* ── Navigation Tabs ───────────────────────────────────────── */}
      <Box
        px={3}
        bg="var(--color-canvas-default)"
        borderBottom="1px solid var(--color-border-default)"
        display="flex"
        gap={3}
      >
        <TabButton active={activeTab === "nameplate"} onClick={() => setActiveTab("nameplate")}>
          🏷️ Digital Nameplate
        </TabButton>
        <TabButton active={activeTab === "bom"} onClick={() => setActiveTab("bom")}>
          📋 Bill of Materials ({bom.length})
        </TabButton>
        {viewConfig.cadUrl && (
          <TabButton active={activeTab === "cad"} onClick={() => setActiveTab("cad")}>
            📐 3D CAD & Geometry
          </TabButton>
        )}
        <TabButton active={activeTab === "instructions"} onClick={() => setActiveTab("instructions")}>
          🛠️ Making & Assembly
        </TabButton>
        <TabButton active={activeTab === "instances"} onClick={() => setActiveTab("instances")}>
          📱 Digital Twins ({instances.length})
        </TabButton>
      </Box>

      {/* ── Tab Contents ──────────────────────────────────────────── */}
      <Box flex={1} overflow="auto" p={3}>
        {activeTab === "nameplate" && (
          <Box display="flex" flexDirection="column" gap={3}>
            <SectionCard title="Asset Identification">
              <DataGrid>
                <DataRow label="Product Designation" value={manifest.title || viewConfig.packageName} />
                <DataRow label="Global Asset ID" value={manifest.globalAssetId || "N/A"} mono />
                <DataRow label="Asset Kind" value="Type (Design Blueprint)" />
                <DataRow label="Package Scope" value={manifest.scope || "Global"} />
                <DataRow label="License" value={manifest.license || "UNLICENSED"} />
                <DataRow
                  label="Manufacturer / Author"
                  value={
                    manifest.author?.name
                      ? `${manifest.author.name} ${manifest.author.email ? `(${manifest.author.email})` : ""}`
                      : "Unknown"
                  }
                />
              </DataGrid>
            </SectionCard>

            <SectionCard title="Description & Function">
              <Text fontSize={2} color="var(--color-fg-muted)">
                {manifest.description || "No description provided for this cyber-physical system."}
              </Text>
            </SectionCard>
          </Box>
        )}

        {activeTab === "bom" && (
          <SectionCard title="Hierarchical Bill of Materials (BOM)">
            {bom.length === 0 ? (
              <Text color="var(--color-fg-muted)">No BOM items specified in manifest.</Text>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--color-border-default)", textAlign: "left" }}>
                    <th style={{ padding: "8px" }}>Item Name</th>
                    <th style={{ padding: "8px" }}>Part Number</th>
                    <th style={{ padding: "8px" }}>Category</th>
                    <th style={{ padding: "8px" }}>Qty</th>
                    <th style={{ padding: "8px" }}>Package Dependency</th>
                    <th style={{ padding: "8px" }}>Sourcing</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: "1px solid var(--color-border-muted)" }}>
                      <td style={{ padding: "8px", fontWeight: "bold" }}>{item.name}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{item.partNumber || "—"}</td>
                      <td style={{ padding: "8px" }}>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: "10px",
                            fontSize: "11px",
                            background: "rgba(9, 105, 218, 0.1)",
                            color: "#0969da",
                          }}
                        >
                          {item.category || "part"}
                        </span>
                      </td>
                      <td style={{ padding: "8px" }}>{item.quantity || 1}</td>
                      <td style={{ padding: "8px", fontFamily: "monospace" }}>{item.packageDependency || "—"}</td>
                      <td style={{ padding: "8px" }}>
                        {item.sourcingUrl ? (
                          <a href={item.sourcingUrl} target="_blank" rel="noreferrer" style={{ color: "#0969da" }}>
                            Source Link ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        )}

        {activeTab === "cad" && viewConfig.cadUrl && (
          <Box height="100%" minHeight="450px">
            <CadStepViewer viewConfig={{ url: viewConfig.cadUrl }} isFullScreen={isFullScreen} />
          </Box>
        )}

        {activeTab === "instructions" && (
          <SectionCard title="Assembly & Making Instructions (DIN SPEC 3105)">
            {instructions.length === 0 ? (
              <Text color="var(--color-fg-muted)">No assembly instructions defined.</Text>
            ) : (
              <Box display="flex" flexDirection="column" gap={3}>
                {instructions.map((step: any, idx: number) => (
                  <Box
                    key={idx}
                    p={3}
                    bg="var(--color-canvas-default)"
                    borderRadius="8px"
                    border="1px solid var(--color-border-muted)"
                    display="flex"
                    gap={3}
                  >
                    <Box
                      width="28px"
                      height="28px"
                      borderRadius="50%"
                      bg="#0969da"
                      color="white"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      fontWeight="bold"
                    >
                      {step.step || idx + 1}
                    </Box>
                    <Box flex={1}>
                      {step.title && (
                        <Text fontWeight="bold" fontSize={2} display="block" mb={1}>
                          {step.title}
                        </Text>
                      )}
                      <Text fontSize={2}>{step.instruction}</Text>
                      {step.tools && step.tools.length > 0 && (
                        <Box mt={2} display="flex" alignItems="center" gap={1}>
                          <ToolsIcon size={14} fill="var(--color-fg-muted)" />
                          <Text fontSize={1} color="var(--color-fg-muted)">
                            Tools needed: {step.tools.join(", ")}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </SectionCard>
        )}

        {activeTab === "instances" && (
          <SectionCard title="Serialized Instances & Manufacturing Birth Records">
            {instances.length === 0 ? (
              <Text color="var(--color-fg-muted)">
                No physical instances registered yet. Register serialized units via <code>POST /api/v1/instances</code>.
              </Text>
            ) : (
              <Box display="flex" flexDirection="column" gap={2}>
                {instances.map((inst, idx) => (
                  <Box
                    key={idx}
                    p={3}
                    bg="var(--color-canvas-default)"
                    borderRadius="8px"
                    border="1px solid var(--color-border-muted)"
                    display="flex"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Box>
                      <Text fontWeight="bold" fontFamily="monospace" fontSize={2}>
                        {inst.serialNumber}
                      </Text>
                      <Text fontSize={1} color="var(--color-fg-muted)" display="block">
                        Variant: {inst.variant || "Standard"}
                      </Text>
                    </Box>
                    <Box display="flex" gap={2}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: "6px",
                          fontSize: "11px",
                          background: "rgba(46, 160, 67, 0.15)",
                          color: "#2ea043",
                          fontWeight: "bold",
                        }}
                      >
                        ✓ Hipot Passed
                      </span>
                      <Button
                        size="small"
                        as="a"
                        href={`/api/v1/instances/${encodeURIComponent(inst.serialNumber)}/twin`}
                        target="_blank"
                      >
                        Digital Twin ↗
                      </Button>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </SectionCard>
        )}
      </Box>
    </Box>
  );
};

const TabButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    onClick={onClick}
    style={{
      background: "none",
      border: "none",
      padding: "10px 4px",
      fontSize: "13px",
      fontWeight: active ? 600 : 400,
      color: active ? "var(--color-fg-default)" : "var(--color-fg-muted)",
      borderBottom: active ? "2px solid #0969da" : "2px solid transparent",
      cursor: "pointer",
    }}
  >
    {children}
  </button>
);

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Box bg="var(--color-canvas-default)" p={3} borderRadius="8px" border="1px solid var(--color-border-muted)">
    <Text fontSize={2} fontWeight="bold" display="block" mb={3}>
      {title}
    </Text>
    {children}
  </Box>
);

const DataGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box display="grid" gridTemplateColumns="180px 1fr" rowGap={2} fontSize="13px">
    {children}
  </Box>
);

const DataRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <>
    <Text color="var(--color-fg-muted)">{label}:</Text>
    <Text fontWeight={mono ? "normal" : 500} fontFamily={mono ? "monospace" : "inherit"}>
      {value}
    </Text>
  </>
);

export default AasPackageViewer;
