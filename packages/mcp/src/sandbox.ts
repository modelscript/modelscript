// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module @modelscript/mcp/sandbox
 *
 * Deterministic Execution Sandbox for ModelScript MCP AI Agents.
 *
 * Enforces wall-clock execution deadlines (default: 15.0 s), linear memory /
 * heap ceilings (default: 512 MB), and formats actionable structured diagnostic
 * feedback mapped to ModelScript pre-flight and runtime error codes (M6001–M6017, M7001–M7014)
 * when physical ill-conditioning or simulation errors occur.
 */

/**
 * Execution resource constraints enforced by the ModelScript MCP sandbox.
 */
export interface McpExecutionLimits {
  /**
   * Maximum wall-clock execution time in milliseconds before cancellation.
   * Default: 15,000 ms (15.0 seconds).
   */
  timeoutMs?: number | undefined;

  /**
   * Maximum total heap + ArrayBuffer linear memory footprint in bytes.
   * Default: 536,870,912 bytes (512 MB).
   */
  maxMemoryBytes?: number | undefined;

  /**
   * Maximum net memory growth (delta) allowed during a single tool invocation in bytes.
   * Default: undefined (no delta limit, ceiling only).
   */
  maxDeltaBytes?: number | undefined;

  /**
   * Optional external abort signal chained into the sandbox execution.
   */
  signal?: AbortSignal | undefined;
}

/**
 * Standard ModelScript pre-flight and runtime error codes for simulation ill-conditioning.
 */
export type McpDiagnosticCode =
  | "M6001" // Floating electrical node
  | "M6002" // Transformer winding mismatch
  | "M6003" // Invalid parameter bounds (R, L, C, mass <= 0)
  | "M6004" // Weak grid warning (SCR < 1.5)
  | "M6005" // CSMF unresolved input signal
  | "M6006" // Distributed line travel time underflow (dt > tau)
  | "M6012" // Algebraic loop / singular kinematics / unconstrained DOF
  | "M6013" // Parallel ideal sources without series impedance
  | "M6014" // Unspecified source impedance
  | "M6015" // High wheel-rail derailment quotient / Nadal / Prud'homme limit exceeded
  | "M6016" // Harmonic distortion / IEEE 2800 THD ceiling violation
  | "M6017" // Execution deadline timeout (stiff eigenvalues / excessive step count)
  | "M7001" // Negative metacentric height / hydrostatic instability
  | "M7002" // Slender line length underflow (length < water depth)
  | "M7003" // Acoustic / advective Courant-Friedrichs-Lewy (CFL) violation
  | "M7004" // Unconnected attachment node / mooring fairlead
  | "M7006" // Non-physical stiffness (EA <= 0 or EI <= 0)
  | "M7008" // Missing hydrostatic restoring matrix / singular mass
  | "M7013" // Mass matrix asymmetry or non-positive-definite
  | "M7014" // Memory arena ceiling exceeded (> 512 MB)
  | "M6000"; // General execution / numerical solver error

/**
 * Structured diagnostic metadata returned to LLM agents upon simulation failure.
 */
export interface McpStructuredDiagnostic {
  /** ModelScript error code (e.g., "M6017"). */
  code: McpDiagnosticCode | string;
  /** Kebab-case rule identifier. */
  rule: string;
  /** Diagnostic severity level. */
  severity: "error" | "warning";
  /** Human-readable error message explaining the root cause. */
  message: string;
  /** Concrete, actionable steps for the AI agent to remediate the failure. */
  remediation: string;
  /** Name of the MCP tool that triggered the diagnostic. */
  tool?: string | undefined;
  /** Elapsed execution duration in milliseconds before failure. */
  durationMs?: number | undefined;
  /** Additional diagnostic context or physical metrics. */
  details?: Record<string, unknown> | undefined;
}

/**
 * Standard MCP error response shape returned by tool invocations.
 */
