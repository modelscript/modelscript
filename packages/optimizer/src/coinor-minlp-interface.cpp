/* SPDX-License-Identifier: AGPL-3.0-or-later */

/**
 * COIN-OR MINLP Solver Interface for ModelScript.
 *
 * Provides a C++ bridge between the C-based CoinorModelCallbacks
 * and the C++ TNLP (Ipopt) interfaces used by Bonmin and Couenne.
 */

#include <iostream>
#include <vector>

#ifdef HAVE_BONMIN
#include "BonBonminSetup.hpp"
#include "BonCbc.hpp"
#include "BonTMINLP.hpp"
#endif

#ifdef HAVE_COUENNE
#include "CouenneSetup.hpp"
#include "CouenneProblem.hpp"
#endif

/* Include the C-API callbacks definition */
/* Note: We rely on coinor_wasm_entry.cpp including coinor-interface.c first. */

using namespace Ipopt;

/**
 * A TNLP adapter that wraps the C callbacks for MINLP solvers.
 * 
 * Bonmin and Couenne expect a TMINLP (which extends TNLP).
 */
class ModelScriptTMINLP : public TMINLP {
private:
    CoinorModelCallbacks* cb;
    const double* x0_guess;

public:
    ModelScriptTMINLP(CoinorModelCallbacks* cb_ptr, const double* x0) 
        : cb(cb_ptr), x0_guess(x0) {}

    virtual ~ModelScriptTMINLP() {}

    virtual bool get_nlp_info(Index& n, Index& m, Index& nnz_jac_g,
                              Index& nnz_h_lag, IndexStyleEnum& index_style) {
        n = cb->n_vars;
        m = cb->n_constraints;
        nnz_jac_g = cb->nnz_jacobian;
        nnz_h_lag = cb->nnz_hessian;
        index_style = C_STYLE;
        return true;
    }

    virtual bool get_bounds_info(Index n, Number* x_l, Number* x_u,
                                 Index m, Number* g_l, Number* g_u) {
        for (Index i = 0; i < n; i++) {
            x_l[i] = cb->var_lb[i];
            x_u[i] = cb->var_ub[i];
        }
        for (Index j = 0; j < m; j++) {
            g_l[j] = cb->con_lb[j];
            g_u[j] = cb->con_ub[j];
        }
        return true;
    }

    virtual bool get_starting_point(Index n, bool init_x, Number* x,
                                    bool init_z, Number* z_L, Number* z_U,
                                    Index m, bool init_lambda, Number* lambda) {
        if (init_x) {
            for (Index i = 0; i < n; i++) {
                x[i] = x0_guess[i];
            }
        }
        return true;
    }

    virtual bool eval_f(Index n, const Number* x, bool new_x, Number& obj_value) {
        if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
        cb->eval_objective(cb->model_instance, x, &obj_value);
        return true;
    }

    virtual bool eval_grad_f(Index n, const Number* x, bool new_x, Number* grad_f) {
        if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
        cb->eval_gradient(cb->model_instance, x, grad_f);
        return true;
    }

    virtual bool eval_g(Index n, const Number* x, bool new_x, Index m, Number* g) {
        if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
        cb->eval_constraints(cb->model_instance, x, g);
        return true;
    }

    virtual bool eval_jac_g(Index n, const Number* x, bool new_x,
                            Index m, Index nele_jac, Index* iRow, Index* jCol,
                            Number* values) {
        if (values == NULL) {
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
            if (new_x && cb->update_state) cb->update_state(cb->model_instance, x);
            cb->eval_jacobian(cb->model_instance, x, values);
        }
        return true;
    }

