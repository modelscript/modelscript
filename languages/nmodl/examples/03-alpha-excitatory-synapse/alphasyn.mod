TITLE Dual-Exponential Excitatory AMPA Synapse

NEURON {
  SUFFIX alpha_syn
  NONSPECIFIC_CURRENT i
  RANGE gmax, tau_r, tau_d, e, g, i
}

PARAMETER {
  gmax = 0.002 (uS) <0, 1e9>
  tau_r = 0.5 (ms) <0.01, 100>
  tau_d = 5.0 (ms) <0.1, 500>
  e = 0.0 (mV)
}

STATE {
  A
  B
}

ASSIGNED {
  v (mV)
  g (uS)
  i (nA)
}

INITIAL {
  A = 0.0
  B = 0.0
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  g = gmax * (B - A)
  i = g * (v - e)
}

DERIVATIVE states {
  A' = -A / tau_r
  B' = -B / tau_d
}