export interface McpToolErrorResponse {
  [x: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: true;
  diagnostic?: McpStructuredDiagnostic | undefined;
}

/**
 * Default limits for deterministic MCP agent execution.
 */
export const DEFAULT_EXECUTION_LIMITS: Readonly<{ timeoutMs: number; maxDeltaBytes: number }> = {
  timeoutMs: 15_000,
  maxDeltaBytes: 512 * 1024 * 1024, // 512 MB linear memory growth ceiling per tool invocation
};

/**
 * Catalog of diagnostic definitions with default rules and remediation advice.
 */
export const SANDBOX_ERROR_CATALOG: Record<
  McpDiagnosticCode,
  { rule: string; severity: "error" | "warning"; remediation: string }
> = {
  M6001: {
    rule: "floating-electrical-node",
    severity: "error",
    remediation:
      "Verify electrical circuit topology. Ensure all buses, nodes, and transformers are connected to at least one active branch, source, or load without disconnected floating terminals.",
  },
  M6002: {
    rule: "transformer-winding-mismatch",
    severity: "warning",
    remediation:
      "Inspect transformer primary and secondary nominal voltage ratings against connected bus base kV. Adjust winding rated voltages to match the bus base within 5%.",
  },
  M6003: {
    rule: "invalid-parameter-bounds",
    severity: "error",
    remediation:
      "Ensure all physical parameters (resistance R, inductance L, capacitance C, mass m, spring stiffness k, or damping c) are strictly positive real numbers.",
  },
  M6004: {
    rule: "weak-grid-warning",
    severity: "warning",
    remediation:
      "Point of Interconnection (POI) Short-Circuit Ratio is low (SCR < 1.5). Add synchronous condensers, STATCOM support, or transition inverter controls from grid-following (GFL) to grid-forming (GFM) virtual synchronous machine mode.",
  },
  M6005: {
    rule: "csmf-unresolved-input",
    severity: "error",
    remediation:
      "Verify CSMF control block signal routing. Connect all input signals to valid upstream sensor, gain, or transfer function outputs.",
  },
  M6006: {
    rule: "line-travel-time-underflow",
    severity: "error",
    remediation:
      "Distributed Bergeron transmission line wave travel time tau is smaller than EMT step dt (dt > tau = length * sqrt(L*C)). Decrease simulation step 'dt' or model short line sections with lumped PI equivalents.",
  },
  M6012: {
    rule: "algebraic-loop-singular-system",
    severity: "error",
    remediation:
      "Singular Jacobian matrix or algebraic constraint loop detected. Check mechanical kinematic joints for redundant constraints or unconstrained degrees of freedom. In electrical systems, verify ground reference paths.",
  },
  M6013: {
    rule: "parallel-ideal-sources",
    severity: "error",
    remediation:
      "Multiple ideal voltage sources are connected in parallel without intermediate series impedance, creating an ill-conditioned loop. Introduce non-zero source internal impedance or series reactors.",
  },
  M6014: {
    rule: "unspecified-source-impedance",
    severity: "warning",
    remediation:
      "Ideal source has zero impedance. Specify realistic internal resistance and inductance to stabilize companion-circuit matrix formulation.",
  },
  M6015: {
    rule: "wheel-rail-derailment-risk",
    severity: "error",
    remediation:
      "Derailment quotient (Y/Q) or Prud'homme lateral track shift force exceeded EN 14363 safety limits. Reduce curve negotiation speed, adjust wheel-rail profile contact geometry, or soften primary suspension lateral/yaw stiffness.",
  },
  M6016: {
    rule: "harmonic-distortion-violation",
    severity: "error",
    remediation:
      "Voltage/current total harmonic distortion exceeds IEEE 2800 limits (THD > 5.0% or single harmonic > 3.0%). Increase LCL output filter capacitance/inductance or retune converter active damping loops.",
  },
  M6017: {
    rule: "execution-deadline-timeout",
    severity: "error",
    remediation:
      "Simulation exceeded the 15.0 s execution deadline. Potential causes: stiff eigenvalues, excessively small time step (dt), or slow iteration convergence. Increase step size 'dt' (e.g., 50µs), reduce 'tstop', or select an implicit stiff ODE solver (e.g., BDF/Radau).",
  },
  M7001: {
    rule: "negative-metacentric-height",
    severity: "error",
    remediation:
      "Floater hydrostatic instability detected: transverse or longitudinal metacentric height GM is negative. Lower vessel center of gravity KG, increase waterplane area / beam width, or ballast lower tanks.",
  },
  M7002: {
    rule: "line-length-underflow",
    severity: "error",
    remediation:
      "Mooring line or riser unstretched length is shorter than water depth at fairlead position. Increase total line length to allow adequate catenary scope.",
  },
  M7003: {
    rule: "acoustic-courant-violation",
    severity: "error",
    remediation:
      "Numerical stability violation: time step dt exceeds the acoustic or advective Courant-Friedrichs-Lewy (CFL) limit (dt > dx / c). Decrease integration time step 'dt' or coarsen spatial cell length 'dx' to maintain CFL <= 1.0.",
  },
  M7004: {
    rule: "unconnected-attachment-node",
    severity: "error",
    remediation:
      "Mooring or slender line references a non-existent attachment node. Verify floater body node and anchor coordinates.",
  },
  M7006: {
    rule: "invalid-stiffness-hierarchy",
    severity: "error",
    remediation:
      "Slender structural cross-section has non-positive axial (EA <= 0) or bending (EI <= 0) stiffness. Ensure Young's modulus and cross-sectional inertia are strictly positive.",
  },
  M7008: {
    rule: "missing-hydrostatic-matrix",
    severity: "error",
    remediation:
      "Floating body is missing waterplane area or hydrostatic restoring matrix C. Specify buoyancy volume and waterline geometry.",
  },
  M7013: {
    rule: "mass-matrix-asymmetric",
    severity: "error",
    remediation:
      "Structural mass or 6-DOF inertia matrix is not positive-definite or symmetric. Verify mass values are positive and off-diagonal cross products of inertia satisfy symmetry (Ixy = Iyx).",
  },
  M7014: {
    rule: "memory-arena-exceeded",
    severity: "error",
    remediation:
      "Memory consumption exceeded the 512 MB sandbox arena cap. Reduce spatial discretization grid count, decimate output time-series logging interval, or reduce simulation duration.",
  },
  M6000: {
    rule: "execution-error",
    severity: "error",
    remediation:
      "Inspect model syntax, initial conditions, and solver parameters. Ensure all states have well-defined start values and boundary conditions.",
  },
};

/**
 * Base error class for all ModelScript MCP sandbox violations.
 */
export class McpSandboxError extends Error {
  public readonly diagnostic: McpStructuredDiagnostic;

