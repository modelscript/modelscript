// --- WASM-Native Non-Linear Newton-Raphson Algebraic Solver ---
// Solves non-linear algebraic loops using automatic differentiation, LU factorization, and line-search damping

import { DenseMatrixView, UnmanagedFloat64Array, UnmanagedUint32Array } from "../core/array";

export let arenaOffset: u32 = 0;

@external("env", "evalEquationResidual")
declare function evalEquationResidual(eqIdx: u32, daePtr: u32, varValuesPtr: u32): f64;

@external("env", "solveLUInPlace")
declare function solveLUInPlace(dim: u32, aPtr: u32, bPtr: u32): boolean;

export function solveNewtonRaphson(
    dim: u32,
    varIndicesPtr: u32,
    eqIndicesPtr: u32,
    varValuesPtr: u32,
    daePtr: u32,
    maxIter: u32 = 50,
    tol: f64 = 1e-8
): boolean {
    if (dim == 0) return true;

    // Allocate memory for Jacobian (dim x dim), Residual vector (dim), Delta step (dim), and Trial vector (dim)
    let jacPtr = arenaOffset;
    let jacSize = dim * dim * 8;
    arenaOffset += jacSize;

    let resPtr = arenaOffset;
    let vecSize = dim * 8;
    arenaOffset += vecSize;

    let deltaPtr = arenaOffset;
    arenaOffset += vecSize;

    let trialPtr = arenaOffset;
    arenaOffset += vecSize;

    let jac = DenseMatrixView.at(jacPtr, dim, dim);
    let resVec = changetype<UnmanagedFloat64Array>(resPtr);
    let deltaVec = changetype<UnmanagedFloat64Array>(deltaPtr);
    let trialVec = changetype<UnmanagedFloat64Array>(trialPtr);
    let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
    let varIndices = changetype<UnmanagedUint32Array>(varIndicesPtr);
    let eqIndices = changetype<UnmanagedUint32Array>(eqIndicesPtr);

    let iter: u32 = 0;
    while (iter < maxIter) {
        iter++;

        // 1. Evaluate Residuals F(x) and compute L2 Residual Norm
        let normSq: f64 = 0.0;
        for (let i: u32 = 0; i < dim; i++) {
            let eqIdx = eqIndices[i];
            let res = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
            resVec[i] = res;
            normSq += res * res;
        }

        if (Math.sqrt(normSq) < tol) {
            return true; // Converged
        }

        // 2. Evaluate Jacobian Matrix J_ij = dF_i / dx_j using AD / Numerical Finite Differences
        let eps: f64 = 1e-7;
        for (let j: u32 = 0; j < dim; j++) {
            let varIdx = varIndices[j];
            let origVal = varValues[varIdx];

            // Perturb x_j + eps
            varValues[varIdx] = origVal + eps;
            for (let i: u32 = 0; i < dim; i++) {
                let eqIdx = eqIndices[i];
                let resPlus = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
                let baseRes = resVec[i];
                let deriv = (resPlus - baseRes) / eps;
                jac.set(i, j, deriv);
            }
            // Restore original x_j
            varValues[varIdx] = origVal;
        }

        // 3. Solve Linear System J * delta = -res via LU Factorization with Partial Pivoting
        // Copy -res into deltaPtr
        for (let i: u32 = 0; i < dim; i++) {
            deltaVec[i] = -resVec[i];
        }

        let solved = solveLUInPlace(dim, jacPtr, deltaPtr);
        if (!solved) return false; // Singular Jacobian

        // 4. Backtracking Line Search with Armijo Damping (alpha)
        let alpha: f64 = 1.0;
        let stepAccepted = false;
        let minAlpha: f64 = 1e-4;

        while (alpha >= minAlpha) {
            for (let i: u32 = 0; i < dim; i++) {
                let varIdx = varIndices[i];
                let origVal = varValues[varIdx];
                let step = deltaVec[i];
                trialVec[i] = origVal + alpha * step;
            }

            // Compute Trial Residual Norm
            let trialNormSq: f64 = 0.0;
            for (let i: u32 = 0; i < dim; i++) {
                let varIdx = varIndices[i];
                let trialVal = trialVec[i];
                let origVal = varValues[varIdx];
                varValues[varIdx] = trialVal;

                let eqIdx = eqIndices[i];
                let trialRes = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
                trialNormSq += trialRes * trialRes;

                // Revert
                varValues[varIdx] = origVal;
            }

            if (trialNormSq < normSq) {
                // Apply update to varValuesPtr
                for (let i: u32 = 0; i < dim; i++) {
                    let varIdx = varIndices[i];
                    varValues[varIdx] = trialVec[i];
                }
                stepAccepted = true;
                break;
            }

            alpha *= 0.5; // Backtrack step
        }

        if (!stepAccepted) {
            return false; // Stagnated line search
        }
    }

    return false; // Max iterations reached
}
