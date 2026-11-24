// SPDX-License-Identifier: AGPL-3.0-or-later
#include "ms_native_core.h"

#include <stddef.h>

#ifdef MS_ENABLE_SUNDIALS
#include <sundials/sundials_config.h>
#include <cvode/cvode.h>
#include <nvector/nvector_serial.h>
#include <sunmatrix/sunmatrix_dense.h>
#include <sunlinsol/sunlinsol_dense.h>

#if defined(SUNDIALS_VERSION_MAJOR) && SUNDIALS_VERSION_MAJOR >= 7
typedef sunrealtype ms_sun_real_t;
#else
typedef realtype ms_sun_real_t;
#endif

typedef struct ms_linear_ode_ctx {
  int n;
  const double* A;
  const double* b;
} ms_linear_ode_ctx_t;

static int ms_linear_rhs(
    ms_sun_real_t t,
    N_Vector y_vec,
    N_Vector ydot_vec,
    void* user_data) {
  (void)t;
  const ms_linear_ode_ctx_t* ctx = (const ms_linear_ode_ctx_t*)user_data;
  const ms_sun_real_t* y = N_VGetArrayPointer(y_vec);
  ms_sun_real_t* ydot = N_VGetArrayPointer(ydot_vec);
  const int n = ctx->n;

  for (int i = 0; i < n; ++i) {
    double acc = ctx->b ? ctx->b[i] : 0.0;
    const double* row = ctx->A + (size_t)i * (size_t)n;
    for (int j = 0; j < n; ++j) {
      acc += row[j] * (double)y[j];
    }
    ydot[i] = (ms_sun_real_t)acc;
  }
  return 0;
}

static int ms_linear_jac(
    ms_sun_real_t t,
    N_Vector y_vec,
    N_Vector fy_vec,
    SUNMatrix J,
    void* user_data,
    N_Vector tmp1,
    N_Vector tmp2,
    N_Vector tmp3) {
  (void)t;
  (void)y_vec;
  (void)fy_vec;
  (void)tmp1;
  (void)tmp2;
  (void)tmp3;

  const ms_linear_ode_ctx_t* ctx = (const ms_linear_ode_ctx_t*)user_data;
  const int n = ctx->n;
  for (int i = 0; i < n; ++i) {
    const double* row = ctx->A + (size_t)i * (size_t)n;
    for (int j = 0; j < n; ++j) {
      SM_ELEMENT_D(J, i, j) = (ms_sun_real_t)row[j];
    }
  }
  return 0;
}
#endif  // MS_ENABLE_SUNDIALS

int ms_sundials_native_available(void) {
#ifdef MS_ENABLE_SUNDIALS
  return 1;
#else
  return 0;
#endif
}

/**
 * Integrates the stiff linear ODE system dy/dt = A * y + b from t0 to t1
 * using SUNDIALS CVODE BDF with a dense direct linear solver.
 *
 * Returns 0 on success, negative error code on failure or when SUNDIALS is disabled.
 */
int ms_sundials_cvode_step_linear(
    int n,
    const double* A,
    const double* b,
    double* y,
    double t0,
    double t1,
    double rtol,
    double atol) {
#ifdef MS_ENABLE_SUNDIALS
  if (n <= 0 || !A || !y || t1 < t0) {
    return -1;
  }
  if (t1 == t0) {
    return 0;
  }

  const ms_sun_real_t reltol = (ms_sun_real_t)(rtol > 0.0 ? rtol : 1e-6);
  const ms_sun_real_t abstol = (ms_sun_real_t)(atol > 0.0 ? atol : 1e-9);

  int rc = 0;
#if defined(SUNDIALS_VERSION_MAJOR) && SUNDIALS_VERSION_MAJOR >= 6
  SUNContext sunctx = NULL;
#if SUNDIALS_VERSION_MAJOR >= 7
  if (SUNContext_Create(SUN_COMM_NULL, &sunctx) != 0) {
    return -2;
  }
#else
  if (SUNContext_Create(NULL, &sunctx) != 0) {
    return -2;
  }
#endif
  N_Vector y_vec = N_VNew_Serial((sunindextype)n, sunctx);
  void* cvode_mem = CVodeCreate(CV_BDF, sunctx);
  SUNMatrix J = SUNDenseMatrix((sunindextype)n, (sunindextype)n, sunctx);
  SUNLinearSolver ls = (y_vec && J) ? SUNLinSol_Dense(y_vec, J, sunctx) : NULL;
#else
  N_Vector y_vec = N_VNew_Serial((sunindextype)n);
  void* cvode_mem = CVodeCreate(CV_BDF);
  SUNMatrix J = SUNDenseMatrix((sunindextype)n, (sunindextype)n);
  SUNLinearSolver ls = (y_vec && J) ? SUNLinSol_Dense(y_vec, J) : NULL;
#endif

  if (!y_vec || !cvode_mem || !J || !ls) {
    rc = -3;
  }

  ms_linear_ode_ctx_t ctx;
  ctx.n = n;
  ctx.A = A;
  ctx.b = b;

  if (rc == 0) {
    ms_sun_real_t* y_ptr = N_VGetArrayPointer(y_vec);
    for (int i = 0; i < n; ++i) {
      y_ptr[i] = (ms_sun_real_t)y[i];
    }

    if (CVodeSetUserData(cvode_mem, &ctx) != CV_SUCCESS ||
        CVodeInit(cvode_mem, ms_linear_rhs, (ms_sun_real_t)t0, y_vec) != CV_SUCCESS ||
        CVodeSStolerances(cvode_mem, reltol, abstol) != CV_SUCCESS ||
        CVodeSetLinearSolver(cvode_mem, ls, J) != CV_SUCCESS ||
        CVodeSetJacFn(cvode_mem, ms_linear_jac) != CV_SUCCESS ||
        CVodeSetMaxNumSteps(cvode_mem, 50000) != CV_SUCCESS) {
      rc = -4;
    }
  }

  if (rc == 0) {
    ms_sun_real_t t_out = (ms_sun_real_t)t0;
    const int flag = CVode(cvode_mem, (ms_sun_real_t)t1, y_vec, &t_out, CV_NORMAL);
    if (flag != CV_SUCCESS) {
      rc = -5;
    } else {
      const ms_sun_real_t* y_ptr = N_VGetArrayPointer(y_vec);
      for (int i = 0; i < n; ++i) {
        y[i] = (double)y_ptr[i];
      }
    }
  }

  if (cvode_mem) CVodeFree(&cvode_mem);
  if (ls) SUNLinSolFree(ls);
  if (J) SUNMatDestroy(J);
  if (y_vec) N_VDestroy(y_vec);
#if defined(SUNDIALS_VERSION_MAJOR) && SUNDIALS_VERSION_MAJOR >= 6
  if (sunctx) SUNContext_Free(&sunctx);
#endif

  return rc;
#else
  (void)n;
  (void)A;
  (void)b;
  (void)y;
  (void)t0;
  (void)t1;
  (void)rtol;
  (void)atol;
  return -1;
#endif
}
