\ Markowitz Mean-Variance Portfolio Optimization QP
Minimize
  variance: - 0.01 w1 - 0.02 w2 - 0.005 w3
            + [ 0.08 w1 ^ 2 + 0.04 w1 * w2 + 0.14 w2 ^ 2 + 0.02 w2 * w3 + 0.03 w3 ^ 2 ] / 2
Subject To
  budget:     w1 + w2 + w3 = 1
  min_return: 0.08 w1 + 0.12 w2 + 0.04 w3 >= 0.08
Bounds
  0 <= w1 <= 0.7
  0 <= w2 <= 0.7
  0 <= w3 <= 0.7
End
