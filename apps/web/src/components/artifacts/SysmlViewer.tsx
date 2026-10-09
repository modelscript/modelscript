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
  XCircleFillIcon,
} from "@primer/octicons-react";
import { Button, Heading, Text, TextInput } from "@primer/react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import Box from "../Box";

export interface SysmlPart {
  name: string;
  type: string;
  multiplicity?: string;
  ports?: string[];
  description?: string;
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
  flowType?: string;
}

export interface SysmlViewerProps {
  viewConfig: {
    format?: "SysML2" | "KerML" | string;
    systemName?: string;
    title?: string;
    code?: string;
    parts?: SysmlPart[];
    requirements?: SysmlRequirement[];
    connections?: SysmlConnection[];
    [key: string]: unknown;
  };
  isFullScreen?: boolean;
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

const Badge = styled.span<{ $variant?: "sysml" | "req-pass" | "req-warn" | "kerml" }>`
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

const DEFAULT_SAMPLE_CODE = `package QuadcopterSystem {
  import ScalarValues::*;
  import ISQ::*;

  part def AvionicsComputer {
    port telemetryPort: TelemetryPort;
    port motorControlPort: PwmPort;
  }

  part def BatteryUnit {
    attribute capacity: EnergyValue = 5000 [mA * hr];
    port dcPowerOut: PowerPort;
  }

  part def ElectricMotor {
    attribute maxRpm: FrequencyValue = 12000 [rpm];
    port powerIn: PowerPort;
    port controlIn: PwmPort;
  }

  part quadcopter {
    part fc: AvionicsComputer;
    part battery: BatteryUnit;
    part motors: ElectricMotor[4];

    connect battery.dcPowerOut to fc.powerIn;
    connect fc.motorControlPort to motors.controlIn;
  }

  requirement def MaxTakeoffWeightReq {
    doc /* Total system mass must not exceed 1.8 kg including payload. */
    attribute maxWeight: MassValue = 1.8 [kg];
  }

  requirement def FlightEnduranceReq {
    doc /* Continuous flight endurance must exceed 22 minutes at sea level. */
    attribute minEndurance: TimeValue = 22 [min];
  }
}`;

const SysmlViewer: React.FC<SysmlViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"architecture" | "requirements" | "source">("architecture");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  const format = viewConfig.format || "SysML2";
  const systemName = viewConfig.systemName || (viewConfig.title as string) || "System Architecture";

  // Parts list
  const parts: SysmlPart[] = useMemo(() => {
    if (Array.isArray(viewConfig.parts) && viewConfig.parts.length > 0) {
      return viewConfig.parts;
    }
    return [
      {
        name: "fc",
        type: "AvionicsComputer",
        multiplicity: "1",
        ports: ["telemetryPort", "motorControlPort"],
        description: "Flight controller & IMU",
      },
      {
        name: "battery",
        type: "BatteryUnit",
        multiplicity: "1",
        ports: ["dcPowerOut"],
        description: "LiPo 4S 5000mAh pack",
      },
      {
        name: "motors",
        type: "ElectricMotor",
        multiplicity: "4",
        ports: ["powerIn", "controlIn"],
        description: "Brushless DC 2207 motors",
      },
      {
        name: "cameraGimbal",
        type: "PayloadGimbal",
        multiplicity: "1",
        ports: ["videoOut", "auxPower"],
        description: "3-axis stabilized sensor",
      },
    ];
  }, [viewConfig.parts]);

  // Requirements list
  const requirements: SysmlRequirement[] = useMemo(() => {
    if (Array.isArray(viewConfig.requirements) && viewConfig.requirements.length > 0) {
      return viewConfig.requirements;
    }
    return [
      {
        id: "REQ-01",
        name: "MaxTakeoffWeightReq",
        text: "Total system mass must not exceed 1.8 kg including payload.",
        status: "satisfied",
      },
      {
        id: "REQ-02",
        name: "FlightEnduranceReq",
        text: "Continuous flight endurance must exceed 22 minutes at sea level.",
        status: "satisfied",
      },
      {
        id: "REQ-03",
        name: "WindResistanceReq",
        text: "Stable hover in sustained cross-winds up to 12 m/s.",
        status: "verified",
      },
      {
        id: "REQ-04",
        name: "ThermalDissipationReq",
        text: "ESC operating temperatures must stay below 75°C under max continuous thrust.",
        status: "unverified",
      },
    ];
  }, [viewConfig.requirements]);

  // Connections list
  const connections: SysmlConnection[] = useMemo(() => {
    if (Array.isArray(viewConfig.connections) && viewConfig.connections.length > 0) {
      return viewConfig.connections;
    }
    return [
      { source: "battery.dcPowerOut", target: "fc.powerIn", flowType: "ElectricalPower" },
      { source: "fc.motorControlPort", target: "motors.controlIn", flowType: "PWM / DShot" },
      { source: "fc.telemetryPort", target: "groundStation.radio", flowType: "MAVLink" },
    ];
  }, [viewConfig.connections]);

  const sourceCode = (viewConfig.code as string) || DEFAULT_SAMPLE_CODE;

  const satisfiedCount = requirements.filter((r) => r.status === "satisfied" || r.status === "verified").length;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(sourceCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
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

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <CpuIcon size={16} fill="var(--color-accent-blue, #60a5fa)" />
          <SystemTitle title={systemName}>{systemName}</SystemTitle>
          <Badge $variant={format === "KerML" ? "kerml" : "sysml"}>{format}</Badge>
          <Badge $variant={satisfiedCount === requirements.length ? "req-pass" : "req-warn"}>
            <ShieldCheckIcon size={12} /> {satisfiedCount}/{requirements.length} Reqs Satisfied
          </Badge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2}>
          <Button size="small" onClick={handleCopyCode} title="Copy SysML v2 source">
            {copiedCode ? <CheckIcon size={14} fill="var(--color-accent-cyan)" /> : <CopyIcon size={14} />}
            <Text fontSize="11px" ml={1}>
              {copiedCode ? "Copied" : "Source"}
            </Text>
          </Button>
          <Button
            size="small"
            variant="primary"
            onClick={() => navigate("/ide")}
            title="Mount and edit SysML v2 model in ModelScript IDE"
          >
            <CodeIcon size={14} />
            <Text fontSize="11px" ml={1}>
              Open in IDE
            </Text>
          </Button>
        </Box>
      </Toolbar>

      <TabNav>
        <TabButton $active={activeTab === "architecture"} onClick={() => setActiveTab("architecture")}>
          System Architecture ({parts.length})
        </TabButton>
        <TabButton $active={activeTab === "requirements"} onClick={() => setActiveTab("requirements")}>
          Requirements Matrix ({requirements.length})
        </TabButton>
        <TabButton $active={activeTab === "source"} onClick={() => setActiveTab("source")}>
          SysML v2 Source
        </TabButton>
      </TabNav>

      <ContentBody>
        {activeTab === "architecture" && (
          <Box display="flex" flexDirection="column" gap={2}>
            <Box display="flex" alignItems="center" justifyContent="space-between" gap={2}>
              <Text fontSize="12px" color="var(--color-text-muted)">
                Composition breakdown &amp; internal port bindings
              </Text>
              <TextInput
                leadingVisual={SearchIcon}
                placeholder="Search parts or ports..."
                size="small"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                sx={{ width: ["100%", "220px"] }}
              />
            </Box>

            <Box display="grid" gridTemplateColumns={["1fr", "1fr 1fr"]} gap={2}>
              {filteredParts.map((p) => (
                <TreeCard key={p.name}>
                  <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center" gap={1}>
                      <DotFillIcon size={12} fill="var(--color-accent-blue, #60a5fa)" />
                      <Text fontSize="13px" fontWeight="700" color="var(--color-text-primary)">
                        {p.name}
                      </Text>
                      {p.multiplicity && (
                        <Text fontSize="11px" color="var(--color-text-muted)" fontFamily="var(--font-mono)">
                          [{p.multiplicity}]
                        </Text>
                      )}
                    </Box>
                    <Badge>{p.type}</Badge>
                  </Box>

                  {p.description && (
                    <Text fontSize="11.5px" color="var(--color-text-muted)">
                      {p.description}
                    </Text>
                  )}

                  {p.ports && p.ports.length > 0 && (
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mt={1}>
                      <Text fontSize="10.5px" color="var(--color-text-muted)">
                        Ports:
                      </Text>
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
                      fontSize="11.5px"
                      fontFamily="var(--font-mono, monospace)"
                      py={1}
                      px={1}
                      style={{
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

        {activeTab === "requirements" && (
          <Box display="flex" flexDirection="column" gap={2}>
            {requirements.map((req) => {
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
                      <Text fontSize="12.5px" fontWeight="700" color="var(--color-text-primary)">
                        {req.id}: {req.name}
                      </Text>
                    </Box>

                    <Badge $variant={isVerified ? "req-pass" : "req-warn"}>{req.status.toUpperCase()}</Badge>
                  </Box>

                  <Text fontSize="12px" color="var(--color-text-secondary)" pl={4}>
                    {req.text}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}

        {activeTab === "source" && <CodeEditor>{sourceCode}</CodeEditor>}
      </ContentBody>
    </CardWrapper>
  );
};

export default SysmlViewer;
