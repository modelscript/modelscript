/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * SUNDIALS Solver Interface for ModelScript.
 *
 * Provides C adapter functions that bridge a ModelScript-generated model
 * instance to the SUNDIALS suite:
 *   - CVODE  (explicit ODE: ẋ = f(t,x))
 *   - IDA    (implicit DAE: F(t,x,ẋ) = 0)
 *   - KINSOL (nonlinear system: R(z) = 0, for initialization)
 *
 * The model instance is expected to follow the struct layout generated
 * by fmu-codegen.ts (states[], derivatives[], vars[], etc.).
 *
 * Reference: Hindmarsh et al. (2005), "SUNDIALS: Suite of Nonlinear
 *   and Differential/Algebraic Equation Solvers", ACM TOMS.
 */

#include <cvode/cvode.h>
#include <ida/ida.h>
#include <kinsol/kinsol.h>
#include <nvector/nvector_serial.h>
#include <sunlinsol/sunlinsol_dense.h>
#include <sunmatrix/sunmatrix_dense.h>
#include <sundials/sundials_types.h>

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── Callback struct ── */

/**
 * Generic callback interface between the model instance and SUNDIALS solvers.
 * Populated by the generated glue code (sundials-codegen.ts).
 */
typedef struct {
    /** Opaque pointer to the model instance ({id}_Instance*). */
    void* model_instance;
    /** Number of continuous state variables. */
    int n_states;
    /** Number of event indicator (zero-crossing) functions. */
    int n_event_indicators;

    /* ── ODE / DAE callbacks ── */

    /**
     * Compute derivatives: model evaluates ẋ = f(t, x).
     * Reads from inst->states, inst->time; writes to inst->derivatives.
     */
    void (*get_derivatives)(void* inst);

    /**
     * Compute event indicators g_i(t, x).
     * @param inst        Model instance
     * @param indicators  Output array of length n_event_indicators
     */
    void (*get_event_indicators)(void* inst, double* indicators);

    /**
     * Compute DAE residual: F(t, x, ẋ) = 0.
     * For implicit DAE systems (IDA). Reads from inst->states,
     * inst->derivatives, inst->time; writes residual to output.
     * @param inst     Model instance
     * @param residual Output array of length n_states
     */
    void (*get_residual)(void* inst, double* residual);

    /**
     * Compute dense Jacobian ∂f/∂x (for CVODE) or ∂F/∂x (for IDA).
     * Uses the model's AD-generated exact Jacobian.
     * @param inst  Model instance
     * @param J     Output dense Jacobian matrix (column-major, n_states × n_states)
     */
    void (*get_jacobian)(void* inst, double* J);

    /* ── Initialization callbacks ── */

    /**
     * Compute nonlinear residual R(z) = 0 for initialization (KINSOL).
     * @param inst     Model instance
     * @param residual Output array of length n_states
     */
    void (*get_init_residual)(void* inst, double* residual);

    /**
     * Compute Jacobian of the initialization residual ∂R/∂z (KINSOL).
     * @param inst  Model instance
     * @param J     Output dense Jacobian (column-major, n_states × n_states)
     */
    void (*get_init_jacobian)(void* inst, double* J);

    /* ── Direct state access ── */

    /** Pointer to the model's state vector (inst->states). */
    double* states;
    /** Pointer to the model's derivative vector (inst->derivatives). */
    double* derivatives;
    /** Pointer to the model's time variable (inst->time). */
    double* time_ptr;
} SundialsModelCallbacks;

/* ── Solver options ── */

typedef struct {
    /** Absolute tolerance (default: 1e-8). */
    double atol;
    /** Relative tolerance (default: 1e-6). */
    double rtol;
    /** Maximum number of internal steps (default: 50000). */
    long max_steps;
    /** Maximum step size (0 = unlimited). */
    double max_step;
    /** Initial step size (0 = auto). */
    double initial_step;
    /** Use exact Jacobian if available (1) or internal DQ approximation (0). */
    int use_exact_jacobian;
} SundialsOptions;

