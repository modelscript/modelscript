// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MQTT participant tree widget for Morsel.
 *
 * Connects to the MQTT broker via WebSocket and displays a live tree
 * of co-simulation participants discovered from retained birth certificates.
 *
 * Supports drag-and-drop: dragging a participant onto a diagram creates
 * an MQTT-backed component that reads live data from MQTT topics.
 */

import { BroadcastIcon, ChevronDownIcon, ChevronRightIcon, CircleIcon } from "@primer/octicons-react";
import React from "react";

/** Variable descriptor from participant metadata. */
interface ParticipantVariable {
  name: string;
  causality: "input" | "output" | "parameter" | "local";
  type: string;
  unit?: string;
  start?: number;
  description?: string;
}

/** Participant metadata from MQTT birth certificate. */
interface MqttParticipant {
  participantId: string;
  modelName: string;
  type: string;
  classKind: string;
  description?: string;
  variables: ParticipantVariable[];
  iconSvg?: string;
  timestamp: string;
  online: boolean;
}

interface MqttTreeWidgetProps {
  /** API base URL for fetching participant data. */
  apiBaseUrl?: string;
  /** Callback when a participant is selected. */
  onSelect?: (participant: MqttParticipant) => void;
  /** Optional width for the widget. */
  width?: number | string;
  /** Polling interval in ms (default: 5000). */
  pollInterval?: number;
}

/**
 * MQTT participant tree widget.
 *
 * Polls the API endpoint for active MQTT participants and renders them
 * as a draggable tree alongside the Modelica library tree.
 */
export function MqttTreeWidget(props: MqttTreeWidgetProps) {
  const { apiBaseUrl = "", onSelect, width, pollInterval = 5000 } = props;
  const [participants, setParticipants] = React.useState<MqttParticipant[]>([]);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);

  // Poll the API for participant data
  React.useEffect(() => {
    let cancelled = false;

    async function fetchParticipants() {
      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/mqtt/participants`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          participants: MqttParticipant[];
          connected: boolean;
        };
        if (!cancelled) {
          setParticipants(data.participants.map((p) => ({ ...p, online: true })));
          setConnected(data.connected);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Connection failed");
          setConnected(false);
        }
      }
    }

    void fetchParticipants();
    const timer = setInterval(() => void fetchParticipants(), pollInterval);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiBaseUrl, pollInterval]);

  const toggleExpand = React.useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      style={{
        width: width ?? "100%",
        overflow: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        fontSize: 14,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid var(--borderColor-muted, rgba(48, 54, 61, 0.4))",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "var(--fgColor-muted, #848d97)",
        }}
      >
        <BroadcastIcon size={16} />
        <span>MQTT Live</span>
        <span
          style={{
            marginLeft: "auto",
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: connected ? "#3fb950" : error ? "#f85149" : "#848d97",
          }}
          title={connected ? "Connected" : (error ?? "Disconnected")}
        />
      </div>

      {/* Message when no participants */}
      {participants.length === 0 && (
        <div
          style={{
            padding: "16px 12px",
            color: "var(--fgColor-muted, #848d97)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {error ? <span style={{ color: "#f85149" }}>⚠ {error}</span> : "No MQTT participants online"}
        </div>
      )}

      {/* Participant list */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {participants.map((p) => (
          <MqttParticipantNode
            key={p.participantId}
            participant={p}
            expanded={expandedIds.has(p.participantId)}
            hovered={hoveredId === p.participantId}
            onToggle={() => toggleExpand(p.participantId)}
            onHover={(h) => setHoveredId(h ? p.participantId : null)}
            onSelect={() => onSelect?.(p)}
          />
        ))}
      </ul>
    </div>
  );
}

interface MqttParticipantNodeProps {
  participant: MqttParticipant;
  expanded: boolean;
  hovered: boolean;
  onToggle: () => void;
  onHover: (hovered: boolean) => void;
  onSelect: () => void;
}

function MqttParticipantNode(props: MqttParticipantNodeProps) {
  const { participant, expanded, hovered, onToggle, onHover, onSelect } = props;
  const hasVariables = participant.variables.length > 0;

  return (
    <>
      <li
        style={{
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          paddingLeft: 8,
          margin: "0 8px",
          cursor: "pointer",
          fontSize: 14,
          color: "var(--fgColor-default, var(--color-fg-default))",
          backgroundColor: hovered
            ? "var(--control-transparent-bgColor-hover, rgba(177, 186, 196, 0.12))"
            : "transparent",
          borderRadius: 6,
          gap: 8,
          userSelect: "none",
          transition: "background-color 0.1s ease",
        }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onClick={(e) => {
          e.stopPropagation();
          if (hasVariables) onToggle();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(
            "application/json",
            JSON.stringify({
              className: `mqtt://${participant.participantId}`,
              classKind: participant.classKind,
              iconSvg: participant.iconSvg ?? null,
              mqttParticipant: true,
              participantId: participant.participantId,
              variables: participant.variables,
            }),
          );
          e.dataTransfer.effectAllowed = "copy";
        }}
      >
        {/* Expand chevron */}
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          {hasVariables ? (
            expanded ? (
              <ChevronDownIcon size={12} />
            ) : (
              <ChevronRightIcon size={12} />
            )
          ) : (
            <span style={{ width: 12 }} />
          )}
        </span>

        {/* Online/offline indicator */}
        <CircleIcon size={8} fill={participant.online ? "#3fb950" : "#f85149"} />

        {/* Icon */}
        {participant.iconSvg ? (
          <div
            className="modelica-icon"
            style={{ width: 20, height: 20, flexShrink: 0 }}
            dangerouslySetInnerHTML={{ __html: participant.iconSvg }}
          />
        ) : (
          <BroadcastIcon size={16} />
        )}

        {/* Label */}
        <span style={{ flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {participant.modelName}
        </span>

        {/* Type badge */}
        <span
          style={{
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 10,
            backgroundColor: "var(--bgColor-neutral-muted, rgba(110, 118, 129, 0.15))",
            color: "var(--fgColor-muted, #848d97)",
            flexShrink: 0,
          }}
        >
          {participant.type}
        </span>
      </li>

      {/* Variable children */}
      {expanded && hasVariables && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {participant.variables.map((v) => (
            <li
              key={v.name}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "4px 8px",
                paddingLeft: 48,
                margin: "0 8px",
                fontSize: 12,
                color: "var(--fgColor-muted, #848d97)",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color:
                    v.causality === "input"
                      ? "#58a6ff"
                      : v.causality === "output"
                        ? "#3fb950"
                        : v.causality === "parameter"
                          ? "#d2a8ff"
                          : "#848d97",
                }}
              >
                {v.causality === "input" ? "▶" : v.causality === "output" ? "◀" : "●"}
              </span>
              <span style={{ fontFamily: "monospace" }}>{v.name}</span>
              {v.unit && <span style={{ fontSize: 10, opacity: 0.7 }}>[{v.unit}]</span>}
              {v.start !== undefined && (
                <span style={{ fontSize: 10, opacity: 0.5, marginLeft: "auto" }}>= {v.start}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
