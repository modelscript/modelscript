/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * COIN-OR Solver Interface for ModelScript.
 *
 * Provides C adapter functions that bridge ModelScript-generated model
 * callbacks to the COIN-OR solver suite:
 *   - CLP    (Linear Programming)
 *   - CBC    (Mixed-Integer Linear Programming)
 *   - IPOPT  (Interior-Point Nonlinear Programming)
 *
 * Supersedes the standalone ipopt-wrapper.c by providing a unified
 * callback abstraction covering all three COIN-OR solvers.
 *
 * References:
 *   - Wächter, A. & Biegler, L.T. (2006), "On the Implementation of
 *     an Interior-Point Filter Line-Search Algorithm for Large-Scale NLP"
 *   - Forrest, J. & Lougee-Heimer, R. (2005), "CBC User's Guide"
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── Callback struct ── */

/**
 * Generic callback interface for COIN-OR optimization solvers.
 * Populated by the generated glue code (coinor-codegen.ts).
 */
typedef struct {
    /** Opaque pointer to the model instance. */
    void* model_instance;
    /** Number of decision variables. */
    int n_vars;
    /** Number of equality/inequality constraints. */
    int n_constraints;
    /** Number of nonzeros in the constraint Jacobian (sparse CSC). */
    int nnz_jacobian;
    /** Number of nonzeros in the Hessian of the Lagrangian (sparse, lower-triangle). */
    int nnz_hessian;

    /* ── NLP callbacks (IPOPT) ── */

    /**
     * Evaluate objective function f(x).
     * @param inst  Model instance
     * @param x     Variable values (length n_vars)
     * @param obj   Output scalar objective value
     */
    void (*eval_objective)(void* inst, const double* x, double* obj);

    /**
     * Evaluate objective gradient ∇f(x).
     * @param inst  Model instance
     * @param x     Variable values
     * @param grad  Output gradient (length n_vars)
     */
    void (*eval_gradient)(void* inst, const double* x, double* grad);

    /**
     * Evaluate constraint functions g(x).
     * @param inst  Model instance
     * @param x     Variable values
     * @param g     Output constraint values (length n_constraints)
     */
    void (*eval_constraints)(void* inst, const double* x, double* g);

    /**
     * Evaluate constraint Jacobian ∂g/∂x in sparse CSC format.
     * @param inst  Model instance
     * @param x     Variable values
     * @param jac   Output nonzero values (length nnz_jacobian)
     */
    void (*eval_jacobian)(void* inst, const double* x, double* jac);

    /**
     * Evaluate Hessian of the Lagrangian:
     *   H = σ * ∇²f(x) + Σ λ_i * ∇²g_i(x)
     * @param inst       Model instance
     * @param x          Variable values
     * @param obj_factor σ (objective scaling factor)
     * @param lambda     Constraint multipliers (length n_constraints)
     * @param hess       Output nonzero values (length nnz_hessian)
     */
    void (*eval_hessian)(void* inst, const double* x, double obj_factor,
                         const double* lambda, double* hess);

    /**
     * Push new variable values into the model instance.
     * @param inst  Model instance
     * @param x     New variable values (length n_vars)
     */
    void (*update_state)(void* inst, const double* x);

    /* ── Sparsity structure (CSC format) ── */

    /** Row indices for the constraint Jacobian nonzeros. */
    const int* jac_row_idx;
    /** Column pointer array for the constraint Jacobian (length n_vars + 1). */
    const int* jac_col_ptr;
    /** Row indices for the Hessian nonzeros (lower triangle). */
    const int* hess_row_idx;
    /** Column pointer array for the Hessian (length n_vars + 1). */
    const int* hess_col_ptr;

    /* ── LP/MILP data (CLP/CBC) ── */

    /** Objective coefficients (length n_vars). */
    const double* obj_coeffs;
    /** Variable lower bounds (length n_vars). */
    const double* var_lb;
    /** Variable upper bounds (length n_vars). */
    const double* var_ub;
    /** Constraint lower bounds (length n_constraints). */
    const double* con_lb;
    /** Constraint upper bounds (length n_constraints). */
    const double* con_ub;
    /** Constraint matrix values in CSC format (length nnz_jacobian). */
    const double* A_values;
    /** Constraint matrix row indices (length nnz_jacobian). */
    const int* A_row_idx;
    /** Constraint matrix column pointers (length n_vars + 1). */
    const int* A_col_ptr;
    /** Integer variable flags: 1 = integer, 0 = continuous (length n_vars). NULL = all continuous. */
    const int* is_integer;

} CoinorModelCallbacks;

