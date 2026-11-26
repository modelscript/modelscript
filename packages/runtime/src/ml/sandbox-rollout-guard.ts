// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Fuel/Memory-Capped Sandboxed RLVR Rollout Guard.
 *
 * Enforces deterministic resource ceilings and anti-DoS isolation around untrusted
 * RLVR / GRPO rollouts and crowd-submitted engineering models (Modelica, SCAD, SysML2,
 * SPICE, etc.) before/during 4-gate verification and physics evaluation:
 *
 *   1. Deterministic instruction-fuel metering (`fuelBudget`, `consumeFuel`).
 *   2. Deterministic byte/memory ceilings (`memoryLimitBytes`, `allocateBytes` / `releaseBytes`,
 *      plus pre-flight payload byte validation).
 *   3. Wall-clock timeout enforcement (`timeoutMs`, cooperative `checkDeadline()`, `AbortSignal`,
 *      and hard async race with timer cleanup).
 *   4. Per-tenant sliding-window anti-DoS circuit breaker (`closed` -> `open` -> `half-open` -> `closed`)
 *      isolating abusive or pathological tenants without degrading healthy tenants.
 */

export type SandboxTrapKind = "fuel-exhausted" | "memory-exceeded" | "timed-out";

export type RolloutExecutionStatus =
  "ok" | "fuel-exhausted" | "memory-exceeded" | "timed-out" | "circuit-open" | "error";

export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface RolloutGuardAuditEntry {
  timestampMs: number;
  kind: "fuel" | "alloc" | "release" | "trap" | "circuit";
  label?: string | undefined;
  delta: number;
  totalFuel: number;
  currentMemoryBytes: number;
}

export interface CircuitBreakerConfig {
  /** Number of counted failures within `slidingWindowMs` that opens the tenant circuit (default: 3). */
  failureThreshold: number;
  /** Duration in milliseconds the circuit stays open before allowing half-open probes (default: 30_000). */
  cooldownMs: number;
  /** Sliding window in milliseconds for counting consecutive/recent failures (default: 60_000). */
  slidingWindowMs: number;
  /** Maximum concurrent/sequential probes allowed in half-open state before closing (default: 1). */
  halfOpenSuccessThreshold: number;
}

export interface SandboxRolloutGuardOptions {
  /** Default deterministic instruction-fuel budget per rollout (default: 100_000). */
  defaultFuelBudget?: number | undefined;
  /** Default memory ceiling in bytes per rollout (default: 64 MiB). */
  defaultMemoryLimitBytes?: number | undefined;
  /** Default wall-clock timeout in milliseconds per rollout (default: 2_500 ms). */
  defaultTimeoutMs?: number | undefined;
  /** Maximum input payload size in bytes accepted before rollout starts (default: 2 MiB). */
  maxInputBytes?: number | undefined;
  /** Per-tenant anti-DoS circuit breaker configuration. */
  circuitBreaker?: Partial<CircuitBreakerConfig> | undefined;
  /** Maximum audit entries retained per rollout report (default: 64). */
  maxAuditEntries?: number | undefined;
  /** Injectable monotonic/wall clock in ms (defaults to `Date.now`). */
  clock?: (() => number) | undefined;
}

export interface RolloutExecutionRequest {
  /** Tenant or submitter identifier isolated by the anti-DoS circuit breaker. */
  tenantId: string;
  /** Optional rollout identifier (auto-generated if omitted). */
  rolloutId?: string | undefined;
  /** Optional override for deterministic instruction-fuel budget (clamped <= defaultFuelBudget when strictCeiling=true). */
  fuelBudget?: number | undefined;
  /** Optional override for memory ceiling in bytes. */
  memoryLimitBytes?: number | undefined;
  /** Optional override for wall-clock timeout in ms. */
  timeoutMs?: number | undefined;
  /** Optional untrusted payload/source text or byte count charged up front against memory & input ceilings. */
  inputPayload?: string | Uint8Array | undefined;
  /** Optional pre-computed input byte size if payload is not passed directly. */
  inputBytes?: number | undefined;
  /** When true (default), request overrides cannot exceed executor-level defaults. */
  enforceExecutorCeilings?: boolean | undefined;
  /** Whether ordinary thrown errors (non-resource traps) count toward the circuit breaker (default: false). */
  countRuntimeErrorsTowardBreaker?: boolean | undefined;
}

