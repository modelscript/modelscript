// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation data source panel for Morsel.
 *
 * Allows the user to:
 * - Switch between Local, MQTT Live, and Historian Replay modes
 * - Connect/disconnect from the MQTT broker
 * - View live participant variable values
 * - Select which variables to chart
 */

import { LinkExternalIcon, PulseIcon, ServerIcon, SyncIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Flash, IconButton } from "@primer/react";
import { useCallback, useState } from "react";
import type { MqttConnectionState, MqttParticipantMeta } from "../util/mqtt-client";
import type { SimulationDataSource } from "../util/use-mqtt-simulation";
import { useMqttSimulation } from "../util/use-mqtt-simulation";

interface CosimPanelProps {
  /** Currently selected data source. */
  dataSource: SimulationDataSource;
  /** Called when the user changes the data source. */
  onDataSourceChange: (source: SimulationDataSource) => void;
  /** Called when a participant variable is selected for charting. */
  onVariableSelected?: (participantId: string, variable: string) => void;
  /** MQTT session ID (for live mode). */
  sessionId?: string;
  /** Color mode for styling. */
  colorMode?: "light" | "dark";
}

const STATUS_COLORS: Record<MqttConnectionState, string> = {
  connected: "#2da44e",
  connecting: "#bf8700",
  disconnected: "#57606a",
  error: "#cf222e",
};

const STATUS_LABELS: Record<MqttConnectionState, string> = {
  connected: "Connected",
  connecting: "Connecting…",
  disconnected: "Disconnected",
  error: "Error",
};

const DATA_SOURCE_LABELS: Record<SimulationDataSource, string> = {
  local: "Local Simulation",
  "mqtt-live": "MQTT Live",
  "historian-replay": "Historian Replay",
};

const DATA_SOURCE_ICONS: Record<SimulationDataSource, React.ReactNode> = {
  local: <PulseIcon size={16} />,
  "mqtt-live": <ServerIcon size={16} />,
  "historian-replay": <SyncIcon size={16} />,
};

/**
 * Co-simulation data source selector and live data panel.
 */
export function CosimPanel({
  dataSource,
  onDataSourceChange,
  onVariableSelected,
  sessionId,
  colorMode = "light",
}: CosimPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const mqtt = useMqttSimulation({
    source: dataSource,
    sessionId,
  });

  const handleConnect = useCallback(() => {
    if (mqtt.connectionState === "connected") {
      mqtt.disconnect();
    } else {
      mqtt.connect();
    }
  }, [mqtt]);

  const isDark = colorMode === "dark";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const bgColor = isDark ? "#161b22" : "#f6f8fa";
  const textMuted = isDark ? "#8b949e" : "#57606a";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderBottom: `1px solid ${borderColor}`,
        background: bgColor,
        fontSize: 13,
      }}
    >
      {/* Header: Data source selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ActionMenu>
          <ActionMenu.Button size="small" leadingVisual={() => <>{DATA_SOURCE_ICONS[dataSource]}</>}>
            {DATA_SOURCE_LABELS[dataSource]}
          </ActionMenu.Button>
          <ActionMenu.Overlay>
            <ActionList>
              <ActionList.Item selected={dataSource === "local"} onSelect={() => onDataSourceChange("local")}>
                <ActionList.LeadingVisual>
                  <PulseIcon />
                </ActionList.LeadingVisual>
                Local Simulation
                <ActionList.Description>Run models in-browser using the JS engine</ActionList.Description>
              </ActionList.Item>
              <ActionList.Item selected={dataSource === "mqtt-live"} onSelect={() => onDataSourceChange("mqtt-live")}>
                <ActionList.LeadingVisual>
                  <ServerIcon />
                </ActionList.LeadingVisual>
                MQTT Live
                <ActionList.Description>Stream data from connected MQTT participants</ActionList.Description>
              </ActionList.Item>
              <ActionList.Item
                selected={dataSource === "historian-replay"}
                onSelect={() => onDataSourceChange("historian-replay")}
              >
                <ActionList.LeadingVisual>
                  <SyncIcon />
                </ActionList.LeadingVisual>
                Historian Replay
                <ActionList.Description>Replay recorded sessions from TimescaleDB</ActionList.Description>
              </ActionList.Item>
            </ActionList>
          </ActionMenu.Overlay>
        </ActionMenu>

        {/* MQTT connection toggle (only for non-local modes) */}
        {dataSource !== "local" && (
          <IconButton
            icon={LinkExternalIcon}
            aria-label={mqtt.connectionState === "connected" ? "Disconnect" : "Connect"}
            size="small"
            variant={mqtt.connectionState === "connected" ? "danger" : "default"}
            onClick={handleConnect}
          />
        )}

        {/* Connection status indicator */}
        {dataSource !== "local" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: STATUS_COLORS[mqtt.connectionState],
              }}
            />
            <span style={{ fontSize: 11, color: textMuted }}>{STATUS_LABELS[mqtt.connectionState]}</span>
          </div>
        )}
      </div>

      {/* MQTT Live: participant list */}
      {dataSource === "mqtt-live" && mqtt.connectionState === "connected" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {mqtt.participants.size === 0 ? (
            <Flash variant="warning" style={{ fontSize: 12, padding: 8 }}>
              No MQTT participants discovered. Ensure participants are publishing metadata.
            </Flash>
          ) : (
            Array.from(mqtt.participants.entries()).map(([id, meta]) => (
              <ParticipantRow
                key={id}
                meta={meta}
                expanded={expanded === id}
                onToggle={() => setExpanded(expanded === id ? null : id)}
                latestValues={mqtt.latestValues}
                onVariableSelected={onVariableSelected}
                textMuted={textMuted}
                borderColor={borderColor}
                isDark={isDark}
              />
            ))
          )}
        </div>
      )}

      {/* Historian Replay: stub for future session selector */}
      {dataSource === "historian-replay" && (
        <Flash variant="default" style={{ fontSize: 12, padding: 8 }}>
          Select a recorded session to replay from the Historian.
        </Flash>
      )}
    </div>
  );
}

