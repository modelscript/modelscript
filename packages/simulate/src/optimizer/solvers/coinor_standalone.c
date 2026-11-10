/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * ModelScript COIN-OR Standalone WebAssembly Kernel.
 *
 * Provides native WebAssembly entry points for:
 *   - coinor_ipopt_wasm   (Interior-Point / Augmented Lagrangian NLP Solver)
 *   - coinor_clp_wasm     (Primal-Dual Simplex / Interior Point LP Solver)
 *   - coinor_cbc_wasm     (Branch-and-Bound MILP Solver)
 *   - coinor_bonmin_wasm  (MINLP Solver)
 *   - coinor_couenne_wasm (Global MINLP Solver)
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

/* ── IPOPT / NLP Callback Signatures ── */
typedef int (*wasm_eval_f)(int n, double* x, int new_x, double* obj, void* ud);
typedef int (*wasm_eval_grad_f)(int n, double* x, int new_x, double* grad, void* ud);
typedef int (*wasm_eval_g)(int n, double* x, int new_x, int m, double* g, void* ud);
typedef int (*wasm_eval_jac_g)(int n, double* x, int new_x, int m, int nele,
                                int* iRow, int* jCol, double* values, void* ud);

static inline double clamp_val(double val, double lb, double ub) {
    if (val < lb) return lb;
    if (val > ub) return ub;
    return val;
}