/** Initialize options with sensible defaults. */
static void sundials_options_defaults(SundialsOptions* opts) {
    opts->atol = 1.0e-8;
    opts->rtol = 1.0e-6;
    opts->max_steps = 50000;
    opts->max_step = 0.0;
    opts->initial_step = 0.0;
    opts->use_exact_jacobian = 1;
}

/* ── Result struct ── */

typedef struct {
    /** Number of output time points. */
    int n_points;
    /** Output time array (caller-owned, length n_points). */
    double* times;
    /** Output state matrix (row-major: n_points × n_states). */
    double* states;
    /** Number of function evaluations. */
    long n_feval;
    /** Number of Jacobian evaluations. */
    long n_jeval;
    /** Number of steps taken. */
    long n_steps;
    /** Return code (0 = success, <0 = error). */
    int status;
    /** Error message (empty string on success). */
    char message[256];
} SundialsResult;

/* ═══════════════════════════════════════════════════════════════════════════
 * CVODE — Explicit ODE Solver
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * CVODE right-hand side callback: f(t, y, ydot, user_data).
 * Copies y → model states, sets time, calls getDerivatives,
 * copies model derivatives → ydot.
 */
static int cvode_rhs(realtype t, N_Vector y, N_Vector ydot, void* user_data) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* y_data = N_VGetArrayPointer(y);
    realtype* yd_data = N_VGetArrayPointer(ydot);

    /* Push state into model instance */
    *cb->time_ptr = (double)t;
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)y_data[i];
    }

    /* Evaluate model */
    cb->get_derivatives(cb->model_instance);

    /* Pull derivatives out */
    for (int i = 0; i < n; i++) {
        yd_data[i] = (realtype)cb->derivatives[i];
    }

    return 0;
}

/**
 * CVODE dense Jacobian callback: J = ∂f/∂y.
 * Uses the model's AD-generated exact Jacobian if available.
 */
static int cvode_jac(realtype t, N_Vector y, N_Vector fy,
                     SUNMatrix J, void* user_data,
                     N_Vector tmp1, N_Vector tmp2, N_Vector tmp3) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* y_data = N_VGetArrayPointer(y);

    (void)fy; (void)tmp1; (void)tmp2; (void)tmp3;

    /* Sync state */
    *cb->time_ptr = (double)t;
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)y_data[i];
    }

    /* Fill Jacobian */
    double* J_dense = (double*)malloc(n * n * sizeof(double));
    if (!J_dense) return -1;

    cb->get_jacobian(cb->model_instance, J_dense);

    /* Copy to SUNDIALS dense matrix (column-major) */
    for (int j = 0; j < n; j++) {
        for (int i = 0; i < n; i++) {
            SM_ELEMENT_D(J, i, j) = (realtype)J_dense[i * n + j];
        }
    }

    free(J_dense);
    return 0;
}

/**
 * CVODE root-finding callback for event detection.
 * Evaluates the model's event indicator functions.
 */
static int cvode_root(realtype t, N_Vector y, realtype* gout, void* user_data) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* y_data = N_VGetArrayPointer(y);

    /* Sync state */
    *cb->time_ptr = (double)t;
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)y_data[i];
    }

    /* Evaluate event indicators */
    double* indicators = (double*)malloc(cb->n_event_indicators * sizeof(double));
    if (!indicators) return -1;

    cb->get_event_indicators(cb->model_instance, indicators);

    for (int i = 0; i < cb->n_event_indicators; i++) {
        gout[i] = (realtype)indicators[i];
    }

    free(indicators);
    return 0;
}

/**
 * Run a CVODE simulation for an explicit ODE system.
 *
 * @param cb           Model callbacks (populated by generated code)
 * @param t0           Start time
 * @param y0           Initial state vector (length n_states)
 * @param output_times Sorted array of desired output times
 * @param n_outputs    Number of output times
 * @param opts         Solver options
 * @param result       Output result struct (caller-allocated)
 */
