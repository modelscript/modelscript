// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * React hook for MQTT-backed simulation data.
 *
 * Provides a `useMqttSimulation` hook that integrates the browser MQTT client
 * with specific MQTT participant subscriptions, returning live variable values
 * suitable for charting alongside locally-simulated data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MqttConnectionState, MqttParticipantMeta, VariableUpdateCallback } from "./mqtt-client";
import { getMorselMqttClient } from "./mqtt-client";

/** Simulation data source mode. */
export type SimulationDataSource = "local" | "mqtt-live" | "historian-replay";

/** Configuration for MQTT simulation integration. */
export interface MqttSimulationConfig {
  /** Data source mode. */
  source: SimulationDataSource;
  /** MQTT session ID to subscribe to. */
  sessionId?: string;
  /** Participant IDs to subscribe to (empty = all discovered). */
  participantIds?: string[];
  /** Historian replay settings. */
  replay?: {
    from?: string;
    to?: string;
    speed?: number;
  };
}

/** Return value of the `useMqttSimulation` hook. */
export interface MqttSimulationState {
  /** Current connection state. */
  connectionState: MqttConnectionState;
  /** Connect to the MQTT broker. */
  connect: () => void;
  /** Disconnect from the MQTT broker. */
  disconnect: () => void;
  /** Active participants. */
  participants: Map<string, MqttParticipantMeta>;
  /** Latest values for all subscribed variables. */
  latestValues: Map<string, number>;
  /** Get the latest value for a participant variable. */
  getValue: (participantId: string, variable: string) => number | undefined;
}

/**
 * React hook for MQTT simulation integration.
 *
 * Manages MQTT client lifecycle and subscriptions based on the provided
 * configuration. Returns live variable values that can be passed directly
 * to chart components.
 *
 * @param config Simulation data source configuration
 * @returns MQTT simulation state
 */
export function useMqttSimulation(config: MqttSimulationConfig): MqttSimulationState {
  const mqttClient = getMorselMqttClient();
  const [connectionState, setConnectionState] = useState<MqttConnectionState>(mqttClient.connectionState);
  const [participants, setParticipants] = useState<Map<string, MqttParticipantMeta>>(
    () => new Map(mqttClient.participants),
  );
  const [latestValues, setLatestValues] = useState<Map<string, number>>(() => new Map());
  const configRef = useRef(config);
  configRef.current = config;

  // Connection state tracking
  useEffect(() => {
    return mqttClient.onStateChange(setConnectionState);
  }, [mqttClient]);

  // Participant discovery
  useEffect(() => {
    return mqttClient.onParticipantChange((id, meta) => {
      setParticipants((prev) => {
        const next = new Map(prev);
        if (meta) {
          next.set(id, meta);
        } else {
          next.delete(id);
        }
        return next;
      });
    });
  }, [mqttClient]);

  // Variable subscriptions (only when source is mqtt-live)
  useEffect(() => {
    if (config.source !== "mqtt-live" || !config.sessionId) return;

    const handler: VariableUpdateCallback = (participantId, variable, value) => {
      // Filter by configured participant IDs
      if (configRef.current.participantIds?.length && !configRef.current.participantIds.includes(participantId)) {
        return;
      }

      setLatestValues((prev) => {
        const next = new Map(prev);
        next.set(`${participantId}/${variable}`, value);
        return next;
      });
    };

    const unsubscribe = mqttClient.onVariableUpdate(handler);

    // Subscribe to configured participants
    const pids = config.participantIds ?? Array.from(mqttClient.participants.keys());
    for (const pid of pids) {
      mqttClient.subscribeParticipant(config.sessionId, pid);
    }

    return () => {
      unsubscribe();
      if (config.sessionId) {
        for (const pid of pids) {
          mqttClient.unsubscribeParticipant(config.sessionId, pid);
        }
      }
    };
  }, [config.source, config.sessionId, config.participantIds, mqttClient]);

  const connect = useCallback(() => mqttClient.connect(), [mqttClient]);
  const disconnect = useCallback(() => mqttClient.disconnect(), [mqttClient]);

  const getValue = useCallback(
    (participantId: string, variable: string): number | undefined => {
      return latestValues.get(`${participantId}/${variable}`);
    },
    [latestValues],
  );

  return {
    connectionState,
    connect,
    disconnect,
    participants,
    latestValues,
    getValue,
  };
}