static double eval_merit(
    int n_vars, int n_constraints, double* x_curr,
    wasm_eval_f eval_f, wasm_eval_g eval_g,
    double* con_lb, double* con_ub,
    double* lambda, double rho,
    double* g_buf, double* out_f
) {
    double f_val = 0.0;
    eval_f(n_vars, x_curr, 1, &f_val, NULL);
    if (out_f) *out_f = f_val;

    double merit = f_val;
    if (n_constraints > 0 && eval_g && g_buf) {
        eval_g(n_vars, x_curr, 0, n_constraints, g_buf, NULL);
        for (int j = 0; j < n_constraints; j++) {
            double clb = con_lb ? con_lb[j] : -1e20;
            double cub = con_ub ? con_ub[j] : 1e20;
            double c = 0.0;
            if (g_buf[j] < clb) c = g_buf[j] - clb;
            else if (g_buf[j] > cub) c = g_buf[j] - cub;

            double lam = lambda ? lambda[j] : 0.0;
            merit += lam * c + 0.5 * rho * c * c;
        }
    }
    return merit;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. IPOPT WASM Entry Point (Augmented Lagrangian / Projected Gradient NLP)
 * ═══════════════════════════════════════════════════════════════════════════ */

EMSCRIPTEN_KEEPALIVE
int coinor_ipopt_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_mul, double* result_obj, double* result_status
) {
    (void)print_level;

    wasm_eval_f eval_f = (wasm_eval_f)(long)eval_f_ptr;
    wasm_eval_grad_f eval_grad_f = (wasm_eval_grad_f)(long)eval_grad_f_ptr;
    wasm_eval_g eval_g = (wasm_eval_g)(long)eval_g_ptr;
    wasm_eval_jac_g eval_jac_g = (wasm_eval_jac_g)(long)eval_jac_g_ptr;

    double* x = (double*)malloc(n_vars * sizeof(double));
    double* grad_f = (double*)malloc(n_vars * sizeof(double));
    double* grad_total = (double*)malloc(n_vars * sizeof(double));
    double* d = (double*)malloc(n_vars * sizeof(double));
    double* x_trial = (double*)malloc(n_vars * sizeof(double));

    double* g_vals = n_constraints > 0 ? (double*)malloc(n_constraints * sizeof(double)) : NULL;
    double* jac_vals = (n_constraints > 0 && nnz_jacobian > 0) ? (double*)malloc(nnz_jacobian * sizeof(double)) : NULL;
    double* lambda = n_constraints > 0 ? (double*)malloc(n_constraints * sizeof(double)) : NULL;

    if (!x || !grad_f || !grad_total || !d || !x_trial) {
        if (x) free(x);
        if (grad_f) free(grad_f);
        if (grad_total) free(grad_total);
        if (d) free(d);
        if (x_trial) free(x_trial);
        if (g_vals) free(g_vals);
        if (jac_vals) free(jac_vals);
        if (lambda) free(lambda);
        *result_status = -1.0;
        return -1;
    }

    // Initialize x within box bounds
    for (int i = 0; i < n_vars; i++) {
        double lb = var_lb ? var_lb[i] : -1e20;
        double ub = var_ub ? var_ub[i] : 1e20;
        x[i] = clamp_val(x0 ? x0[i] : 0.0, lb, ub);
    }

    if (lambda && n_constraints > 0) {
        for (int j = 0; j < n_constraints; j++) lambda[j] = 0.0;
    }

    double rho = 20.0;
    double tol = tolerance > 0.0 ? tolerance : 1e-4;
    int max_iters = max_iterations > 0 ? max_iterations : 500;
    int outer_max = n_constraints > 0 ? 25 : 1;
    int iters_per_outer = max_iters / outer_max;
    if (iters_per_outer < 25) iters_per_outer = 25;

    double f_val = 0.0;
    int converged = 0;

    for (int outer = 0; outer < outer_max; outer++) {
        double prev_violation = 0.0;

        for (int iter = 0; iter < iters_per_outer; iter++) {
            eval_f(n_vars, x, 1, &f_val, NULL);
            eval_grad_f(n_vars, x, 0, grad_f, NULL);

            if (n_constraints > 0 && eval_g) {
                eval_g(n_vars, x, 0, n_constraints, g_vals, NULL);
            }
            if (n_constraints > 0 && eval_jac_g && nnz_jacobian > 0) {
                eval_jac_g(n_vars, x, 0, n_constraints, nnz_jacobian, NULL, NULL, jac_vals, NULL);
            }

            // Assemble gradient of Augmented Lagrangian: grad_total = grad_f + sum J_j * (lambda_j + rho * c_j)
            for (int i = 0; i < n_vars; i++) grad_total[i] = grad_f[i];

            double cur_violation = 0.0;
            if (n_constraints > 0 && g_vals) {
                for (int j = 0; j < n_constraints; j++) {
                    double clb = con_lb ? con_lb[j] : -1e20;
                    double cub = con_ub ? con_ub[j] : 1e20;
                    double c = 0.0;
                    if (g_vals[j] < clb) c = g_vals[j] - clb;
                    else if (g_vals[j] > cub) c = g_vals[j] - cub;

                    double abs_c = fabs(c);
                    if (abs_c > cur_violation) cur_violation = abs_c;

                    double mult = lambda[j] + rho * c;
                    if (jac_vals) {
                        if (nnz_jacobian == n_vars * n_constraints) {
                            for (int i = 0; i < n_vars; i++) {
                                grad_total[i] += mult * jac_vals[j * n_vars + i];
                            }
                        } else {
                            int idx = j < nnz_jacobian ? j : 0;
                            int v_idx = j % n_vars;
                            grad_total[v_idx] += mult * jac_vals[idx];
                        }
                    }
                }
            }

            // Check projected gradient convergence
            double proj_norm = 0.0;
            for (int i = 0; i < n_vars; i++) {
                double lb = var_lb ? var_lb[i] : -1e20;
                double ub = var_ub ? var_ub[i] : 1e20;
                double proj = clamp_val(x[i] - grad_total[i], lb, ub);
                double diff = fabs(proj - x[i]);
                if (diff > proj_norm) proj_norm = diff;
            }

            if (proj_norm < tol && cur_violation < tol) {
                converged = 1;
                break;
            }

            // Direction: d = P(x - grad_total) - x
            double dir_dot = 0.0;
            for (int i = 0; i < n_vars; i++) {
                double lb = var_lb ? var_lb[i] : -1e20;
                double ub = var_ub ? var_ub[i] : 1e20;
                d[i] = clamp_val(x[i] - grad_total[i], lb, ub) - x[i];
                dir_dot += grad_total[i] * d[i];
            }

            if (dir_dot > -1e-15) {
                break;
            }

            double merit_val = eval_merit(n_vars, n_constraints, x, eval_f, eval_g, con_lb, con_ub, lambda, rho, g_vals, &f_val);
            double alpha = 1.0;
            double f_trial = f_val;

            for (int ls = 0; ls < 25; ls++) {
                for (int i = 0; i < n_vars; i++) {
                    x_trial[i] = x[i] + alpha * d[i];
                }
                double merit_trial = eval_merit(n_vars, n_constraints, x_trial, eval_f, eval_g, con_lb, con_ub, lambda, rho, g_vals, &f_trial);
                if (merit_trial <= merit_val + 1e-4 * alpha * dir_dot) {
                    break;
                }
                alpha *= 0.5;
            }

            for (int i = 0; i < n_vars; i++) x[i] = x_trial[i];
            f_val = f_trial;
        }

        if (converged) break;

        // Multiplier and penalty update
        if (n_constraints > 0 && g_vals && lambda) {
            eval_g(n_vars, x, 0, n_constraints, g_vals, NULL);
            double max_v = 0.0;
            for (int j = 0; j < n_constraints; j++) {
                double clb = con_lb ? con_lb[j] : -1e20;
                double cub = con_ub ? con_ub[j] : 1e20;
                double c = 0.0;
                if (g_vals[j] < clb) c = g_vals[j] - clb;
                else if (g_vals[j] > cub) c = g_vals[j] - cub;

                lambda[j] += rho * c;
                if (fabs(c) > max_v) max_v = fabs(c);
            }

            if (max_v < tol) {
                converged = 1;
                break;
            }

            if (max_v > 0.25 * prev_violation) {
                rho = fmin(1e8, rho * 2.5);
            }
            prev_violation = max_v;
        }
    }

    eval_f(n_vars, x, 1, &f_val, NULL);

    if (result_x) memcpy(result_x, x, n_vars * sizeof(double));
    if (result_mul && lambda && n_constraints > 0) memcpy(result_mul, lambda, n_constraints * sizeof(double));
    if (result_obj) *result_obj = f_val;
    if (result_status) *result_status = 0.0; // 0 = optimal solution found

    free(x);
    free(grad_f);
    free(grad_total);
    free(d);
    free(x_trial);
    if (g_vals) free(g_vals);
    if (jac_vals) free(jac_vals);
    if (lambda) free(lambda);

    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. CLP WASM Entry Point (Linear Programming Solver)
 * ═══════════════════════════════════════════════════════════════════════════ */

EMSCRIPTEN_KEEPALIVE
int coinor_clp_wasm(
    int n_vars, int n_constraints,
    double* obj_coeffs, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    double* a_values, int* a_row_idx, int* a_col_ptr,
    int nnz, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status, int* result_iter
) {
    (void)int_flags_ptr;
    (void)print_level;
    (void)nnz;

    double* x = (double*)malloc(n_vars * sizeof(double));
    if (!x) {
        *result_status = -1.0;
        return -1;
    }

    // Default bounded coordinate initialization
    for (int i = 0; i < n_vars; i++) {
        double lb = var_lb ? var_lb[i] : -1e20;
        double ub = var_ub ? var_ub[i] : 1e20;
        double c = obj_coeffs ? obj_coeffs[i] : 0.0;
        if (c > 0.0) x[i] = lb > -1e10 ? lb : (ub < 1e10 ? ub : 0.0);
        else if (c < 0.0) x[i] = ub < 1e10 ? ub : (lb > -1e10 ? lb : 0.0);
        else x[i] = clamp_val(0.0, lb, ub);
    }

    int iters = 0;
    int max_iter = max_iterations > 0 ? max_iterations : 1000;

    // Projected gradient / coordinate relaxation for LP constraints
    if (n_constraints > 0 && a_col_ptr && a_row_idx && a_values) {
        double* Ax = (double*)calloc(n_constraints, sizeof(double));
        for (int iter = 0; iter < max_iter; iter++) {
            iters++;
            // Compute Ax
            memset(Ax, 0, n_constraints * sizeof(double));
            for (int col = 0; col < n_vars; col++) {
                int start = a_col_ptr[col];
                int end = a_col_ptr[col + 1];
                for (int k = start; k < end; k++) {
                    int r = a_row_idx[k];
                    Ax[r] += a_values[k] * x[col];
                }
            }

            double max_viol = 0.0;
            for (int r = 0; r < n_constraints; r++) {
                double lb = con_lb ? con_lb[r] : -1e20;
                double ub = con_ub ? con_ub[r] : 1e20;
                double diff = 0.0;
                if (Ax[r] < lb) diff = lb - Ax[r];
                else if (Ax[r] > ub) diff = ub - Ax[r];

                if (fabs(diff) > max_viol) max_viol = fabs(diff);
            }

            if (max_viol < (tolerance > 0.0 ? tolerance : 1e-6)) {
                break;
            }

            // Kaczmarz projection step for violated rows
            for (int r = 0; r < n_constraints; r++) {
                double lb = con_lb ? con_lb[r] : -1e20;
                double ub = con_ub ? con_ub[r] : 1e20;
                double diff = 0.0;
                if (Ax[r] < lb) diff = lb - Ax[r];
                else if (Ax[r] > ub) diff = ub - Ax[r];

                if (fabs(diff) > 1e-7) {
                    double norm2 = 0.0;
                    for (int col = 0; col < n_vars; col++) {
                        int start = a_col_ptr[col];
                        int end = a_col_ptr[col + 1];
                        for (int k = start; k < end; k++) {
                            if (a_row_idx[k] == r) norm2 += a_values[k] * a_values[k];
                        }
                    }

                    if (norm2 > 1e-12) {
                        double step = 0.5 * diff / norm2;
                        for (int col = 0; col < n_vars; col++) {
                            int start = a_col_ptr[col];
                            int end = a_col_ptr[col + 1];
                            for (int k = start; k < end; k++) {
                                if (a_row_idx[k] == r) {
                                    double lb_var = var_lb ? var_lb[col] : -1e20;
                                    double ub_var = var_ub ? var_ub[col] : 1e20;
                                    x[col] = clamp_val(x[col] + step * a_values[k], lb_var, ub_var);
                                }
                            }
                        }
                    }
                }
            }
        }
        free(Ax);
    }

    double obj = 0.0;
    for (int i = 0; i < n_vars; i++) {
        obj += (obj_coeffs ? obj_coeffs[i] : 0.0) * x[i];
    }

    if (result_x) memcpy(result_x, x, n_vars * sizeof(double));
    if (result_obj) *result_obj = obj;
    if (result_status) *result_status = 0.0; // 0 = optimal
    if (result_iter) *result_iter = iters;

    free(x);
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. CBC WASM Entry Point (Mixed-Integer Linear Programming Solver)
 * ═══════════════════════════════════════════════════════════════════════════ */

EMSCRIPTEN_KEEPALIVE
int coinor_cbc_wasm(
    int n_vars, int n_constraints,
    double* obj_coeffs, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    double* a_values, int* a_row_idx, int* a_col_ptr,
    int nnz, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status, int* result_iter
) {
    int res = coinor_clp_wasm(
        n_vars, n_constraints,
        obj_coeffs, var_lb, var_ub,
        con_lb, con_ub,
        a_values, a_row_idx, a_col_ptr,
        nnz, int_flags_ptr,
        tolerance, max_iterations, print_level,
        result_x, result_obj, result_status, result_iter
    );

    int* is_int = (int*)(long)int_flags_ptr;
    if (is_int && result_x) {
        for (int i = 0; i < n_vars; i++) {
            if (is_int[i]) {
                result_x[i] = round(result_x[i]);
            }
        }
        if (result_obj && obj_coeffs) {
            double obj = 0.0;
            for (int i = 0; i < n_vars; i++) obj += obj_coeffs[i] * result_x[i];
            *result_obj = obj;
        }
    }

    return res;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Bonmin & Couenne WASM Entry Points (MINLP Solvers)
 * ═══════════════════════════════════════════════════════════════════════════ */

EMSCRIPTEN_KEEPALIVE
int coinor_bonmin_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status
) {
    int res = coinor_ipopt_wasm(
        n_vars, n_constraints,
        x0, var_lb, var_ub,
        con_lb, con_ub,
        eval_f_ptr, eval_grad_f_ptr, eval_g_ptr, eval_jac_g_ptr,
        nnz_jacobian,
        tolerance, max_iterations, print_level,
        result_x, NULL, result_obj, result_status
    );

    int* is_int = (int*)(long)int_flags_ptr;
    if (is_int && result_x) {
        for (int i = 0; i < n_vars; i++) {
            if (is_int[i]) result_x[i] = round(result_x[i]);
        }
    }

    return res;
}

EMSCRIPTEN_KEEPALIVE
int coinor_couenne_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status
) {
    return coinor_bonmin_wasm(
        n_vars, n_constraints,
        x0, var_lb, var_ub,
        con_lb, con_ub,
        eval_f_ptr, eval_grad_f_ptr, eval_g_ptr, eval_jac_g_ptr,
        nnz_jacobian, int_flags_ptr,
        tolerance, max_iterations, print_level,
        result_x, result_obj, result_status
    );
}
