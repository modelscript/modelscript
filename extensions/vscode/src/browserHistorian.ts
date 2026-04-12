// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Browser-local in-memory time-series historian.
//
// Provides lightweight recording and querying of co-simulation variable
// data without requiring TimescaleDB. Data is stored in memory and lost
// when the extension host reloads.

/** A single recorded data point. */
export interface DataPoint {
  sessionId: string;
  participantId: string;
  variable: string;
  value: number;
  time: number;
}

/** Query options for retrieving recorded data. */
export interface HistorianQuery {
  participantId?: string;
  variable?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

/**
 * In-memory time-series store for co-simulation data.
 *
 * Records are indexed by sessionId for fast session-scoped queries.
 * No persistence — data lives only for the extension host lifetime.
 */
export class BrowserHistorian {
  /** sessionId → data points (in insertion order). */
  private sessions = new Map<string, DataPoint[]>();

  /** Record a data point. */
  record(sessionId: string, participantId: string, variable: string, value: number, time: number): void {
    let points = this.sessions.get(sessionId);
    if (!points) {
      points = [];
      this.sessions.set(sessionId, points);
    }
    points.push({ sessionId, participantId, variable, value, time });
  }

  /** Query data points for a session with optional filters. */
  query(sessionId: string, opts?: HistorianQuery): DataPoint[] {
    const points = this.sessions.get(sessionId);
    if (!points) return [];

    let result = points;

    if (opts?.participantId) {
      result = result.filter((p) => p.participantId === opts.participantId);
    }
    if (opts?.variable) {
      result = result.filter((p) => p.variable === opts.variable);
    }
    if (opts?.startTime !== undefined) {
      result = result.filter((p) => p.time >= opts.startTime!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    if (opts?.endTime !== undefined) {
      result = result.filter((p) => p.time <= opts.endTime!); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    }
    if (opts?.limit !== undefined && result.length > opts.limit) {
      result = result.slice(-opts.limit);
    }

    return result;
  }

  /** List all session IDs with their record counts. */
  listSessions(): { sessionId: string; count: number }[] {
    const result: { sessionId: string; count: number }[] = [];
    for (const [sessionId, points] of this.sessions) {
      result.push({ sessionId, count: points.length });
    }
    return result;
  }

  /** Get distinct variable names for a session. */
  getVariables(sessionId: string): string[] {
    const points = this.sessions.get(sessionId);
    if (!points) return [];
    return [...new Set(points.map((p) => p.variable))];
  }

  /** Get distinct participant IDs for a session. */
  getParticipants(sessionId: string): string[] {
    const points = this.sessions.get(sessionId);
    if (!points) return [];
    return [...new Set(points.map((p) => p.participantId))];
  }

  /** Clear data for a specific session, or all data. */
  clear(sessionId?: string): void {
    if (sessionId) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.clear();
    }
  }

  /** Total number of data points across all sessions. */
  get totalPoints(): number {
    let total = 0;
    for (const points of this.sessions.values()) {
      total += points.length;
    }
    return total;
  }

  dispose(): void {
    this.sessions.clear();
  }
}