void sundials_cvode_run(
    SundialsModelCallbacks* cb,
    double t0,
    const double* y0,
    const double* output_times,
    int n_outputs,
    const SundialsOptions* opts,
    SundialsResult* result
) {
    int n = cb->n_states;
    SUNContext sunctx = NULL;
    void* cvode_mem = NULL;
    N_Vector y = NULL;
    SUNMatrix A = NULL;
    SUNLinearSolver LS = NULL;

    memset(result, 0, sizeof(SundialsResult));
    result->n_points = n_outputs;
    result->times = (double*)malloc(n_outputs * sizeof(double));
    result->states = (double*)malloc(n_outputs * n * sizeof(double));
    if (!result->times || !result->states) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        return;
    }

    /* Create SUNDIALS context */
    if (SUNContext_Create(SUN_COMM_NULL, &sunctx) != 0) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Failed to create SUNDIALS context");
        return;
    }

    /* Create state vector */
    y = N_VNew_Serial(n, sunctx);
    if (!y) goto cleanup_error;

    realtype* y_data = N_VGetArrayPointer(y);
    for (int i = 0; i < n; i++) {
        y_data[i] = (realtype)y0[i];
    }

    /* Create CVODE solver (BDF method for stiff systems) */
    cvode_mem = CVodeCreate(CV_BDF, sunctx);
    if (!cvode_mem) goto cleanup_error;

    if (CVodeInit(cvode_mem, cvode_rhs, (realtype)t0, y) != CV_SUCCESS)
        goto cleanup_error;

    if (CVodeSStolerances(cvode_mem, (realtype)opts->rtol, (realtype)opts->atol) != CV_SUCCESS)
        goto cleanup_error;

    CVodeSetUserData(cvode_mem, cb);
    CVodeSetMaxNumSteps(cvode_mem, opts->max_steps);

    if (opts->max_step > 0.0)
        CVodeSetMaxStep(cvode_mem, (realtype)opts->max_step);

    if (opts->initial_step > 0.0)
        CVodeSetInitStep(cvode_mem, (realtype)opts->initial_step);

    /* Dense linear solver */
    A = SUNDenseMatrix(n, n, sunctx);
    if (!A) goto cleanup_error;

    LS = SUNLinSol_Dense(y, A, sunctx);
    if (!LS) goto cleanup_error;

    if (CVodeSetLinearSolver(cvode_mem, LS, A) != CV_SUCCESS)
        goto cleanup_error;

    /* Exact Jacobian (AD-generated) */
    if (opts->use_exact_jacobian && cb->get_jacobian) {
        CVodeSetJacFn(cvode_mem, cvode_jac);
    }

    /* Event detection (root-finding) */
    if (cb->n_event_indicators > 0 && cb->get_event_indicators) {
        CVodeRootInit(cvode_mem, cb->n_event_indicators, cvode_root);
    }

    /* ── Integration loop ── */
    for (int k = 0; k < n_outputs; k++) {
        realtype t_out = (realtype)output_times[k];
        realtype t_ret;

        int flag = CVode(cvode_mem, t_out, y, &t_ret, CV_NORMAL);

        if (flag == CV_ROOT_RETURN) {
            /* Event detected — record state at event time, then continue */
            result->times[k] = (double)t_ret;
            for (int i = 0; i < n; i++) {
                result->states[k * n + i] = (double)y_data[i];
            }
            /* Re-initialize after event (state may be modified by caller) */
            CVodeReInit(cvode_mem, t_ret, y);
            k--; /* Retry this output time */
            continue;
        }

        if (flag < 0) {
            result->status = flag;
            snprintf(result->message, sizeof(result->message),
                     "CVODE error at t=%.6e (flag=%d)", (double)t_out, flag);
            result->n_points = k;
            break;
        }

        result->times[k] = (double)t_ret;
        for (int i = 0; i < n; i++) {
            result->states[k * n + i] = (double)y_data[i];
        }
    }

    /* Gather statistics */
    CVodeGetNumRhsEvals(cvode_mem, &result->n_feval);
    CVodeGetNumLinSolvSetups(cvode_mem, &result->n_jeval);
    CVodeGetNumSteps(cvode_mem, &result->n_steps);

    goto cleanup;

cleanup_error:
    result->status = -1;
    if (result->message[0] == '\0')
        snprintf(result->message, sizeof(result->message), "CVODE setup failed");

