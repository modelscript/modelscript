# Markowitz Mean-Variance Portfolio Quadratic Program
set ASSETS;

param mu {ASSETS};
param var_diag {ASSETS} > 0;
param target_return >= 0;

var w {ASSETS} >= 0, <= 0.6, := 0.25;

minimize Portfolio_Variance:
  sum {i in ASSETS} var_diag[i] * w[i]^2;

subject to Budget:
  sum {i in ASSETS} w[i] = 1.0;

subject to Expected_Return:
  sum {i in ASSETS} mu[i] * w[i] >= target_return;
