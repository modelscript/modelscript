// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/native — Native IEEE-754 FP64 CUDA/HIP Kernels for PCG + SA-AMG FEA.
 *
 * Kernels:
 *   - ms_fea_csr_spmv_fp64       : Sparse CSR matrix-vector product y = A * x
 *   - ms_fea_damped_jacobi_fp64  : Race-free damped-Jacobi smoother sweep
 *                                  xOut = xIn + omega * invDiag * (rhs - A * xIn)
 *   - ms_fea_axpy_fp64           : Vector AXPY y = y + alpha * x
 *   - ms_fea_xpay_fp64           : Vector XPAY y = x + beta * y
 *   - ms_fea_dot_fp64            : Block-reduced inner product partialSums[blockIdx.x] = sum(x_i * y_i)
 */

#ifdef __HIP_PLATFORM_AMD__
#include <hip/hip_runtime.h>
#else
#include <cuda_runtime.h>
#endif

extern "C" {

/**
 * Native FP64 CSR Sparse Matrix-Vector Product: y = A * x.
 */
__global__ void ms_fea_csr_spmv_fp64(
    int n,
    const int* __restrict__ rowOffsets,
    const int* __restrict__ colIndices,
    const double* __restrict__ values,
    const double* __restrict__ x,
    double* __restrict__ y) {
  const int row = blockIdx.x * blockDim.x + threadIdx.x;
  if (row >= n) {
    return;
  }

  const int start = rowOffsets[row];
  const int end = rowOffsets[row + 1];
  double sum = 0.0;
  for (int k = start; k < end; ++k) {
    sum += values[k] * x[colIndices[k]];
  }
  y[row] = sum;
}

/**
 * Native FP64 Damped-Jacobi AMG Smoother Sweep (double-buffered, race-free):
 *   xOut[i] = xIn[i] + omega * invDiag[i] * (rhs[i] - (A * xIn)[i])
 */
__global__ void ms_fea_damped_jacobi_fp64(
    int n,
    double omega,
    const int* __restrict__ rowOffsets,
    const int* __restrict__ colIndices,
    const double* __restrict__ values,
    const double* __restrict__ invDiag,
    const double* __restrict__ rhs,
    const double* __restrict__ xIn,
    double* __restrict__ xOut) {
  const int row = blockIdx.x * blockDim.x + threadIdx.x;
  if (row >= n) {
    return;
  }

  const int start = rowOffsets[row];
  const int end = rowOffsets[row + 1];
  double ax = 0.0;
  for (int k = start; k < end; ++k) {
    ax += values[k] * xIn[colIndices[k]];
  }
  xOut[row] = xIn[row] + omega * invDiag[row] * (rhs[row] - ax);
}

/**
 * Native FP64 Vector AXPY: y[i] += alpha * x[i].
 */
__global__ void ms_fea_axpy_fp64(
    int n,
    double alpha,
    const double* __restrict__ x,
    double* __restrict__ y) {
  const int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < n) {
    y[idx] += alpha * x[idx];
  }
}

/**
 * Native FP64 Vector XPAY (PCG search direction update): y[i] = x[i] + beta * y[i].
 */
__global__ void ms_fea_xpay_fp64(
    int n,
    double beta,
    const double* __restrict__ x,
    double* __restrict__ y) {
  const int idx = blockIdx.x * blockDim.x + threadIdx.x;
  if (idx < n) {
    y[idx] = x[idx] + beta * y[idx];
  }
}

/**
 * Native FP64 Vector Dot Product with shared-memory block reduction.
 * Writes one partial sum per thread block into partialSums[blockIdx.x].
 * Launch with dynamic shared memory size = blockDim.x * sizeof(double)
 * (blockDim.x must be a power of two, e.g., 256).
 */
__global__ void ms_fea_dot_fp64(
    int n,
    const double* __restrict__ x,
    const double* __restrict__ y,
    double* __restrict__ partialSums) {
  extern __shared__ double sdata[];
  const int tid = threadIdx.x;
  const int stride = blockDim.x * gridDim.x;

  double localSum = 0.0;
  for (int idx = blockIdx.x * blockDim.x + tid; idx < n; idx += stride) {
    localSum += x[idx] * y[idx];
  }
  sdata[tid] = localSum;
  __syncthreads();

  for (int s = blockDim.x >> 1; s > 0; s >>= 1) {
    if (tid < s) {
      sdata[tid] += sdata[tid + s];
    }
    __syncthreads();
  }

  if (tid == 0) {
    partialSums[blockIdx.x] = sdata[0];
  }
}

}  // extern "C"
