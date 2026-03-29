// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation session lifecycle manager.
 *
 * Manages the lifecycle of co-simulation sessions: creation, participant registration,
 * coupling configuration, and state transitions.
 */

import type { CosimValue } from "./coupling.js";
import { CouplingGraph, type VariableCoupling } from "./coupling.js";
import type { CoSimParticipant } from "./participant.js";

/** Session state machine. */
export type SessionState = "created" | "initializing" | "running" | "paused" | "completed" | "failed";

/** Master algorithm for the co-simulation step loop. */
export type MasterAlgorithm = "gauss-seidel" | "jacobi" | "richardson" | "newton";

/** Experiment parameters for a session. */
export interface SessionExperiment {
  startTime: number;
  stopTime: number;
  stepSize: number;
}

/** Co-simulation session. */
export class CoSimSession {
  readonly sessionId: string;
  readonly experiment: SessionExperiment;
  readonly coupling: CouplingGraph;
  readonly realtimeFactor: number;
  /** Master algorithm for the step loop. */
  readonly masterAlgorithm: MasterAlgorithm;
  /** Richardson extrapolation error tolerance (used when masterAlgorithm is 'richardson'). */
  readonly richardsonTolerance: number;

  private _state: SessionState = "created";
  private readonly _participants = new Map<string, CoSimParticipant>();
  private _error: string | null = null as string | null;
  /** Queued tunable parameter changes: participantId → (paramName → value). */
  private readonly _pendingParams = new Map<string, Map<string, CosimValue>>();

  constructor(
    sessionId: string,
    experiment: SessionExperiment,
    realtimeFactor = 0,
    masterAlgorithm: MasterAlgorithm = "gauss-seidel",
    richardsonTolerance = 1e-4,
  ) {
    this.sessionId = sessionId;
    this.experiment = experiment;
    this.coupling = new CouplingGraph();
    this.realtimeFactor = realtimeFactor;
    this.masterAlgorithm = masterAlgorithm;
    this.richardsonTolerance = richardsonTolerance;
  }

  /** Current session state. */
  get state(): SessionState {
    return this._state;
  }

  /** Error message (when state is 'failed'). */
  get error(): string | null {
    return this._error;
  }

  /** All participants in this session. */
  get participants(): ReadonlyMap<string, CoSimParticipant> {
    return this._participants;
  }

  /** Add a participant to the session. */
  addParticipant(participant: CoSimParticipant): void {
    if (this._state !== "created") {
      throw new Error(`Cannot add participants in state '${this._state}'`);
    }
    if (this._participants.has(participant.id)) {
      throw new Error(`Participant '${participant.id}' already exists in session`);
    }
    this._participants.set(participant.id, participant);
  }

  /** Remove a participant from the session. */
  removeParticipant(participantId: string): void {
    if (this._state !== "created") {
      throw new Error(`Cannot remove participants in state '${this._state}'`);
    }
    this._participants.delete(participantId);
  }

  /**
   * Queue a tunable parameter change for a participant.
   * Changes are applied by the orchestrator before the next step.
   */
  queueParameterChange(participantId: string, name: string, value: CosimValue): void {
    if (!this._participants.has(participantId)) {
      throw new Error(`Participant '${participantId}' not found`);
    }
    let params = this._pendingParams.get(participantId);
    if (!params) {
      params = new Map();
      this._pendingParams.set(participantId, params);
    }
    params.set(name, value);
  }

  /**
   * Drain all pending parameter changes (called by the orchestrator before each step).
   * Returns the map and clears it.
   */
  drainParameterChanges(): Map<string, Map<string, CosimValue>> {
    const changes = new Map(this._pendingParams);
    this._pendingParams.clear();
    return changes;
  }

  /** Add a variable coupling. */
  addCoupling(coupling: VariableCoupling): void {
    if (this._state !== "created") {
      throw new Error(`Cannot modify couplings in state '${this._state}'`);
    }
    // Validate that both participant IDs exist
    if (!this._participants.has(coupling.from.participantId)) {
      throw new Error(`Source participant '${coupling.from.participantId}' not found`);
    }
    if (!this._participants.has(coupling.to.participantId)) {
      throw new Error(`Target participant '${coupling.to.participantId}' not found`);
    }
    this.coupling.addCoupling(coupling);
  }

