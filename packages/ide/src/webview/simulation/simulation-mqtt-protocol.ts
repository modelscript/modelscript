// SPDX-License-Identifier: AGPL-3.0-or-later

export type DecodedMqttPacket =
  | { type: "connack" }
  | { type: "publish"; topic: string; payload: string }
  | { type: "pingresp" }
  | { type: "other"; packetType: number };

export function buildMqttConnectPacket(clientId?: string): ArrayBuffer {
  const id = clientId ?? `vscode-sim-${Math.random().toString(36).slice(2, 8)}`;
  const clientIdBytes = new TextEncoder().encode(id);
  const protocolName = new TextEncoder().encode("MQTT");
  const remainingLength =
    2 +
    protocolName.length + // protocol name (length-prefixed)
    1 + // protocol level (4 = 3.1.1)
    1 + // connect flags
    2 + // keep alive
    2 +
    clientIdBytes.length; // client ID (length-prefixed)

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: CONNECT (0x10)
  buf[pos++] = 0x10;
  buf[pos++] = remainingLength;

  // Protocol name
  buf[pos++] = 0;
  buf[pos++] = protocolName.length;
  buf.set(protocolName, pos);
  pos += protocolName.length;

  // Protocol level: 4 (MQTT 3.1.1)
  buf[pos++] = 4;

  // Connect flags: Clean Session
  buf[pos++] = 0x02;

  // Keep alive: 60 seconds
  buf[pos++] = 0;
  buf[pos++] = 60;

  // Client ID
  buf[pos++] = (clientIdBytes.length >> 8) & 0xff;
  buf[pos++] = clientIdBytes.length & 0xff;
  buf.set(clientIdBytes, pos);

  return buf.buffer;
}

export function buildMqttSubscribePacket(topic: string, packetId = 1): ArrayBuffer {
  const topicBytes = new TextEncoder().encode(topic);
  const remainingLength = 2 + 2 + topicBytes.length + 1; // packet ID + topic + QoS

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: SUBSCRIBE (0x82)
  buf[pos++] = 0x82;
  buf[pos++] = remainingLength;

  // Packet Identifier
  buf[pos++] = (packetId >> 8) & 0xff;
  buf[pos++] = packetId & 0xff;

  // Topic filter
  buf[pos++] = (topicBytes.length >> 8) & 0xff;
  buf[pos++] = topicBytes.length & 0xff;
  buf.set(topicBytes, pos);
  pos += topicBytes.length;

  // QoS: 0
  buf[pos] = 0;

  return buf.buffer;
}

export function decodeMqttPacket(data: ArrayBuffer): DecodedMqttPacket | null {
  const view = new Uint8Array(data);
  if (view.length === 0) return null;

  const packetType = (view[0] >> 4) & 0x0f;

  switch (packetType) {
    case 2:
      return { type: "connack" };
    case 3: {
      const buf = view;
      let pos = 1;

      let remaining = 0;
      let multiplier = 1;
      let byte: number;
      do {
        byte = buf[pos++];
        remaining += (byte & 0x7f) * multiplier;
        multiplier *= 128;
      } while (byte & 0x80);

      const topicLen = (buf[pos] << 8) | buf[pos + 1];
      pos += 2;

      const topicBytes = buf.slice(pos, pos + topicLen);
      const topic = new TextDecoder().decode(topicBytes);
      pos += topicLen;

      const payloadBytes = buf.slice(pos, pos + remaining - 2 - topicLen);
      const payload = new TextDecoder().decode(payloadBytes);

      return { type: "publish", topic, payload };
    }
    case 13:
      return { type: "pingresp" };
    default:
      return { type: "other", packetType };
  }
}

export function buildLiveSubscriptionTopic(sessionId?: string, participantId?: string): string {
  if (sessionId && participantId) {
    return `modelscript/site/+/area/+/line/${sessionId}/cell/${participantId}/data/#`;
  }
  if (sessionId) {
    return `modelscript/site/+/area/+/line/${sessionId}/cell/+/data/#`;
  }
  return "modelscript/site/+/area/+/line/+/cell/+/data/#";
}

export function parseLiveDataTopic(topic: string): { participantId: string; variableName: string } | null {
  const dataMatch = topic.match(/\/cell\/([^/]+)\/data\/(.+)$/);
  if (!dataMatch?.[1] || !dataMatch[2]) return null;
  return { participantId: dataMatch[1], variableName: dataMatch[2] };
}
