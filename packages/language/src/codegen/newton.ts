import { LanguageOptions } from "../dsl.js";

export function generateNewtonSolver(grammarDef?: LanguageOptions): string {
  return `// --- WASM-Native Non-Linear Newton-Raphson Algebraic Solver ---
// Solves non-linear algebraic loops using automatic differentiation, LU factorization, and line-search damping

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

    let iter: u32 = 0;
    while (iter < maxIter) {
        iter++;

        // 1. Evaluate Residuals F(x) and compute L2 Residual Norm
        let normSq: f64 = 0.0;
        for (let i: u32 = 0; i < dim; i++) {
            let eqIdx = load<u32>(eqIndicesPtr + i * 4);
            let res = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
            store<f64>(resPtr + i * 8, res);
            normSq += res * res;
        }

        if (Math.sqrt(normSq) < tol) {
            return true; // Converged
        }

        // 2. Evaluate Jacobian Matrix J_ij = dF_i / dx_j using AD / Numerical Finite Differences
        let eps: f64 = 1e-7;
        for (let j: u32 = 0; j < dim; j++) {
            let varIdx = load<u32>(varIndicesPtr + j * 4);
            let origVal = load<f64>(varValuesPtr + varIdx * 8);

            // Perturb x_j + eps
            store<f64>(varValuesPtr + varIdx * 8, origVal + eps);
            for (let i: u32 = 0; i < dim; i++) {
                let eqIdx = load<u32>(eqIndicesPtr + i * 4);
                let resPlus = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
                let baseRes = load<f64>(resPtr + i * 8);
                let deriv = (resPlus - baseRes) / eps;
                store<f64>(jacPtr + (i * dim + j) * 8, deriv);
            }
            // Restore original x_j
            store<f64>(varValuesPtr + varIdx * 8, origVal);
        }

        // 3. Solve Linear System J * delta = -res via LU Factorization with Partial Pivoting
        // Copy -res into deltaPtr
        for (let i: u32 = 0; i < dim; i++) {
            store<f64>(deltaPtr + i * 8, -load<f64>(resPtr + i * 8));
        }

        let solved = solveLUInPlace(dim, jacPtr, deltaPtr);
        if (!solved) return false; // Singular Jacobian

        // 4. Backtracking Line Search with Armijo Damping (alpha)
        let alpha: f64 = 1.0;
        let stepAccepted = false;
        let minAlpha: f64 = 1e-4;

        while (alpha >= minAlpha) {
            for (let i: u32 = 0; i < dim; i++) {
                let varIdx = load<u32>(varIndicesPtr + i * 4);
                let origVal = load<f64>(varValuesPtr + varIdx * 8);
                let step = load<f64>(deltaPtr + i * 8);
                store<f64>(trialPtr + i * 8, origVal + alpha * step);
            }

            // Compute Trial Residual Norm
            let trialNormSq: f64 = 0.0;
            for (let i: u32 = 0; i < dim; i++) {
                let varIdx = load<u32>(varIndicesPtr + i * 4);
                let trialVal = load<f64>(trialPtr + i * 8);
                let origVal = load<f64>(varValuesPtr + varIdx * 8);
                store<f64>(varValuesPtr + varIdx * 8, trialVal);

                let eqIdx = load<u32>(eqIndicesPtr + i * 4);
                let trialRes = evalEquationResidual(eqIdx, daePtr, varValuesPtr);
                trialNormSq += trialRes * trialRes;

                // Revert
                store<f64>(varValuesPtr + varIdx * 8, origVal);
            }

            if (trialNormSq < normSq) {
                // Apply update to varValuesPtr
                for (let i: u32 = 0; i < dim; i++) {
                    let varIdx = load<u32>(varIndicesPtr + i * 4);
                    store<f64>(varValuesPtr + varIdx * 8, load<f64>(trialPtr + i * 8));
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
`;
}