  // ── State transitions ──

  /** Transition to a new state (internal). */
  transition(newState: SessionState, error?: string): void {
    const validTransitions: Record<SessionState, SessionState[]> = {
      created: ["initializing", "failed"],
      initializing: ["running", "failed"],
      running: ["paused", "completed", "failed"],
      paused: ["running", "completed", "failed"],
      completed: [],
      failed: [],
    };

    const allowed = validTransitions[this._state];
    if (!allowed?.includes(newState)) {
      throw new Error(`Invalid state transition: '${this._state}' → '${newState}'`);
    }

    this._state = newState;
    if (error) this._error = error;
  }

  /** Serialize session info for API responses. */
  toJSON(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      state: this._state,
      error: this._error,
      experiment: this.experiment,
      realtimeFactor: this.realtimeFactor,
      participants: Array.from(this._participants.values()).map((p) => ({
        id: p.id,
        modelName: p.modelName,
        type: p.metadata.type,
      })),
      couplings: this.coupling.getAll(),
    };
  }
}

/**
 * Session manager: creates and tracks co-simulation sessions.
 *
 * Supports automatic cleanup of stale sessions (completed/failed) after
 * a configurable TTL, and periodic reaping of sessions that have been
 * running longer than a maximum duration.
 */
export class SessionManager {
  private readonly sessions = new Map<string, CoSimSession>();
  private readonly sessionTimestamps = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Maximum age (ms) for completed/failed sessions before cleanup. Default: 1 hour. */
  readonly staleTtlMs: number;
  /** Maximum runtime (ms) for running sessions before forced failure. Default: 24 hours. */
  readonly maxRuntimeMs: number;

  constructor(options?: { staleTtlMs?: number; maxRuntimeMs?: number; cleanupIntervalMs?: number }) {
    this.staleTtlMs = options?.staleTtlMs ?? 60 * 60 * 1000; // 1 hour
    this.maxRuntimeMs = options?.maxRuntimeMs ?? 24 * 60 * 60 * 1000; // 24 hours

    // Start periodic cleanup
    const intervalMs = options?.cleanupIntervalMs ?? 5 * 60 * 1000; // 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), intervalMs);
  }

  /** Create a new session. */
  createSession(experiment: SessionExperiment, realtimeFactor = 0): CoSimSession {
    const sessionId = `cosim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = new CoSimSession(sessionId, experiment, realtimeFactor);
    this.sessions.set(sessionId, session);
    this.sessionTimestamps.set(sessionId, Date.now());
    return session;
  }

  /** Get a session by ID. */
  getSession(sessionId: string): CoSimSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /** List all sessions. */
  listSessions(): CoSimSession[] {
    return Array.from(this.sessions.values());
  }

  /** Remove a completed/failed session. */
  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && (session.state === "completed" || session.state === "failed")) {
      this.sessions.delete(sessionId);
      this.sessionTimestamps.delete(sessionId);
    }
  }

  /**
   * Clean up stale sessions:
   * - Remove completed/failed sessions older than staleTtlMs
   * - Force-fail running sessions older than maxRuntimeMs
   */
  cleanupStaleSessions(): { removed: string[]; failed: string[] } {
    const now = Date.now();
    const removed: string[] = [];
    const failed: string[] = [];

    for (const [id, session] of this.sessions) {
      const created = this.sessionTimestamps.get(id) ?? now;
      const age = now - created;

      if (session.state === "completed" || session.state === "failed") {
        if (age > this.staleTtlMs) {
          this.sessions.delete(id);
          this.sessionTimestamps.delete(id);
          removed.push(id);
        }
      } else if (session.state === "running" || session.state === "paused") {
        if (age > this.maxRuntimeMs) {
          try {
            session.transition("failed", `Session timed out after ${Math.round(age / 1000)}s`);
            failed.push(id);
          } catch {
            // Already in terminal state
          }
        }
      }
    }

    return { removed, failed };
  }

  /** Stop the periodic cleanup timer. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }
}