/* ── Solver options ── */

typedef struct {
    /** NLP convergence tolerance (default: 1e-8). */
    double tolerance;
    /** Maximum iterations (default: 3000). */
    int max_iterations;
    /** Print level: 0=silent, 5=verbose (default: 0). */
    int print_level;
    /** Use exact Hessian (1) or limited-memory BFGS (0). Default: 1. */
    int use_exact_hessian;
} CoinorOptions;

/** Initialize options with sensible defaults. */
static void coinor_options_defaults(CoinorOptions* opts) {
    opts->tolerance = 1.0e-8;
    opts->max_iterations = 3000;
    opts->print_level = 0;
    opts->use_exact_hessian = 1;
}

/* ── Result struct ── */

typedef struct {
    /** Optimal variable values (length n_vars). */
    double* solution;
    /** Optimal objective value. */
    double objective_value;
    /** Constraint multipliers (length n_constraints, NLP only). */
    double* multipliers;
    /** Number of iterations. */
    int iterations;
    /** Return code (0 = optimal, 1 = infeasible, 2 = unbounded, <0 = error). */
    int status;
    /** Status message. */
    char message[256];
} CoinorResult;


/* ═══════════════════════════════════════════════════════════════════════════
 * CLP — Linear Programming Solver
 * ═══════════════════════════════════════════════════════════════════════════ */

#ifdef HAVE_CLP
#include "Clp_C_Interface.h"

/**
 * Solve a linear program:
 *   min  c'x
 *   s.t. con_lb ≤ Ax ≤ con_ub
 *        var_lb ≤ x  ≤ var_ub
 *
 * @param cb      Model callbacks (LP data in obj_coeffs, A_*, bounds)
 * @param opts    Solver options
 * @param result  Output result struct (caller-allocated)
 */
void coinor_clp_solve(
    const CoinorModelCallbacks* cb,
    const CoinorOptions* opts,
    CoinorResult* result
) {
    memset(result, 0, sizeof(CoinorResult));
    result->solution = (double*)malloc(cb->n_vars * sizeof(double));
    if (!result->solution) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        return;
    }

    Clp_Simplex* model = Clp_newModel();
    if (!model) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Failed to create CLP model");
        free(result->solution);
        result->solution = NULL;
        return;
    }

    Clp_setLogLevel(model, opts->print_level);

    /* Load problem */
    Clp_loadProblem(
        model,
        cb->n_vars,
        cb->n_constraints,
        cb->A_col_ptr,
        cb->A_row_idx,
        cb->A_values,
        cb->var_lb,
        cb->var_ub,
        cb->obj_coeffs,
        cb->con_lb,
        cb->con_ub
    );

    Clp_setMaximumIterations(model, opts->max_iterations);

    /* Solve */
    Clp_initialSolve(model);

    int clp_status = Clp_status(model);
    result->iterations = Clp_numberIterations(model);

    if (clp_status == 0) {
        /* Optimal */
        result->status = 0;
        result->objective_value = Clp_objectiveValue(model);
        const double* sol = Clp_primalColumnSolution(model);
        for (int i = 0; i < cb->n_vars; i++) {
            result->solution[i] = sol[i];
        }
        snprintf(result->message, sizeof(result->message), "Optimal solution found");
    } else if (clp_status == 1) {
        result->status = 1;
        snprintf(result->message, sizeof(result->message), "Problem is infeasible");
    } else if (clp_status == 2) {
        result->status = 2;
        snprintf(result->message, sizeof(result->message), "Problem is unbounded");
    } else {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "CLP error (status=%d)", clp_status);
    }

    Clp_deleteModel(model);
}
#endif /* HAVE_CLP */


/* ═══════════════════════════════════════════════════════════════════════════
 * CBC — Mixed-Integer Linear Programming Solver
 * ═══════════════════════════════════════════════════════════════════════════ */

#ifdef HAVE_CBC
#include "Cbc_C_Interface.h"

/**
 * Solve a mixed-integer linear program:
 *   min  c'x
 *   s.t. con_lb ≤ Ax ≤ con_ub
 *        var_lb ≤ x  ≤ var_ub
 *        x_i ∈ Z  for integer-flagged variables
 *
 * @param cb      Model callbacks (LP data + is_integer array)
 * @param opts    Solver options
 * @param result  Output result struct
 */
