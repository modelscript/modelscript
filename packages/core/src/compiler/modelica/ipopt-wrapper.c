#include "IpStdCInterface.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

/* 
 * IPOPT Wrapper for ModelScript
 * Bridges generated exact AD C-functions to the IPOPT NLP Solver
 */

/* Forward-declare generated functions and variables */
extern const int jac_row_idx[];
extern const int jac_col_ptr[];
extern const int hess_row_idx[];
extern const int hess_col_ptr[];

/* Opaque Model Instance Handle */
typedef void* ModelInstanceHandle;

extern void model_evaluate_objective(ModelInstanceHandle inst, double* obj);
extern void model_evaluate_objective_gradient(ModelInstanceHandle inst, double* grad);
extern void model_evaluate_constraints(ModelInstanceHandle inst, double* g);
extern void model_evaluate_jacobian(ModelInstanceHandle inst, double* jac);
extern void model_evaluate_hessian(ModelInstanceHandle inst, double obj_factor, double* lambda, double* hess);
extern void model_update_state(ModelInstanceHandle inst, const Number* x); // Custom helper to push x into instance

/* 
 * The user_data will point to the allocated ModelInstanceHandle.
 * It's assumed the caller allocates and sets up the instance.
 */

Bool eval_f(Index n, Number* x, Bool new_x, Number* obj_value, UserDataPtr user_data) {
    ModelInstanceHandle inst = (ModelInstanceHandle)user_data;
    if (new_x) model_update_state(inst, x);
    model_evaluate_objective(inst, obj_value);
    return TRUE;
}

Bool eval_grad_f(Index n, Number* x, Bool new_x, Number* grad_f, UserDataPtr user_data) {
    ModelInstanceHandle inst = (ModelInstanceHandle)user_data;
    if (new_x) model_update_state(inst, x);
    model_evaluate_objective_gradient(inst, grad_f);
    return TRUE;
}

Bool eval_g(Index n, Number* x, Bool new_x, Index m, Number* g, UserDataPtr user_data) {
    ModelInstanceHandle inst = (ModelInstanceHandle)user_data;
    if (new_x) model_update_state(inst, x);
    model_evaluate_constraints(inst, g);
    return TRUE;
}

Bool eval_jac_g(Index n, Number *x, Bool new_x,
                Index m, Index nele_jac,
                Index *iRow, Index *jCol, Number *values,
                UserDataPtr user_data) {
    
    ModelInstanceHandle inst = (ModelInstanceHandle)user_data;
    if (values == NULL) {
        // Return structure
        int nnz = 0;
        for (int col = 0; col < n; col++) {
            int start = jac_col_ptr[col];
            int end = jac_col_ptr[col + 1];
            for (int i = start; i < end; i++) {
                iRow[nnz] = jac_row_idx[i] + 1; // IPOPT uses 1-based indexing for C if not set otherwise, wait
                // IpStdCInterface doesn't specify 1-based or 0-based unless told. 
                // Let's assume 0-based (C-style) which is standard if index_style=0.
                iRow[nnz] = jac_row_idx[i];
                jCol[nnz] = col;
                nnz++;
            }
        }
    } else {
        // Return values
        if (new_x) model_update_state(inst, x);
        model_evaluate_jacobian(inst, values);
    }
    return TRUE;
}

Bool eval_h(Index n, Number *x, Bool new_x, Number obj_factor,
            Index m, Number *lambda, Bool new_lambda,
            Index nele_hess, Index *iRow, Index *jCol,
            Number *values, UserDataPtr user_data) {
    
    ModelInstanceHandle inst = (ModelInstanceHandle)user_data;
    if (values == NULL) {
        // Return structure
        int nnz = 0;
        for (int col = 0; col < n; col++) {
            int start = hess_col_ptr[col];
            int end = hess_col_ptr[col + 1];
            for (int i = start; i < end; i++) {
                iRow[nnz] = hess_row_idx[i];
                jCol[nnz] = col;
                nnz++;
            }
        }
    } else {
        // Return values
        if (new_x) model_update_state(inst, x);
        model_evaluate_hessian(inst, obj_factor, lambda, values);
    }
    return TRUE;
}