// ── Internal Components ──

function ParticipantRow({
  meta,
  expanded,
  onToggle,
  latestValues,
  onVariableSelected,
  textMuted,
  borderColor,
  isDark,
}: {
  meta: MqttParticipantMeta;
  expanded: boolean;
  onToggle: () => void;
  latestValues: Map<string, number>;
  onVariableSelected?: (participantId: string, variable: string) => void;
  textMuted: string;
  borderColor: string;
  isDark: boolean;
}) {
  const outputCount = meta.variables.filter((v) => v.causality === "output").length;

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        overflow: "hidden",
        background: isDark ? "#0d1117" : "#ffffff",
      }}
    >
      {/* Participant header */}
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontSize: 12,
          color: isDark ? "#c9d1d9" : "#24292f",
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "#2da44e",
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 600, flex: 1 }}>{meta.modelName}</span>
        <span style={{ color: textMuted, fontSize: 11 }}>
          {outputCount} output{outputCount !== 1 ? "s" : ""}
        </span>
        <span style={{ color: textMuted, fontSize: 11, transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </button>

      {/* Expanded: variable list with live values */}
      {expanded && (
        <div style={{ borderTop: `1px solid ${borderColor}`, padding: "4px 0" }}>
          {meta.variables
            .filter((v) => v.causality === "output" || v.causality === "input")
            .map((v) => {
              const key = `${meta.participantId}/${v.name}`;
              const value = latestValues.get(key);
              return (
                <div
                  key={v.name}
                  onClick={() => onVariableSelected?.(meta.participantId, v.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "3px 10px 3px 24px",
                    cursor: onVariableSelected ? "pointer" : "default",
                    fontSize: 11,
                    color: isDark ? "#c9d1d9" : "#24292f",
                  }}
                  title={`${v.causality}: ${v.name}`}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: v.causality === "output" ? "#2da44e" : "#0969da",
                      width: 14,
                      textAlign: "center",
                    }}
                  >
                    {v.causality === "output" ? "OUT" : "IN"}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {v.name}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      color: textMuted,
                      fontSize: 10,
                      minWidth: 60,
                      textAlign: "right",
                    }}
                  >
                    {value !== undefined ? value.toFixed(4) : "—"}
                  </span>
                  {v.unit && <span style={{ color: textMuted, fontSize: 10 }}>{v.unit}</span>}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