    virtual bool eval_h(Index n, const Number* x, bool new_x,
                        Number obj_factor, Index m, const Number* lambda,
                        bool new_lambda, Index nele_hess,
                        Index* iRow, Index* jCol, Number* values) {
        if (values == NULL) {
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
        return true;
    }

    virtual bool get_variables_types(Index n, VariableType* var_types) {
        if (cb->is_integer) {
            for (Index i = 0; i < n; i++) {
                var_types[i] = cb->is_integer[i] ? INTEGER : CONTINUOUS;
            }
        } else {
            for (Index i = 0; i < n; i++) {
                var_types[i] = CONTINUOUS;
            }
        }
        return true;
    }
};


extern "C" {

#ifdef HAVE_BONMIN
int coinor_bonmin_solve(CoinorModelCallbacks* cb, double* x0, CoinorOptions* opts, CoinorResult* result) {
    memset(result, 0, sizeof(CoinorResult));
    SmartPtr<TMINLP> tminlp = new ModelScriptTMINLP(cb, x0);
    Bonmin::BonminSetup bonmin;
    
    bonmin.options()->SetNumericValue("tol", opts->tolerance);
    bonmin.options()->SetIntegerValue("max_iter", opts->max_iterations);
    bonmin.options()->SetIntegerValue("print_level", opts->print_level);
    bonmin.options()->SetStringValue("hessian_approximation", opts->use_exact_hessian ? "exact" : "limited-memory");

    bonmin.initializeOptionsAndJournalist();
    bonmin.initialize(tminlp);
    
    Bonmin::Bab bb;
    bb(bonmin);

    result->objective_value = bonmin.minlp()->getObjValue();
    const double* sol = bonmin.minlp()->getBestColSolution();
    if (sol) {
        result->solution = (double*)malloc(cb->n_vars * sizeof(double));
        memcpy(result->solution, sol, cb->n_vars * sizeof(double));
        result->status = 0; // Success
    } else {
        result->status = 1; // Error
    }

    return result->status;
}

int coinor_bonmin_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status
) {
    CoinorModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.n_vars = n_vars;
    cb.n_constraints = n_constraints;
    cb.nnz_jacobian = nnz_jacobian;
    cb.nnz_hessian = 0;
    cb.var_lb = var_lb;
    cb.var_ub = var_ub;
    cb.con_lb = con_lb;
    cb.con_ub = con_ub;
    cb.is_integer = int_flags_ptr ? (const int*)(long)int_flags_ptr : NULL;

    cb.eval_objective = (void (*)(void*, const double*, double*))(long)eval_f_ptr;
    cb.eval_gradient = (void (*)(void*, const double*, double*))(long)eval_grad_f_ptr;
    cb.eval_constraints = (void (*)(void*, const double*, double*))(long)eval_g_ptr;
    cb.eval_jacobian = (void (*)(void*, const double*, double*))(long)eval_jac_g_ptr;

    CoinorOptions opts;
    coinor_options_defaults(&opts);
    opts.tolerance = tolerance;
    opts.max_iterations = max_iterations;
    opts.print_level = print_level;
    opts.use_exact_hessian = 0;

    CoinorResult result;
    coinor_bonmin_solve(&cb, x0, &opts, &result);

    if (result.solution) memcpy(result_x, result.solution, n_vars * sizeof(double));
    *result_obj = result.objective_value;
    *result_status = (double)result.status;

    coinor_result_free(&result);
    return result.status;
}
#endif

#ifdef HAVE_COUENNE
int coinor_couenne_solve(CoinorModelCallbacks* cb, double* x0, CoinorOptions* opts, CoinorResult* result) {
    memset(result, 0, sizeof(CoinorResult));
    SmartPtr<TMINLP> tminlp = new ModelScriptTMINLP(cb, x0);
    
    Couenne::CouenneSetup couenne;
    couenne.options()->SetNumericValue("tol", opts->tolerance);
    couenne.options()->SetIntegerValue("max_iter", opts->max_iterations);
    couenne.options()->SetIntegerValue("print_level", opts->print_level);
    couenne.options()->SetStringValue("hessian_approximation", opts->use_exact_hessian ? "exact" : "limited-memory");

    couenne.initializeOptionsAndJournalist();
    couenne.initialize(tminlp);
    
    Couenne::Bab bb;
    bb(couenne);

    result->objective_value = couenne.minlp()->getObjValue();
    const double* sol = couenne.minlp()->getBestColSolution();
    if (sol) {
        result->solution = (double*)malloc(cb->n_vars * sizeof(double));
        memcpy(result->solution, sol, cb->n_vars * sizeof(double));
        result->status = 0; // Success
    } else {
        result->status = 1; // Error
    }

    return result->status;
}

int coinor_couenne_wasm(
    int n_vars, int n_constraints,
    double* x0, double* var_lb, double* var_ub,
    double* con_lb, double* con_ub,
    int eval_f_ptr, int eval_grad_f_ptr, int eval_g_ptr, int eval_jac_g_ptr,
    int nnz_jacobian, int int_flags_ptr,
    double tolerance, int max_iterations, int print_level,
    double* result_x, double* result_obj, double* result_status
) {
    CoinorModelCallbacks cb;
    memset(&cb, 0, sizeof(cb));
    cb.n_vars = n_vars;
    cb.n_constraints = n_constraints;
    cb.nnz_jacobian = nnz_jacobian;
    cb.nnz_hessian = 0;
    cb.var_lb = var_lb;
    cb.var_ub = var_ub;
    cb.con_lb = con_lb;
    cb.con_ub = con_ub;
    cb.is_integer = int_flags_ptr ? (const int*)(long)int_flags_ptr : NULL;

    cb.eval_objective = (void (*)(void*, const double*, double*))(long)eval_f_ptr;
    cb.eval_gradient = (void (*)(void*, const double*, double*))(long)eval_grad_f_ptr;
    cb.eval_constraints = (void (*)(void*, const double*, double*))(long)eval_g_ptr;
    cb.eval_jacobian = (void (*)(void*, const double*, double*))(long)eval_jac_g_ptr;

    CoinorOptions opts;
    coinor_options_defaults(&opts);
    opts.tolerance = tolerance;
    opts.max_iterations = max_iterations;
    opts.print_level = print_level;
    opts.use_exact_hessian = 0;

    CoinorResult result;
    coinor_couenne_solve(&cb, x0, &opts, &result);

    if (result.solution) memcpy(result_x, result.solution, n_vars * sizeof(double));
    *result_obj = result.objective_value;
    *result_status = (double)result.status;

    coinor_result_free(&result);
    return result.status;
}
#endif

} // extern "C"