export interface SandboxResourceSnapshot {
  fuelUsed: number;
  fuelBudget: number;
  remainingFuel: number;
  currentMemoryBytes: number;
  peakMemoryBytes: number;
  memoryLimitBytes: number;
  elapsedMs: number;
  timeoutMs: number;
  timedOut: boolean;
  fuelExhausted: boolean;
  memoryExceeded: boolean;
}

export interface SandboxContext {
  readonly tenantId: string;
  readonly rolloutId: string;
  readonly fuelBudget: number;
  readonly memoryLimitBytes: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** Deducts deterministic instruction fuel; throws `SandboxTrapError("fuel-exhausted")` if budget exceeded. */
  consumeFuel(units: number, label?: string): number;
  /** Reserves deterministic memory bytes; throws `SandboxTrapError("memory-exceeded")` if ceiling exceeded. */
  allocateBytes(bytes: number, label?: string): number;
  /** Releases previously reserved memory bytes (clamped at 0). */
  releaseBytes(bytes: number, label?: string): number;
  /** Checks wall-clock deadline and abort status; throws `SandboxTrapError("timed-out")` when expired. */
  checkDeadline(label?: string): void;
  /** Convenience helper for metering bounded loops deterministically. */
  runBoundedLoop(iterations: number, fuelPerIteration: number, body: (index: number) => void, label?: string): void;
  /** Returns a point-in-time snapshot of fuel, memory, and elapsed wall-clock metrics. */
  getSnapshot(): SandboxResourceSnapshot;
}

export interface RolloutExecutionReport<T = unknown> {
  ok: boolean;
  status: RolloutExecutionStatus;
  tenantId: string;
  rolloutId: string;
  value?: T | undefined;
  error?: string | undefined;
  fuelUsed: number;
  fuelBudget: number;
  peakMemoryBytes: number;
  memoryLimitBytes: number;
  elapsedMs: number;
  timeoutMs: number;
  timedOut: boolean;
  fuelExhausted: boolean;
  memoryExceeded: boolean;
  circuitOpen: boolean;
  circuitState: CircuitBreakerState;
  retryAfterMs?: number | undefined;
  auditLog: RolloutGuardAuditEntry[];
}

export interface TenantCircuitSnapshot {
  tenantId: string;
  state: CircuitBreakerState;
  recentFailures: number;
  totalFailures: number;
  totalRejected: number;
  totalExecuted: number;
  openedAtMs?: number | undefined;
  retryAfterMs: number;
  halfOpenSuccesses: number;
}

export interface SandboxExecutorMetrics {
  totalExecuted: number;
  totalSucceeded: number;
  totalFuelExhausted: number;
  totalMemoryExceeded: number;
  totalTimedOut: number;
  totalCircuitRejected: number;
  totalRuntimeErrors: number;
  activeTenants: number;
  openCircuits: number;
}

export class SandboxTrapError extends Error {
  public readonly kind: SandboxTrapKind;
  public readonly detail: Record<string, number | string>;

  constructor(kind: SandboxTrapKind, message: string, detail: Record<string, number | string> = {}) {
    super(message);
    this.name = "SandboxTrapError";
    this.kind = kind;
    this.detail = detail;
  }
}

interface TenantCircuitRecord {
  state: CircuitBreakerState;
  failureTimestampsMs: number[];
  openedAtMs: number | undefined;
  halfOpenSuccesses: number;
  totalFailures: number;
  totalRejected: number;
  totalExecuted: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 30_000,
  slidingWindowMs: 60_000,
  halfOpenSuccessThreshold: 1,
};

export const DEFAULT_SANDBOX_FUEL_BUDGET = 100_000;
export const DEFAULT_SANDBOX_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_SANDBOX_TIMEOUT_MS = 2_500;
export const DEFAULT_SANDBOX_MAX_INPUT_BYTES = 2 * 1024 * 1024;