cleanup:
    if (LS) SUNLinSolFree(LS);
    if (A) SUNMatDestroy(A);
    if (y) N_VDestroy(y);
    if (cvode_mem) CVodeFree(&cvode_mem);
    if (sunctx) SUNContext_Free(&sunctx);
}


/* ═══════════════════════════════════════════════════════════════════════════
 * IDA — Implicit DAE Solver
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * IDA residual callback: F(t, y, ẏ) = 0.
 */
static int ida_residual(realtype t, N_Vector y, N_Vector yp,
                        N_Vector resval, void* user_data) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* y_data = N_VGetArrayPointer(y);
    realtype* yp_data = N_VGetArrayPointer(yp);
    realtype* r_data = N_VGetArrayPointer(resval);

    /* Sync state */
    *cb->time_ptr = (double)t;
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)y_data[i];
        cb->derivatives[i] = (double)yp_data[i];
    }

    /* Evaluate residual */
    double* residual = (double*)malloc(n * sizeof(double));
    if (!residual) return -1;

    cb->get_residual(cb->model_instance, residual);

    for (int i = 0; i < n; i++) {
        r_data[i] = (realtype)residual[i];
    }

    free(residual);
    return 0;
}

/**
 * IDA root-finding callback for event detection.
 */
static int ida_root(realtype t, N_Vector y, N_Vector yp,
                    realtype* gout, void* user_data) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* y_data = N_VGetArrayPointer(y);

    (void)yp;

    /* Sync state */
    *cb->time_ptr = (double)t;
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)y_data[i];
    }

    /* Evaluate event indicators */
    double* indicators = (double*)malloc(cb->n_event_indicators * sizeof(double));
    if (!indicators) return -1;

    cb->get_event_indicators(cb->model_instance, indicators);

    for (int i = 0; i < cb->n_event_indicators; i++) {
        gout[i] = (realtype)indicators[i];
    }

    free(indicators);
    return 0;
}

/**
 * Run an IDA simulation for an implicit DAE system.
 *
 * @param cb           Model callbacks
 * @param t0           Start time
 * @param y0           Initial state vector (length n_states)
 * @param yp0          Initial derivative vector (length n_states)
 * @param output_times Sorted array of desired output times
 * @param n_outputs    Number of output times
 * @param opts         Solver options
 * @param result       Output result struct
 */