void coinor_cbc_solve(
    const CoinorModelCallbacks* cb,
    const CoinorOptions* opts,
    CoinorResult* result
) {
    memset(result, 0, sizeof(CoinorResult));
    result->solution = (double*)malloc(cb->n_vars * sizeof(double));
    if (!result->solution) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        return;
    }

    Cbc_Model* model = Cbc_newModel();
    if (!model) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Failed to create CBC model");
        free(result->solution);
        result->solution = NULL;
        return;
    }

    /* Load problem as LP first */
    Cbc_loadProblem(
        model,
        cb->n_vars,
        cb->n_constraints,
        cb->A_col_ptr,
        cb->A_row_idx,
        cb->A_values,
        cb->var_lb,
        cb->var_ub,
        cb->obj_coeffs,
        cb->con_lb,
        cb->con_ub
    );

    /* Mark integer variables */
    if (cb->is_integer) {
        for (int i = 0; i < cb->n_vars; i++) {
            if (cb->is_integer[i]) {
                Cbc_setInteger(model, i);
            }
        }
    }

    Cbc_setMaximumNodes(model, opts->max_iterations);
    Cbc_setLogLevel(model, opts->print_level);

    /* Solve */
    Cbc_solve(model);

    int cbc_status = Cbc_isProvenOptimal(model);
    result->iterations = Cbc_getNodeCount(model);

    if (cbc_status) {
        result->status = 0;
        result->objective_value = Cbc_getObjValue(model);
        const double* sol = Cbc_getColSolution(model);
        for (int i = 0; i < cb->n_vars; i++) {
            result->solution[i] = sol[i];
        }
        snprintf(result->message, sizeof(result->message), "Optimal solution found");
    } else if (Cbc_isProvenInfeasible(model)) {
        result->status = 1;
        snprintf(result->message, sizeof(result->message), "Problem is infeasible");
    } else {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "CBC did not find optimal solution");
    }

    Cbc_deleteModel(model);
}
#endif /* HAVE_CBC */


/* ═══════════════════════════════════════════════════════════════════════════
 * IPOPT — Interior-Point NLP Solver
 * ═══════════════════════════════════════════════════════════════════════════ */

#ifdef HAVE_IPOPT
#include "IpStdCInterface.h"

/* Thread-local callback pointer (set before calling IpoptSolve) */
static CoinorModelCallbacks* g_ipopt_cb = NULL;

static Bool ipopt_eval_f(Index n, Number* x, Bool new_x,
                         Number* obj_value, UserDataPtr user_data) {
    CoinorModelCallbacks* cb = (CoinorModelCallbacks*)user_data;
    if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
    cb->eval_objective(cb->model_instance, x, obj_value);
    return TRUE;
}

static Bool ipopt_eval_grad_f(Index n, Number* x, Bool new_x,
                              Number* grad_f, UserDataPtr user_data) {
    CoinorModelCallbacks* cb = (CoinorModelCallbacks*)user_data;
    if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
    cb->eval_gradient(cb->model_instance, x, grad_f);
    return TRUE;
}

static Bool ipopt_eval_g(Index n, Number* x, Bool new_x,
                         Index m, Number* g, UserDataPtr user_data) {
    CoinorModelCallbacks* cb = (CoinorModelCallbacks*)user_data;
    if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
    cb->eval_constraints(cb->model_instance, x, g);
    return TRUE;
}

static Bool ipopt_eval_jac_g(Index n, Number* x, Bool new_x,
                             Index m, Index nele_jac,
                             Index* iRow, Index* jCol, Number* values,
                             UserDataPtr user_data) {
    CoinorModelCallbacks* cb = (CoinorModelCallbacks*)user_data;

    if (values == NULL) {
        /* Return sparsity structure */
        int nnz = 0;
        for (int col = 0; col < n; col++) {
            int start = cb->jac_col_ptr[col];
            int end = cb->jac_col_ptr[col + 1];
            for (int i = start; i < end; i++) {
                iRow[nnz] = cb->jac_row_idx[i];
                jCol[nnz] = col;
                nnz++;
            }
        }
    } else {
        /* Return values */
        if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
        cb->eval_jacobian(cb->model_instance, x, values);
    }
    return TRUE;
}

static Bool ipopt_eval_h(Index n, Number* x, Bool new_x, Number obj_factor,
                         Index m, Number* lambda, Bool new_lambda,
                         Index nele_hess, Index* iRow, Index* jCol,
                         Number* values, UserDataPtr user_data) {
    CoinorModelCallbacks* cb = (CoinorModelCallbacks*)user_data;

    if (values == NULL) {
        /* Return sparsity structure */
        int nnz = 0;
        for (int col = 0; col < n; col++) {
            int start = cb->hess_col_ptr[col];
            int end = cb->hess_col_ptr[col + 1];
            for (int i = start; i < end; i++) {
                iRow[nnz] = cb->hess_row_idx[i];
                jCol[nnz] = col;
                nnz++;
            }
        }
    } else {
        if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
        cb->eval_hessian(cb->model_instance, x, obj_factor, lambda, values);
    }
    return TRUE;
}

