// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Co-simulation session lifecycle manager.
 *
 * Manages the lifecycle of co-simulation sessions: creation, participant registration,
 * coupling configuration, and state transitions.
 */

import { CouplingGraph, type VariableCoupling } from "./coupling.js";
import type { CoSimParticipant } from "./participant.js";

/** Session state machine. */
export type SessionState = "created" | "initializing" | "running" | "paused" | "completed" | "failed";

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

  private _state: SessionState = "created";
  private readonly _participants = new Map<string, CoSimParticipant>();
  private _error: string | null = null as string | null;

  constructor(sessionId: string, experiment: SessionExperiment, realtimeFactor = 0) {
    this.sessionId = sessionId;
    this.experiment = experiment;
    this.coupling = new CouplingGraph();
    this.realtimeFactor = realtimeFactor;
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
 */
export class SessionManager {
  private readonly sessions = new Map<string, CoSimSession>();

  /** Create a new session. */
  createSession(experiment: SessionExperiment, realtimeFactor = 0): CoSimSession {
    const sessionId = `cosim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = new CoSimSession(sessionId, experiment, realtimeFactor);
    this.sessions.set(sessionId, session);
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
    }
  }
}