  constructor(diagnostic: McpStructuredDiagnostic) {
    super(`[${diagnostic.code}] ${diagnostic.message}`);
    this.name = "McpSandboxError";
    this.diagnostic = diagnostic;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a tool execution exceeds the configured wall-clock deadline.
 */
export class McpTimeoutError extends McpSandboxError {
  constructor(toolName: string, timeoutMs: number, elapsedMs?: number) {
    const code: McpDiagnosticCode = "M6017";
    const catalog = SANDBOX_ERROR_CATALOG[code];
    super({
      code,
      rule: catalog.rule,
      severity: catalog.severity,
      message: `Tool '${toolName}' exceeded execution deadline of ${timeoutMs}ms (elapsed: ${elapsedMs ?? timeoutMs}ms).`,
      remediation: catalog.remediation,
      tool: toolName,
      durationMs: elapsedMs ?? timeoutMs,
      details: { timeoutMs, elapsedMs: elapsedMs ?? timeoutMs },
    });
    this.name = "McpTimeoutError";
  }
}

/**
 * Error thrown when memory consumption exceeds the configured sandbox ceiling.
 */
export class McpMemoryLimitError extends McpSandboxError {
  constructor(toolName: string, bytesUsed: number, maxBytes: number, reason?: string) {
    const code: McpDiagnosticCode = "M7014";
    const catalog = SANDBOX_ERROR_CATALOG[code];
    const mbUsed = (bytesUsed / (1024 * 1024)).toFixed(1);
    const mbLimit = (maxBytes / (1024 * 1024)).toFixed(1);
    super({
      code,
      rule: catalog.rule,
      severity: catalog.severity,
      message:
        `Tool '${toolName}' exceeded memory limit: consumed ${mbUsed} MB (ceiling: ${mbLimit} MB). ${reason ?? ""}`.trim(),
      remediation: catalog.remediation,
      tool: toolName,
      details: { bytesUsed, maxBytes, reason },
    });
    this.name = "McpMemoryLimitError";
  }
}

/**
 * Measures current process heap plus WebAssembly ArrayBuffer memory in bytes.
 */
export function getSandboxMemoryBytes(): number {
  if (typeof process !== "undefined" && typeof process.memoryUsage === "function") {
    const mem = process.memoryUsage();
    return mem.heapUsed + (mem.arrayBuffers ?? 0);
  }
  return 0;
}

/**
 * Classifies an arbitrary runtime or simulation error into a structured ModelScript diagnostic.
 *
 * @param error - The error caught during execution.
 * @param toolName - Optional name of the executing MCP tool.
 * @param elapsedMs - Optional elapsed wall-clock duration in milliseconds.
 * @returns Structured diagnostic with error code, rule name, severity, and remediation instructions.
 */
export function classifyDiagnostic(error: unknown, toolName?: string, elapsedMs?: number): McpStructuredDiagnostic {
  if (error instanceof McpSandboxError) {
    return {
      ...error.diagnostic,
      ...(toolName && !error.diagnostic.tool ? { tool: toolName } : {}),
      ...(elapsedMs !== undefined && !error.diagnostic.durationMs ? { durationMs: elapsedMs } : {}),
    };
  }

  const msg = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  const combined = `${msg} ${stack}`.toLowerCase();

  // 1. Timeout detection
  if (
    combined.includes("timed out") ||
    combined.includes("timeout") ||
    combined.includes("deadline") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "TimeoutError")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6017;
    return {
      code: "M6017",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 2. Memory exhaustion
  if (
    combined.includes("out of memory") ||
    combined.includes("heap limit") ||
    combined.includes("allocation failed") ||
    combined.includes("memory-arena-exceeded")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M7014;
    return {
      code: "M7014",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 3. Electrical floating node
  if (
    combined.includes("floating") ||
    (combined.includes("node") && combined.includes("unconnected")) ||
    combined.includes("no closed connections")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6001;
    return {
      code: "M6001",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 4. Transformer winding mismatch
  if (
    combined.includes("transformer") &&
    (combined.includes("mismatch") || combined.includes("winding") || combined.includes("base kv"))
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6002;
    return {
      code: "M6002",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 5. Weak grid / SCR
  if (combined.includes("weak grid") || combined.includes("short-circuit ratio") || combined.includes("scr <")) {
    const cat = SANDBOX_ERROR_CATALOG.M6004;
    return {
      code: "M6004",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 6. Travel time / delay underflow
  if (
    combined.includes("travel time") ||
    (combined.includes("bergeron") && combined.includes("dt >")) ||
    combined.includes("underflow")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6006;
    return {
      code: "M6006",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 7. Parallel ideal sources
  if (
    combined.includes("parallel ideal") ||
    (combined.includes("ideal source") && combined.includes("loop")) ||
    combined.includes("parallel-ideal-sources")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6013;
    return {
      code: "M6013",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 8. Singular matrix / kinematic loop / mobility / algebraic loop
  if (
    combined.includes("singular matrix") ||
    combined.includes("singular jacobian") ||
    combined.includes("algebraic loop") ||
    combined.includes("pivot is zero") ||
    combined.includes("unconstrained dof") ||
    combined.includes("mobility")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6012;
    return {
      code: "M6012",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 9. Wheel-rail derailment / Nadal / Prud'homme
  if (
    combined.includes("derailment") ||
    combined.includes("nadal") ||
    combined.includes("prud'homme") ||
    combined.includes("y/q")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6015;
    return {
      code: "M6015",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 10. Harmonic distortion / IEEE 2800 THD
  if (combined.includes("thd") || combined.includes("harmonic distortion") || combined.includes("ieee 2800")) {
    const cat = SANDBOX_ERROR_CATALOG.M6016;
    return {
      code: "M6016",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 11. Courant / CFL violation
  if (combined.includes("courant") || combined.includes("cfl") || combined.includes("acoustic-courant")) {
    const cat = SANDBOX_ERROR_CATALOG.M7003;
    return {
      code: "M7003",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 12. Hydrostatic instability
  if (combined.includes("metacentric") || combined.includes("negative gm") || combined.includes("hydrostatic")) {
    const cat = SANDBOX_ERROR_CATALOG.M7001;
    return {
      code: "M7001",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 13. Invalid parameter bounds
  if (
    combined.includes("invalid parameter") ||
    combined.includes("must be positive") ||
    combined.includes("non-negative") ||
    combined.includes("parameter-bounds")
  ) {
    const cat = SANDBOX_ERROR_CATALOG.M6003;
    return {
      code: "M6003",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // 14. Mass matrix asymmetry
  if (combined.includes("mass matrix") && (combined.includes("asymmetric") || combined.includes("positive-definite"))) {
    const cat = SANDBOX_ERROR_CATALOG.M7013;
    return {
      code: "M7013",
      rule: cat.rule,
      severity: cat.severity,
      message: msg,
      remediation: cat.remediation,
      tool: toolName,
      durationMs: elapsedMs,
    };
  }

  // Default fallback
  const cat = SANDBOX_ERROR_CATALOG.M6000;
  return {
    code: "M6000",
    rule: cat.rule,
    severity: cat.severity,
    message: msg,
    remediation: cat.remediation,
    tool: toolName,
    durationMs: elapsedMs,
  };
}

/**
 * Formats a structured diagnostic into human-readable text and an inline JSON payload
 * tailored for direct consumption by an LLM agent.
 *
 * @param diag - The structured diagnostic to format.
 * @returns Human-readable and parseable diagnostic string.
 */
export function formatDiagnosticText(diag: McpStructuredDiagnostic): string {
  const lines: string[] = [
    `=== ModelScript Diagnostic [${diag.code}] ===`,
    `Severity: ${diag.severity.toUpperCase()}`,
    `Rule: ${diag.rule}`,
    ...(diag.tool ? [`Tool: ${diag.tool}`] : []),
    ...(diag.durationMs !== undefined ? [`Elapsed Time: ${diag.durationMs.toFixed(1)}ms`] : []),
    `Message: ${diag.message}`,
    "",
    "Actionable Remediation for AI Agent:",
    `  • ${diag.remediation}`,
    "",
    "Diagnostic Payload (JSON):",
    JSON.stringify(
      {
        status: "error",
        code: diag.code,
        rule: diag.rule,
        severity: diag.severity,
        message: diag.message,
        remediation: diag.remediation,
        ...(diag.details ? { details: diag.details } : {}),
      },
      null,
      2,
    ),
  ];
  return lines.join("\n");
}

/**
 * Creates an MCP tool error response containing the formatted diagnostic text.
 *
 * @param diag - The structured diagnostic.
 * @returns Standard MCP tool error response.
 */
export function formatMcpDiagnosticResponse(diag: McpStructuredDiagnostic): McpToolErrorResponse {
  return {
    content: [
      {
        type: "text" as const,
        text: formatDiagnosticText(diag),
      },
    ],
    isError: true,
    diagnostic: diag,
  };
}

/**
 * Executes an asynchronous function inside a deterministic sandbox, enforcing
 * wall-clock deadlines, memory ceilings, and error translation.
 *
 * @param fn - The user function to execute. Receives an `AbortSignal`.
 * @param options - Execution options including tool name and resource limits.
 * @returns The resolved value of `fn`.
 * @throws {@link McpTimeoutError} if execution exceeds the timeout deadline.
 * @throws {@link McpMemoryLimitError} if memory exceeds the configured ceiling.
 * @throws {@link McpSandboxError} on classified runtime failures.
 */
export async function runInSandbox<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options?: {
    toolName?: string | undefined;
    limits?: McpExecutionLimits | undefined;
  },
): Promise<T> {
  const toolName = options?.toolName ?? "anonymous_tool";
  const timeoutMs = options?.limits?.timeoutMs ?? DEFAULT_EXECUTION_LIMITS.timeoutMs;
  const maxMemoryBytes = options?.limits?.maxMemoryBytes;
  const maxDeltaBytes = options?.limits?.maxDeltaBytes ?? DEFAULT_EXECUTION_LIMITS.maxDeltaBytes;

  const controller = new AbortController();
  const startTime = Date.now();

  // Pre-execution memory ceiling verification (if explicitly set)
  const startMemory = getSandboxMemoryBytes();
  if (maxMemoryBytes !== undefined && startMemory > maxMemoryBytes) {
    throw new McpMemoryLimitError(
      toolName,
      startMemory,
      maxMemoryBytes,
      "Pre-flight process memory already exceeds sandbox ceiling",
    );
  }

  let timer: NodeJS.Timeout | undefined;
  let onExternalAbort: (() => void) | undefined;

  const interruptPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const elapsed = Date.now() - startTime;
      reject(new McpTimeoutError(toolName, timeoutMs, elapsed));
    }, timeoutMs);

    // Chain external abort signal if provided
    if (options?.limits?.signal) {
      onExternalAbort = () => {
        controller.abort();
        const elapsed = Date.now() - startTime;
        reject(
          new McpSandboxError({
            code: "M6017",
            rule: "execution-aborted",
            severity: "error",
            message: `Tool '${toolName}' was aborted by cancellation signal.`,
            remediation: "Execution was cancelled by client or supervisor.",
            tool: toolName,
            durationMs: elapsed,
          }),
        );
      };

      if (options.limits.signal.aborted) {
        onExternalAbort();
      } else {
        options.limits.signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
  });

  try {
    const result = await Promise.race([fn(controller.signal), interruptPromise]);

    // Post-execution memory verification
    const endMemory = getSandboxMemoryBytes();
    const memoryGrowth = endMemory - startMemory;

    if (maxDeltaBytes !== undefined && memoryGrowth > maxDeltaBytes) {
      throw new McpMemoryLimitError(
        toolName,
        memoryGrowth,
        maxDeltaBytes,
        "Tool execution exceeded maximum allowed memory growth delta",
      );
    }
    if (maxMemoryBytes !== undefined && endMemory > maxMemoryBytes) {
      throw new McpMemoryLimitError(
        toolName,
        endMemory,
        maxMemoryBytes,
        "Post-execution memory exceeds sandbox ceiling",
      );
    }

    return result;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (onExternalAbort && options?.limits?.signal) {
      options.limits.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * Higher-order function that wraps an MCP tool handler with the deterministic sandbox.
 * Automatically catches timeouts, memory violations, and simulation errors, returning
 * structured diagnostic MCP responses.
 *
 * @param toolName - Canonical name of the tool (e.g., "pscad_simulate").
 * @param handler - The tool implementation function.
 * @param getLimits - Optional hook to extract dynamic limits from invocation arguments or server context.
 * @returns Wrapped handler safe for direct registration with `server.tool(...)`.
 */
export function withSandbox<TArgs extends Record<string, unknown>, TResult>(
  toolName: string,
  handler: (args: TArgs, signal: AbortSignal, extra?: unknown) => Promise<TResult>,
  getLimits?: (args: TArgs) => McpExecutionLimits | undefined,
): (args: TArgs, extra?: unknown) => Promise<TResult | McpToolErrorResponse> {
  return async (args: TArgs, extra?: unknown): Promise<TResult | McpToolErrorResponse> => {
    const startTime = Date.now();
    const contextLimits = getLimits ? getLimits(args) : undefined;
    const dynamicTimeout =
      typeof args["timeoutMs"] === "number"
        ? (args["timeoutMs"] as number)
        : typeof args["timeoutSec"] === "number"
          ? (args["timeoutSec"] as number) * 1000
          : undefined;

    const limits: McpExecutionLimits = {
      ...contextLimits,
      ...(dynamicTimeout ? { timeoutMs: dynamicTimeout } : {}),
    };

    try {
      const res = await runInSandbox(async (signal) => handler(args, signal, extra), {
        toolName,
        limits,
      });

      // If handler returned an error response without structured diagnostic, classify it
      if (res && typeof res === "object") {
        const resRecord = res as {
          isError?: unknown;
          content?: { text?: unknown }[] | unknown;
          diagnostic?: unknown;
        };
        if (
          resRecord.isError &&
          Array.isArray(resRecord.content) &&
          resRecord.content.length > 0 &&
          !resRecord.diagnostic
        ) {
          const firstItem = resRecord.content[0] as { text?: unknown } | undefined;
          const text = String(firstItem?.text ?? "");
          const diag = classifyDiagnostic(new Error(text), toolName, Date.now() - startTime);
          return formatMcpDiagnosticResponse(diag);
        }
      }

      return res;
    } catch (err: unknown) {
      const elapsedMs = Date.now() - startTime;
      const diag = classifyDiagnostic(err, toolName, elapsedMs);
      return formatMcpDiagnosticResponse(diag);
    }
  };
}