/**
 * Solve a nonlinear program using IPOPT:
 *   min  f(x)
 *   s.t. con_lb ≤ g(x) ≤ con_ub
 *        var_lb ≤ x     ≤ var_ub
 *
 * @param cb      Model callbacks (NLP callbacks + sparsity + bounds)
 * @param x0      Initial guess (length n_vars)
 * @param opts    Solver options
 * @param result  Output result struct
 */
void coinor_ipopt_solve(
    CoinorModelCallbacks* cb,
    const double* x0,
    const CoinorOptions* opts,
    CoinorResult* result
) {
    memset(result, 0, sizeof(CoinorResult));
    result->solution = (double*)malloc(cb->n_vars * sizeof(double));
    result->multipliers = (double*)malloc(cb->n_constraints * sizeof(double));
    if (!result->solution || !result->multipliers) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        return;
    }

    /* Copy initial guess */
    for (int i = 0; i < cb->n_vars; i++) {
        result->solution[i] = x0[i];
    }

    g_ipopt_cb = cb;

    /* Create IPOPT problem */
    IpoptProblem nlp = CreateIpoptProblem(
        cb->n_vars,
        (Number*)cb->var_lb,
        (Number*)cb->var_ub,
        cb->n_constraints,
        (Number*)cb->con_lb,
        (Number*)cb->con_ub,
        cb->nnz_jacobian,
        cb->nnz_hessian,
        0, /* C-style indexing */
        ipopt_eval_f,
        ipopt_eval_g,
        ipopt_eval_grad_f,
        ipopt_eval_jac_g,
        opts->use_exact_hessian ? ipopt_eval_h : NULL
    );

    if (!nlp) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Failed to create IPOPT problem");
        return;
    }

    /* Set options */
    AddIpoptNumOption(nlp, "tol", opts->tolerance);
    AddIpoptIntOption(nlp, "max_iter", opts->max_iterations);
    AddIpoptIntOption(nlp, "print_level", opts->print_level);

    if (!opts->use_exact_hessian) {
        AddIpoptStrOption(nlp, "hessian_approximation", "limited-memory");
    }

    /* Solve */
    Number obj;
    Number* g_mult = (Number*)malloc(cb->n_constraints * sizeof(Number));
    Number* g_mul_L = (Number*)malloc(cb->n_vars * sizeof(Number));
    Number* g_mul_U = (Number*)malloc(cb->n_vars * sizeof(Number));

    if (!g_mult || !g_mul_L || !g_mul_U) {
        result->status = -1;
        snprintf(result->message, sizeof(result->message), "Memory allocation failed");
        FreeIpoptProblem(nlp);
        free(g_mult); free(g_mul_L); free(g_mul_U);
        return;
    }

    enum ApplicationReturnStatus status = IpoptSolve(
        nlp,
        result->solution,  /* x (in/out) */
        NULL,              /* g (output, not needed) */
        &obj,              /* obj value */
        g_mult,            /* constraint multipliers */
        g_mul_L,           /* lower bound multipliers */
        g_mul_U,           /* upper bound multipliers */
        cb                 /* user data */
    );

    result->objective_value = (double)obj;

    /* Copy multipliers */
    for (int i = 0; i < cb->n_constraints; i++) {
        result->multipliers[i] = (double)g_mult[i];
    }

    if (status == Solve_Succeeded || status == Solved_To_Acceptable_Level) {
        result->status = 0;
        snprintf(result->message, sizeof(result->message), "Optimal solution found");
    } else if (status == Infeasible_Problem_Detected) {
        result->status = 1;
        snprintf(result->message, sizeof(result->message), "Infeasible problem detected");
    } else {
        result->status = -1;
        snprintf(result->message, sizeof(result->message),
                 "IPOPT terminated with status %d", (int)status);
    }

    free(g_mult);
    free(g_mul_L);
    free(g_mul_U);
    FreeIpoptProblem(nlp);
    g_ipopt_cb = NULL;
}
#endif /* HAVE_IPOPT */


/* ═══════════════════════════════════════════════════════════════════════════
 * Utility: Free result memory
 * ═══════════════════════════════════════════════════════════════════════════ */

void coinor_result_free(CoinorResult* result) {
    if (result) {
        free(result->solution);
        free(result->multipliers);
        result->solution = NULL;
        result->multipliers = NULL;
    }
}