void sundials_ida_run(
    SundialsModelCallbacks* cb,
    double t0,
    const double* y0,
    const double* yp0,
    const double* output_times,
    int n_outputs,
    const SundialsOptions* opts,
    SundialsResult* result
) {
    int n = cb->n_states;
    SUNContext sunctx = NULL;
    void* ida_mem = NULL;
    N_Vector y = NULL;
    N_Vector yp = NULL;
    SUNMatrix A = NULL;
    SUNLinearSolver LS = NULL;

    memset(result, 0, sizeof(SundialsResult));
    result->n_points = n_outputs;
    result->times = (double*)malloc(n_outputs * sizeof(double));
    result->states = (double*)malloc(n_outputs * n * sizeof(double));
    if (!result->times || !result->states) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        return;
    }

    /* Create SUNDIALS context */
    if (SUNContext_Create(SUN_COMM_NULL, &sunctx) != 0) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Failed to create SUNDIALS context");
        return;
    }

    /* Create state and derivative vectors */
    y = N_VNew_Serial(n, sunctx);
    yp = N_VNew_Serial(n, sunctx);
    if (!y || !yp) goto cleanup_error;

    realtype* y_data = N_VGetArrayPointer(y);
    realtype* yp_data = N_VGetArrayPointer(yp);
    for (int i = 0; i < n; i++) {
        y_data[i] = (realtype)y0[i];
        yp_data[i] = (realtype)yp0[i];
    }

    /* Create IDA solver */
    ida_mem = IDACreate(sunctx);
    if (!ida_mem) goto cleanup_error;

    if (IDAInit(ida_mem, ida_residual, (realtype)t0, y, yp) != IDA_SUCCESS)
        goto cleanup_error;

    if (IDASStolerances(ida_mem, (realtype)opts->rtol, (realtype)opts->atol) != IDA_SUCCESS)
        goto cleanup_error;

    IDASetUserData(ida_mem, cb);
    IDASetMaxNumSteps(ida_mem, opts->max_steps);

    if (opts->max_step > 0.0)
        IDASetMaxStep(ida_mem, (realtype)opts->max_step);

    if (opts->initial_step > 0.0)
        IDASetInitStep(ida_mem, (realtype)opts->initial_step);

    /* Dense linear solver */
    A = SUNDenseMatrix(n, n, sunctx);
    if (!A) goto cleanup_error;

    LS = SUNLinSol_Dense(y, A, sunctx);
    if (!LS) goto cleanup_error;

    if (IDASetLinearSolver(ida_mem, LS, A) != IDA_SUCCESS)
        goto cleanup_error;

    /* Compute consistent initial conditions */
    if (IDACalcIC(ida_mem, IDA_YA_YDP_INIT, (realtype)output_times[0]) != IDA_SUCCESS) {
        /* IC calculation failed — proceed with user-supplied ICs */
        fprintf(stderr, "IDA: consistent IC calculation failed, using supplied ICs\n");
    }

    /* Event detection */
    if (cb->n_event_indicators > 0 && cb->get_event_indicators) {
        IDARootInit(ida_mem, cb->n_event_indicators, ida_root);
    }

    /* ── Integration loop ── */
    for (int k = 0; k < n_outputs; k++) {
        realtype t_out = (realtype)output_times[k];
        realtype t_ret;

        int flag = IDASolve(ida_mem, t_out, &t_ret, y, yp, IDA_NORMAL);

        if (flag == IDA_ROOT_RETURN) {
            result->times[k] = (double)t_ret;
            for (int i = 0; i < n; i++) {
                result->states[k * n + i] = (double)y_data[i];
            }
            IDAReInit(ida_mem, t_ret, y, yp);
            k--;
            continue;
        }

        if (flag < 0) {
            result->status = flag;
            snprintf(result->message, sizeof(result->message),
                     "IDA error at t=%.6e (flag=%d)", (double)t_out, flag);
            result->n_points = k;
            break;
        }

        result->times[k] = (double)t_ret;
        for (int i = 0; i < n; i++) {
            result->states[k * n + i] = (double)y_data[i];
        }
    }

    /* Gather statistics */
    IDAGetNumResEvals(ida_mem, &result->n_feval);
    IDAGetNumLinSolvSetups(ida_mem, &result->n_jeval);
    IDAGetNumSteps(ida_mem, &result->n_steps);

    goto cleanup;

cleanup_error:
    result->status = -1;
    if (result->message[0] == '\0')
        snprintf(result->message, sizeof(result->message), "IDA setup failed");

cleanup:
    if (LS) SUNLinSolFree(LS);
    if (A) SUNMatDestroy(A);
    if (yp) N_VDestroy(yp);
    if (y) N_VDestroy(y);
    if (ida_mem) IDAFree(&ida_mem);
    if (sunctx) SUNContext_Free(&sunctx);
}


/* ═══════════════════════════════════════════════════════════════════════════
 * KINSOL — Nonlinear Solver for Initialization
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * KINSOL system function callback: F(z) = 0.
 */
static int kinsol_sysfn(N_Vector z, N_Vector fval, void* user_data) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* z_data = N_VGetArrayPointer(z);
    realtype* f_data = N_VGetArrayPointer(fval);

    /* Push z into model states */
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)z_data[i];
    }

    /* Evaluate residual */
    double* residual = (double*)malloc(n * sizeof(double));
    if (!residual) return -1;

    cb->get_init_residual(cb->model_instance, residual);

    for (int i = 0; i < n; i++) {
        f_data[i] = (realtype)residual[i];
    }

    free(residual);
    return 0;
}

/**
 * KINSOL dense Jacobian callback.
 */