function computePayloadBytes(payload?: string | Uint8Array): number {
  if (payload === undefined) return 0;
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  return payload.byteLength;
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

/**
 * Fuel/Memory-Capped Sandboxed RLVR Rollout Guard with per-tenant anti-DoS circuit breaking.
 */
export class SandboxedRolloutExecutor {
  public readonly defaultFuelBudget: number;
  public readonly defaultMemoryLimitBytes: number;
  public readonly defaultTimeoutMs: number;
  public readonly maxInputBytes: number;
  public readonly circuitBreaker: CircuitBreakerConfig;

  private readonly maxAuditEntries: number;
  private readonly clock: () => number;
  private readonly tenants = new Map<string, TenantCircuitRecord>();
  private rolloutSeq = 0;

  private metrics: Omit<SandboxExecutorMetrics, "activeTenants" | "openCircuits"> = {
    totalExecuted: 0,
    totalSucceeded: 0,
    totalFuelExhausted: 0,
    totalMemoryExceeded: 0,
    totalTimedOut: 0,
    totalCircuitRejected: 0,
    totalRuntimeErrors: 0,
  };

  constructor(options: SandboxRolloutGuardOptions = {}) {
    this.defaultFuelBudget = clampPositive(options.defaultFuelBudget, DEFAULT_SANDBOX_FUEL_BUDGET);
    this.defaultMemoryLimitBytes = clampPositive(options.defaultMemoryLimitBytes, DEFAULT_SANDBOX_MEMORY_LIMIT_BYTES);
    this.defaultTimeoutMs = clampPositive(options.defaultTimeoutMs, DEFAULT_SANDBOX_TIMEOUT_MS);
    this.maxInputBytes = clampPositive(options.maxInputBytes, DEFAULT_SANDBOX_MAX_INPUT_BYTES);
    this.maxAuditEntries = clampPositive(options.maxAuditEntries, 64);
    this.clock = options.clock ?? (() => Date.now());
    this.circuitBreaker = {
      failureThreshold: clampPositive(
        options.circuitBreaker?.failureThreshold,
        DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
      ),
      cooldownMs: clampPositive(options.circuitBreaker?.cooldownMs, DEFAULT_CIRCUIT_BREAKER_CONFIG.cooldownMs),
      slidingWindowMs: clampPositive(
        options.circuitBreaker?.slidingWindowMs,
        DEFAULT_CIRCUIT_BREAKER_CONFIG.slidingWindowMs,
      ),
      halfOpenSuccessThreshold: clampPositive(
        options.circuitBreaker?.halfOpenSuccessThreshold,
        DEFAULT_CIRCUIT_BREAKER_CONFIG.halfOpenSuccessThreshold,
      ),
    };
  }

  private getOrCreateTenant(tenantId: string): TenantCircuitRecord {
    let rec = this.tenants.get(tenantId);
    if (!rec) {
      rec = {
        state: "closed",
        failureTimestampsMs: [],
        openedAtMs: undefined,
        halfOpenSuccesses: 0,
        totalFailures: 0,
        totalRejected: 0,
        totalExecuted: 0,
      };
      this.tenants.set(tenantId, rec);
    }
    return rec;
  }

  private pruneSlidingWindow(rec: TenantCircuitRecord, nowMs: number): void {
    const cutoff = nowMs - this.circuitBreaker.slidingWindowMs;
    if (rec.failureTimestampsMs.length === 0) return;
    let keepFrom = 0;
    while (keepFrom < rec.failureTimestampsMs.length && rec.failureTimestampsMs[keepFrom]! < cutoff) {
      keepFrom++;
    }
    if (keepFrom > 0) {
      rec.failureTimestampsMs = rec.failureTimestampsMs.slice(keepFrom);
    }
  }

  private refreshCircuitState(
    rec: TenantCircuitRecord,
    nowMs: number,
  ): {
    state: CircuitBreakerState;
    retryAfterMs: number;
  } {
    this.pruneSlidingWindow(rec, nowMs);
    if (rec.state === "open" && rec.openedAtMs !== undefined) {
      const elapsed = nowMs - rec.openedAtMs;
      if (elapsed >= this.circuitBreaker.cooldownMs) {
        rec.state = "half-open";
        rec.halfOpenSuccesses = 0;
        return { state: "half-open", retryAfterMs: 0 };
      }
      return { state: "open", retryAfterMs: Math.max(0, this.circuitBreaker.cooldownMs - elapsed) };
    }
    return { state: rec.state, retryAfterMs: 0 };
  }

  private recordTenantFailure(rec: TenantCircuitRecord, nowMs: number): CircuitBreakerState {
    rec.totalFailures++;
    this.pruneSlidingWindow(rec, nowMs);
    rec.failureTimestampsMs.push(nowMs);

    if (rec.state === "half-open") {
      // Failed half-open probe immediately re-opens the circuit
      rec.state = "open";
      rec.openedAtMs = nowMs;
      rec.halfOpenSuccesses = 0;
      return rec.state;
    }

    if (rec.failureTimestampsMs.length >= this.circuitBreaker.failureThreshold) {
      rec.state = "open";
      rec.openedAtMs = nowMs;
      rec.halfOpenSuccesses = 0;
    }
    return rec.state;
  }

  private recordTenantSuccess(rec: TenantCircuitRecord): CircuitBreakerState {
    if (rec.state === "half-open") {
      rec.halfOpenSuccesses++;
      if (rec.halfOpenSuccesses >= this.circuitBreaker.halfOpenSuccessThreshold) {
        rec.state = "closed";
        rec.openedAtMs = undefined;
        rec.failureTimestampsMs = [];
        rec.halfOpenSuccesses = 0;
      }
    }
    return rec.state;
  }

  /** Returns the current anti-DoS circuit breaker snapshot for a tenant. */
  public getTenantCircuitState(tenantId: string): TenantCircuitSnapshot {
    const nowMs = this.clock();
    const rec = this.getOrCreateTenant(tenantId);
    const { state, retryAfterMs } = this.refreshCircuitState(rec, nowMs);
    return {
      tenantId,
      state,
      recentFailures: rec.failureTimestampsMs.length,
      totalFailures: rec.totalFailures,
      totalRejected: rec.totalRejected,
      totalExecuted: rec.totalExecuted,
      openedAtMs: rec.openedAtMs,
      retryAfterMs,
      halfOpenSuccesses: rec.halfOpenSuccesses,
    };
  }

  /** Manually resets a tenant's circuit breaker back to closed state (e.g., admin override). */
  public resetTenantCircuit(tenantId: string): void {
    const rec = this.tenants.get(tenantId);
    if (!rec) return;
    rec.state = "closed";
    rec.failureTimestampsMs = [];
    rec.openedAtMs = undefined;
    rec.halfOpenSuccesses = 0;
  }

  /** Returns aggregate executor telemetry across all tenants. */
  public getMetrics(): SandboxExecutorMetrics {
    const nowMs = this.clock();
    let openCircuits = 0;
    for (const rec of this.tenants.values()) {
      const { state } = this.refreshCircuitState(rec, nowMs);
      if (state === "open") openCircuits++;
    }
    return {
      ...this.metrics,
      activeTenants: this.tenants.size,
      openCircuits,
    };
  }

  /**
   * Executes an untrusted RLVR rollout or verification task inside a fuel-, memory-,
   * and wall-clock-capped sandbox protected by a per-tenant anti-DoS circuit breaker.
   */
  public async execute<T>(
    request: RolloutExecutionRequest,
    task: (ctx: SandboxContext) => Promise<T> | T,
  ): Promise<RolloutExecutionReport<T>> {
    const tenantId = request.tenantId.trim() || "anonymous";
    const rolloutId = request.rolloutId ?? `rollout-${++this.rolloutSeq}`;
    const enforceCeilings = request.enforceExecutorCeilings ?? true;

    const reqFuel = clampPositive(request.fuelBudget, this.defaultFuelBudget);
    const fuelBudget = enforceCeilings ? Math.min(reqFuel, this.defaultFuelBudget) : reqFuel;

    const reqMem = clampPositive(request.memoryLimitBytes, this.defaultMemoryLimitBytes);
    const memoryLimitBytes = enforceCeilings ? Math.min(reqMem, this.defaultMemoryLimitBytes) : reqMem;

    const reqTimeout = clampPositive(request.timeoutMs, this.defaultTimeoutMs);
    const timeoutMs = enforceCeilings ? Math.min(reqTimeout, this.defaultTimeoutMs) : reqTimeout;

    const startMs = this.clock();
    const rec = this.getOrCreateTenant(tenantId);
    const { state: initialState, retryAfterMs } = this.refreshCircuitState(rec, startMs);
    const auditLog: RolloutGuardAuditEntry[] = [];

    const pushAudit = (entry: Omit<RolloutGuardAuditEntry, "timestampMs">) => {
      if (auditLog.length < this.maxAuditEntries) {
        auditLog.push({ timestampMs: this.clock(), ...entry });
      }
    };

    if (initialState === "open") {
      rec.totalRejected++;
      this.metrics.totalCircuitRejected++;
      pushAudit({
        kind: "circuit",
        label: "circuit-open-reject",
        delta: retryAfterMs,
        totalFuel: 0,
        currentMemoryBytes: 0,
      });
      return {
        ok: false,
        status: "circuit-open",
        tenantId,
        rolloutId,
        error: `Tenant '${tenantId}' circuit breaker is open (retry after ${retryAfterMs}ms).`,
        fuelUsed: 0,
        fuelBudget,
        peakMemoryBytes: 0,
        memoryLimitBytes,
        elapsedMs: 0,
        timeoutMs,
        timedOut: false,
        fuelExhausted: false,
        memoryExceeded: false,
        circuitOpen: true,
        circuitState: "open",
        retryAfterMs,
        auditLog,
      };
    }

    rec.totalExecuted++;
    this.metrics.totalExecuted++;

    let fuelUsed = 0;
    let currentMemoryBytes = 0;
    let peakMemoryBytes = 0;
    let fuelExhausted = false;
    let memoryExceeded = false;
    let timedOut = false;

    const abortController = new AbortController();

    const getElapsedMs = () => Math.max(0, this.clock() - startMs);

    const checkDeadline = (label?: string): void => {
      const elapsed = getElapsedMs();
      if (timedOut || abortController.signal.aborted || elapsed > timeoutMs) {
        timedOut = true;
        if (!abortController.signal.aborted) {
          abortController.abort();
        }
        pushAudit({
          kind: "trap",
          label: label ?? "deadline-exceeded",
          delta: elapsed,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
        throw new SandboxTrapError(
          "timed-out",
          `Rollout '${rolloutId}' exceeded wall-clock timeout (${elapsed}ms > ${timeoutMs}ms).`,
          { elapsedMs: elapsed, timeoutMs },
        );
      }
    };

    const consumeFuel = (units: number, label?: string): number => {
      checkDeadline(label);
      if (!Number.isFinite(units) || units < 0) {
        throw new Error(`Fuel units must be a non-negative finite number, got ${units}.`);
      }
      const charge = Math.ceil(units);
      fuelUsed += charge;
      if (fuelUsed > fuelBudget) {
        fuelExhausted = true;
        abortController.abort();
        pushAudit({
          kind: "trap",
          label: label ?? "fuel-exhausted",
          delta: charge,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
        throw new SandboxTrapError(
          "fuel-exhausted",
          `Rollout '${rolloutId}' exhausted instruction fuel budget (${fuelUsed} > ${fuelBudget}).`,
          { fuelUsed, fuelBudget },
        );
      }
      if (label) {
        pushAudit({
          kind: "fuel",
          label,
          delta: charge,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
      }
      return fuelBudget - fuelUsed;
    };

    const allocateBytes = (bytes: number, label?: string): number => {
      checkDeadline(label);
      if (!Number.isFinite(bytes) || bytes < 0) {
        throw new Error(`Allocation bytes must be a non-negative finite number, got ${bytes}.`);
      }
      const inc = Math.ceil(bytes);
      currentMemoryBytes += inc;
      if (currentMemoryBytes > peakMemoryBytes) {
        peakMemoryBytes = currentMemoryBytes;
      }
      if (currentMemoryBytes > memoryLimitBytes) {
        memoryExceeded = true;
        abortController.abort();
        pushAudit({
          kind: "trap",
          label: label ?? "memory-exceeded",
          delta: inc,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
        throw new SandboxTrapError(
          "memory-exceeded",
          `Rollout '${rolloutId}' exceeded memory ceiling (${currentMemoryBytes}B > ${memoryLimitBytes}B).`,
          { currentMemoryBytes, peakMemoryBytes, memoryLimitBytes },
        );
      }
      if (label) {
        pushAudit({
          kind: "alloc",
          label,
          delta: inc,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
      }
      return currentMemoryBytes;
    };

    const releaseBytes = (bytes: number, label?: string): number => {
      if (!Number.isFinite(bytes) || bytes < 0) return currentMemoryBytes;
      const dec = Math.ceil(bytes);
      currentMemoryBytes = Math.max(0, currentMemoryBytes - dec);
      if (label) {
        pushAudit({
          kind: "release",
          label,
          delta: -dec,
          totalFuel: fuelUsed,
          currentMemoryBytes,
        });
      }
      return currentMemoryBytes;
    };

    const ctx: SandboxContext = {
      tenantId,
      rolloutId,
      fuelBudget,
      memoryLimitBytes,
      timeoutMs,
      signal: abortController.signal,
      consumeFuel,
      allocateBytes,
      releaseBytes,
      checkDeadline,
      runBoundedLoop: (iterations: number, fuelPerIteration: number, body: (index: number) => void, label?: string) => {
        const count = Math.max(0, Math.floor(iterations));
        for (let i = 0; i < count; i++) {
          consumeFuel(fuelPerIteration, i === 0 ? label : undefined);
          body(i);
        }
      },
      getSnapshot: () => ({
        fuelUsed,
        fuelBudget,
        remainingFuel: Math.max(0, fuelBudget - fuelUsed),
        currentMemoryBytes,
        peakMemoryBytes,
        memoryLimitBytes,
        elapsedMs: getElapsedMs(),
        timeoutMs,
        timedOut,
        fuelExhausted,
        memoryExceeded,
      }),
    };

    // Pre-flight input payload byte check against maxInputBytes and memoryLimitBytes
    const declaredInputBytes = Math.max(
      computePayloadBytes(request.inputPayload),
      clampPositive(request.inputBytes, 0) ||
        (request.inputBytes && request.inputBytes > 0 ? Math.ceil(request.inputBytes) : 0),
    );

    if (declaredInputBytes > this.maxInputBytes || declaredInputBytes > memoryLimitBytes) {
      memoryExceeded = true;
      peakMemoryBytes = declaredInputBytes;
      currentMemoryBytes = declaredInputBytes;
      this.metrics.totalMemoryExceeded++;
      const nowMs = this.clock();
      const circuitState = this.recordTenantFailure(rec, nowMs);
      const effectiveLimit = Math.min(this.maxInputBytes, memoryLimitBytes);
      pushAudit({
        kind: "trap",
        label: "input-payload-exceeded",
        delta: declaredInputBytes,
        totalFuel: 0,
        currentMemoryBytes: declaredInputBytes,
      });
      return {
        ok: false,
        status: "memory-exceeded",
        tenantId,
        rolloutId,
        error: `Input payload size (${declaredInputBytes}B) exceeds sandbox ceiling (${effectiveLimit}B).`,
        fuelUsed: 0,
        fuelBudget,
        peakMemoryBytes,
        memoryLimitBytes,
        elapsedMs: getElapsedMs(),
        timeoutMs,
        timedOut: false,
        fuelExhausted: false,
        memoryExceeded: true,
        circuitOpen: circuitState === "open",
        circuitState,
        retryAfterMs: circuitState === "open" ? this.circuitBreaker.cooldownMs : undefined,
        auditLog,
      };
    }

    let timerHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      if (declaredInputBytes > 0) {
        allocateBytes(declaredInputBytes, "input-payload");
      }

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timerHandle = setTimeout(() => {
          timedOut = true;
          abortController.abort();
          reject(
            new SandboxTrapError("timed-out", `Rollout '${rolloutId}' exceeded wall-clock timeout (${timeoutMs}ms).`, {
              timeoutMs,
            }),
          );
        }, timeoutMs);
        // Prevent the timer from keeping the Node event loop alive unnecessarily
        if (typeof timerHandle === "object" && timerHandle !== null && "unref" in timerHandle) {
          (timerHandle as { unref?: () => void }).unref?.();
        }
      });

      const taskPromise = Promise.resolve().then(() => task(ctx));
      const value = await Promise.race([taskPromise, timeoutPromise]);

      // Final deadline sanity check in case synchronous CPU work outlasted timeoutMs
      checkDeadline("post-execution-deadline");

      this.metrics.totalSucceeded++;
      const circuitState = this.recordTenantSuccess(rec);
      return {
        ok: true,
        status: "ok",
        tenantId,
        rolloutId,
        value,
        fuelUsed,
        fuelBudget,
        peakMemoryBytes,
        memoryLimitBytes,
        elapsedMs: getElapsedMs(),
        timeoutMs,
        timedOut: false,
        fuelExhausted: false,
        memoryExceeded: false,
        circuitOpen: false,
        circuitState,
        auditLog,
      };
    } catch (err: unknown) {
      const nowMs = this.clock();
      const elapsedMs = Math.max(0, nowMs - startMs);
      const errMsg = err instanceof Error ? err.message : String(err);

      let status: RolloutExecutionStatus = "error";
      let shouldTripBreaker = request.countRuntimeErrorsTowardBreaker ?? false;

      if (err instanceof SandboxTrapError) {
        status = err.kind;
        shouldTripBreaker = true;
        if (err.kind === "fuel-exhausted") {
          fuelExhausted = true;
          this.metrics.totalFuelExhausted++;
        } else if (err.kind === "memory-exceeded") {
          memoryExceeded = true;
          this.metrics.totalMemoryExceeded++;
        } else if (err.kind === "timed-out") {
          timedOut = true;
          this.metrics.totalTimedOut++;
        }
      } else if (timedOut) {
        status = "timed-out";
        shouldTripBreaker = true;
        this.metrics.totalTimedOut++;
      } else {
        this.metrics.totalRuntimeErrors++;
      }

      const circuitState = shouldTripBreaker
        ? this.recordTenantFailure(rec, nowMs)
        : this.refreshCircuitState(rec, nowMs).state;

      return {
        ok: false,
        status,
        tenantId,
        rolloutId,
        error: errMsg,
        fuelUsed,
        fuelBudget,
        peakMemoryBytes,
        memoryLimitBytes,
        elapsedMs,
        timeoutMs,
        timedOut,
        fuelExhausted,
        memoryExceeded,
        circuitOpen: circuitState === "open",
        circuitState,
        retryAfterMs: circuitState === "open" ? this.circuitBreaker.cooldownMs : undefined,
        auditLog,
      };
    } finally {
      if (timerHandle !== undefined) {
        clearTimeout(timerHandle);
      }
    }
  }

  /**
   * Executes a batch of RLVR rollouts sequentially with full per-rollout and per-tenant isolation.
   */
  public async executeBatch<T>(
    items: Array<{
      request: RolloutExecutionRequest;
      task: (ctx: SandboxContext) => Promise<T> | T;
    }>,
  ): Promise<RolloutExecutionReport<T>[]> {
    const reports: RolloutExecutionReport<T>[] = [];
    for (const item of items) {
      reports.push(await this.execute(item.request, item.task));
    }
    return reports;
  }
}
