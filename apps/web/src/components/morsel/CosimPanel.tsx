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

import { LinkExternalIcon, PauseIcon, PlayIcon, PulseIcon, ServerIcon, SyncIcon } from "@primer/octicons-react";
import { ActionList, ActionMenu, Button, Flash, IconButton, Select } from "@primer/react";
import { useCallback, useState } from "react";
import type { MqttConnectionState, MqttParticipantMeta } from "../util/mqtt-client";
import type { SimulationDataSource } from "../util/use-mqtt-simulation";
import { useMqttSimulation } from "../util/use-mqtt-simulation";

export interface HistorianSession {
  id: string;
  name: string;
  recordedAt: string;
  durationSeconds: number;
  participantCount: number;
  signalCount: number;
}

export const DEFAULT_HISTORIAN_SESSIONS: HistorianSession[] = [
  {
    id: "session-2026-09-27-01",
    name: "Coupled Thermal-Fluid Dynamics Test",
    recordedAt: "2026-09-27 14:32:10 UTC",
    durationSeconds: 120,
    participantCount: 3,
    signalCount: 24,
  },
  {
    id: "session-2026-09-27-02",
    name: "Permanent Magnet DC Motor Step Transient",
    recordedAt: "2026-09-27 16:05:44 UTC",
    durationSeconds: 60,
    participantCount: 2,
    signalCount: 16,
  },
  {
    id: "session-2026-09-26-03",
    name: "Multi-Zone HVAC Closed-Loop Verification",
    recordedAt: "2026-09-26 09:12:00 UTC",
    durationSeconds: 300,
    participantCount: 5,
    signalCount: 48,
  },
];

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
  /** Optional handler when a recorded historian session is selected or replayed. */
  onReplaySession?: (session: HistorianSession, speed: number) => void;
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
  onReplaySession,
}: CosimPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string>(DEFAULT_HISTORIAN_SESSIONS[0].id);
  const [replaySpeed, setReplaySpeed] = useState<number>(1);
  const [isReplaying, setIsReplaying] = useState<boolean>(false);

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
  const borderColor = "var(--color-border-default, #30363d)";
  const bgColor = "var(--color-canvas-subtle, #161b22)";
  const textMuted = "var(--color-fg-muted, #8b949e)";

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

      {/* Historian Replay: recorded session selector and playback */}
      {dataSource === "historian-replay" &&
        (() => {
          const selectedSession =
            DEFAULT_HISTORIAN_SESSIONS.find((s) => s.id === selectedSessionId) ?? DEFAULT_HISTORIAN_SESSIONS[0];
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  padding: 10,
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  background: "var(--color-canvas-default, #0d1117)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>Recorded Sessions</span>
                  <span style={{ color: textMuted, fontSize: 11 }}>TimescaleDB Historian</span>
                </div>

                <Select
                  size="small"
                  value={selectedSessionId}
                  onChange={(e) => setSelectedSessionId(e.target.value)}
                  aria-label="Recorded Session"
                >
                  {DEFAULT_HISTORIAN_SESSIONS.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name} ({s.durationSeconds}s)
                    </Select.Option>
                  ))}
                </Select>

                {selectedSession && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      fontSize: 11,
                      color: textMuted,
                      marginTop: 2,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Recorded:</span>
                      <span style={{ fontFamily: "monospace" }}>{selectedSession.recordedAt}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Duration:</span>
                      <span>{selectedSession.durationSeconds} seconds</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>Participants / Signals:</span>
                      <span>
                        {selectedSession.participantCount} models / {selectedSession.signalCount} signals
                      </span>
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 6,
                    paddingTop: 8,
                    borderTop: `1px solid ${borderColor}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                    <span style={{ fontSize: 11, color: textMuted }}>Speed:</span>
                    <Select
                      size="small"
                      value={String(replaySpeed)}
                      onChange={(e) => setReplaySpeed(parseFloat(e.target.value))}
                      aria-label="Replay Speed"
                    >
                      <Select.Option value="0.25">0.25x</Select.Option>
                      <Select.Option value="0.5">0.5x</Select.Option>
                      <Select.Option value="1">1.0x</Select.Option>
                      <Select.Option value="2">2.0x</Select.Option>
                      <Select.Option value="5">5.0x</Select.Option>
                    </Select>
                  </div>

                  <Button
                    size="small"
                    variant={isReplaying ? "danger" : "primary"}
                    leadingVisual={isReplaying ? PauseIcon : PlayIcon}
                    onClick={() => {
                      const next = !isReplaying;
                      setIsReplaying(next);
                      if (next && selectedSession) {
                        onReplaySession?.(selectedSession, replaySpeed);
                      }
                    }}
                  >
                    {isReplaying ? "Pause" : "Replay"}
                  </Button>
                </div>
              </div>

              {isReplaying && (
                <Flash variant="success" style={{ fontSize: 11, padding: "6px 10px" }}>
                  Replaying {selectedSession?.name} at {replaySpeed}x speed…
                </Flash>
              )}
            </div>
          );
        })()}
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
  isDark: _isDark,
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
        background: "var(--color-canvas-default, #0d1117)",
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
          color: "var(--color-fg-default, #c9d1d9)",
          textAlign: "left",
        }}
      >
        <div
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "var(--color-success-fg, #2da44e)",
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
                    color: "var(--color-fg-default, #c9d1d9)",
                  }}
                  title={`${v.causality}: ${v.name}`}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color:
                        v.causality === "output"
                          ? "var(--color-success-fg, #2da44e)"
                          : "var(--color-accent-fg, #0969da)",
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