static int kinsol_jac(N_Vector z, N_Vector fval,
                      SUNMatrix J, void* user_data,
                      N_Vector tmp1, N_Vector tmp2) {
    SundialsModelCallbacks* cb = (SundialsModelCallbacks*)user_data;
    int n = cb->n_states;
    realtype* z_data = N_VGetArrayPointer(z);

    (void)fval; (void)tmp1; (void)tmp2;

    /* Sync state */
    for (int i = 0; i < n; i++) {
        cb->states[i] = (double)z_data[i];
    }

    /* Evaluate Jacobian */
    double* J_dense = (double*)malloc(n * n * sizeof(double));
    if (!J_dense) return -1;

    cb->get_init_jacobian(cb->model_instance, J_dense);

    /* Copy to SUNDIALS dense matrix (column-major) */
    for (int j = 0; j < n; j++) {
        for (int i = 0; i < n; i++) {
            SM_ELEMENT_D(J, i, j) = (realtype)J_dense[i * n + j];
        }
    }

    free(J_dense);
    return 0;
}

/**
 * Solve the nonlinear initialization system R(z) = 0 using KINSOL.
 *
 * @param cb       Model callbacks
 * @param z0       Initial guess (length n_states), overwritten with solution
 * @param n        System dimension
 * @param opts     Solver options
 * @return         0 on success, <0 on failure
 */
int sundials_kinsol_solve(
    SundialsModelCallbacks* cb,
    double* z0,
    int n,
    const SundialsOptions* opts
) {
    SUNContext sunctx = NULL;
    void* kin_mem = NULL;
    N_Vector z = NULL;
    N_Vector scale = NULL;
    SUNMatrix A = NULL;
    SUNLinearSolver LS = NULL;
    int ret = -1;

    if (SUNContext_Create(SUN_COMM_NULL, &sunctx) != 0) return -1;

    z = N_VNew_Serial(n, sunctx);
    scale = N_VNew_Serial(n, sunctx);
    if (!z || !scale) goto cleanup;

    realtype* z_data = N_VGetArrayPointer(z);
    for (int i = 0; i < n; i++) {
        z_data[i] = (realtype)z0[i];
    }
    N_VConst(1.0, scale);

    /* Create KINSOL solver (Newton method) */
    kin_mem = KINCreate(sunctx);
    if (!kin_mem) goto cleanup;

    if (KINInit(kin_mem, kinsol_sysfn, z) != KIN_SUCCESS) goto cleanup;

    KINSetUserData(kin_mem, cb);
    KINSetFuncNormTol(kin_mem, (realtype)opts->atol);
    KINSetScaledStepTol(kin_mem, (realtype)opts->rtol);
    KINSetMaxSetupCalls(kin_mem, 1); /* Recompute Jacobian every iteration */
    KINSetNumMaxIters(kin_mem, (int)opts->max_steps);

    /* Dense linear solver */
    A = SUNDenseMatrix(n, n, sunctx);
    if (!A) goto cleanup;

    LS = SUNLinSol_Dense(z, A, sunctx);
    if (!LS) goto cleanup;

    if (KINSetLinearSolver(kin_mem, LS, A) != KIN_SUCCESS) goto cleanup;

    /* Exact Jacobian */
    if (opts->use_exact_jacobian && cb->get_init_jacobian) {
        KINSetJacFn(kin_mem, kinsol_jac);
    }

    /* Solve */
    int flag = KINSol(kin_mem, z, KIN_NEWTON, scale, scale);

    if (flag >= 0) {
        /* Success — copy solution back */
        for (int i = 0; i < n; i++) {
            z0[i] = (double)z_data[i];
        }
        ret = 0;
    }

cleanup:
    if (LS) SUNLinSolFree(LS);
    if (A) SUNMatDestroy(A);
    if (scale) N_VDestroy(scale);
    if (z) N_VDestroy(z);
    if (kin_mem) KINFree(&kin_mem);
    if (sunctx) SUNContext_Free(&sunctx);
    return ret;
}


/* ═══════════════════════════════════════════════════════════════════════════
 * Utility: Free result memory
 * ═══════════════════════════════════════════════════════════════════════════ */

void sundials_result_free(SundialsResult* result) {
    if (result) {
        free(result->times);
        free(result->states);
        result->times = NULL;
        result->states = NULL;
    }
}
