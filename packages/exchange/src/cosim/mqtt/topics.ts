// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ISA-95 Unified Namespace (UNS) topic builder for ModelScript MQTT co-simulation.
 *
 * Topic hierarchy:
 *   modelscript/site/{siteId}/area/{areaId}/line/{sessionId}/cell/{participantId}/...
 */

/** Default site and area for single-instance deployments. */
const DEFAULT_SITE = "default";
const DEFAULT_AREA = "default";

/** UNS context identifying the location in the namespace hierarchy. */
export interface UnsContext {
  /** Site identifier (deployment instance). */
  site: string;
  /** Area identifier (project/workspace). */
  area: string;
}

/** Create a default UNS context. */
export function createUnsContext(site?: string, area?: string): UnsContext {
  return {
    site: site ?? DEFAULT_SITE,
    area: area ?? DEFAULT_AREA,
  };
}

/** Base prefix for all ModelScript topics. */
function basePrefix(ctx: UnsContext): string {
  return `modelscript/site/${ctx.site}/area/${ctx.area}`;
}

// ── Session-level topics ──

/** Control topic for orchestrator → participant commands. */
export function sessionControlTopic(ctx: UnsContext, sessionId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/control`;
}

/** Status topic for participant → orchestrator acknowledgments. */
export function sessionStatusTopic(ctx: UnsContext, sessionId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/status`;
}

/** Aggregated results topic for dashboard/WebSocket bridging. */
export function sessionResultsTopic(ctx: UnsContext, sessionId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/results`;
}

// ── Participant-level topics ──

/** Participant metadata topic (retained birth/death certificate). */
export function participantMetaTopic(ctx: UnsContext, participantId: string): string {
  return `${basePrefix(ctx)}/participants/${participantId}/meta`;
}

/** Participant metadata wildcard subscription. */
export function participantMetaWildcard(ctx: UnsContext): string {
  return `${basePrefix(ctx)}/participants/+/meta`;
}

/** Participant lifecycle state topic. */
export function participantStateTopic(ctx: UnsContext, sessionId: string, participantId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/cell/${participantId}/state`;
}

/** Individual variable data topic. */
export function variableDataTopic(
  ctx: UnsContext,
  sessionId: string,
  participantId: string,
  variableName: string,
): string {
  return `${basePrefix(ctx)}/line/${sessionId}/cell/${participantId}/data/${variableName}`;
}

/** Batched variable data topic (all variables in one JSON message). */
export function variableBatchTopic(ctx: UnsContext, sessionId: string, participantId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/cell/${participantId}/data/_batch`;
}

/** Wildcard subscription for all variable data from a participant. */
export function variableDataWildcard(ctx: UnsContext, sessionId: string, participantId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/cell/${participantId}/data/#`;
}

/** Wildcard subscription for all participant data in a session. */
export function sessionDataWildcard(ctx: UnsContext, sessionId: string): string {
  return `${basePrefix(ctx)}/line/${sessionId}/cell/+/data/#`;
}

// ── Historian topics ──

/** Historian query request topic. */
export function historianQueryRequestTopic(ctx: UnsContext): string {
  return `${basePrefix(ctx)}/historian/query/request`;
}

/** Historian query response topic for a specific request. */
export function historianQueryResponseTopic(ctx: UnsContext, requestId: string): string {
  return `${basePrefix(ctx)}/historian/query/response/${requestId}`;
}

// ── Topic parsing ──

/** Extract the participant ID from a participant meta topic string. */
export function parseParticipantIdFromMetaTopic(topic: string): string | null {
  const match = topic.match(/\/participants\/([^/]+)\/meta$/);
  return match?.[1] ?? null;
}

/** Extract session, participant, and variable from a data topic. */
export function parseDataTopic(topic: string): {
  sessionId: string;
  participantId: string;
  variableName: string;
} | null {
  const match = topic.match(/\/line\/([^/]+)\/cell\/([^/]+)\/data\/(.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return {
    sessionId: match[1],
    participantId: match[2],
    variableName: match[3],
  };
}
