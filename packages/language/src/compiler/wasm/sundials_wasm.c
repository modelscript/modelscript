#include <cvode/cvode.h>
#include <nvector/nvector_serial.h>
#include <sunmatrix/sunmatrix_dense.h>
#include <sunlinsol/sunlinsol_dense.h>
#include <sundials/sundials_types.h>
#include <stdlib.h>
#include <stdio.h>

typedef int (*RhsFnWasm)(double t, double* y, double* ydot);
typedef int (*EventFnWasm)(double t, double* y, double* gout);

typedef struct {
    SUNContext sunctx;
    void* cvode_mem;
    N_Vector y;
    SUNMatrix A;
    SUNLinearSolver LS;
    RhsFnWasm rhs_fn;
    EventFnWasm event_fn;
    int n_states;
    int n_events;
} CvodeWasmContext;

static int cvode_rhs_wrapper(sunrealtype t, N_Vector y, N_Vector ydot, void* user_data) {
    CvodeWasmContext* ctx = (CvodeWasmContext*)user_data;
    double* y_data = N_VGetArrayPointer(y);
    double* ydot_data = N_VGetArrayPointer(ydot);
    return ctx->rhs_fn((double)t, y_data, ydot_data);
}

static int cvode_root_wrapper(sunrealtype t, N_Vector y, sunrealtype* gout, void* user_data) {
    CvodeWasmContext* ctx = (CvodeWasmContext*)user_data;
    if (ctx->event_fn && ctx->n_events > 0) {
        double* y_data = N_VGetArrayPointer(y);
        // Assuming sunrealtype is double. If not, we'd need a temp array.
        // In SUNDIALS 6.7 default, sunrealtype is double.
        return ctx->event_fn((double)t, y_data, (double*)gout);
    }
    return 0;
}

CvodeWasmContext* cvode_init(
    int n_states, 
    double t0, 
    double* y0, 
    int rhs_fn_ptr, 
    int n_events,
    int event_fn_ptr, 
    double rtol, 
    double atol
) {
    CvodeWasmContext* ctx = (CvodeWasmContext*)malloc(sizeof(CvodeWasmContext));
    if (!ctx) return NULL;

    ctx->n_states = n_states;
    ctx->n_events = n_events;
    ctx->rhs_fn = (RhsFnWasm)rhs_fn_ptr;
    ctx->event_fn = (EventFnWasm)event_fn_ptr;

    if (SUNContext_Create(NULL, &ctx->sunctx) != 0) {
        free(ctx);
        return NULL;
    }

    ctx->y = N_VNew_Serial(n_states, ctx->sunctx);
    if (!ctx->y) {
        SUNContext_Free(&ctx->sunctx);
        free(ctx);
        return NULL;
    }

    double* y_data = N_VGetArrayPointer(ctx->y);
    for (int i = 0; i < n_states; i++) {
        y_data[i] = y0[i];
    }

    ctx->cvode_mem = CVodeCreate(CV_BDF, ctx->sunctx);
    if (!ctx->cvode_mem) return NULL; // Leaks memory on failure, but WASM is short-lived

    CVodeInit(ctx->cvode_mem, cvode_rhs_wrapper, (sunrealtype)t0, ctx->y);
    CVodeSStolerances(ctx->cvode_mem, (sunrealtype)rtol, (sunrealtype)atol);
    CVodeSetUserData(ctx->cvode_mem, ctx);

    ctx->A = SUNDenseMatrix(n_states, n_states, ctx->sunctx);
    ctx->LS = SUNLinSol_Dense(ctx->y, ctx->A, ctx->sunctx);
    CVodeSetLinearSolver(ctx->cvode_mem, ctx->LS, ctx->A);

    if (n_events > 0 && ctx->event_fn) {
        CVodeRootInit(ctx->cvode_mem, n_events, cvode_root_wrapper);
    }

    return ctx;
}

int cvode_step(CvodeWasmContext* ctx, double t_out, double* t_ret_ptr, double* y_ret) {
    sunrealtype t_ret;
    int flag = CVode(ctx->cvode_mem, (sunrealtype)t_out, ctx->y, &t_ret, CV_NORMAL);
    
    *t_ret_ptr = (double)t_ret;
    double* y_data = N_VGetArrayPointer(ctx->y);
    for (int i = 0; i < ctx->n_states; i++) {
        y_ret[i] = y_data[i];
    }
    
    return flag; // 2 is CV_ROOT_RETURN, 0 is CV_SUCCESS
}

void cvode_reinit(CvodeWasmContext* ctx, double t, double* y_new) {
    double* y_data = N_VGetArrayPointer(ctx->y);
    for (int i = 0; i < ctx->n_states; i++) {
        y_data[i] = y_new[i];
    }
    CVodeReInit(ctx->cvode_mem, (sunrealtype)t, ctx->y);
}

void cvode_free(CvodeWasmContext* ctx) {
    if (!ctx) return;
    if (ctx->LS) SUNLinSolFree(ctx->LS);
    if (ctx->A) SUNMatDestroy(ctx->A);
    if (ctx->y) N_VDestroy(ctx->y);
    if (ctx->cvode_mem) CVodeFree(&ctx->cvode_mem);
    if (ctx->sunctx) SUNContext_Free(&ctx->sunctx);
    free(ctx);
}
