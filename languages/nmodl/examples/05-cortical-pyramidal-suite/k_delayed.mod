TITLE Cortical Pyramidal Delayed Rectifier Potassium Channel

NEURON {
  SUFFIX k_delayed
  USEION k READ ek WRITE ik
  RANGE gkbar, gk, ik
  GLOBAL ninf, ntau
}

PARAMETER {
  gkbar = 0.04 (S/cm2) <0, 1e9>
  ek = -85.0 (mV)
}

STATE {
  n
}

ASSIGNED {
  v (mV)
  gk (S/cm2)
  ik (mA/cm2)
}

INITIAL {
  n = 0.25
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gk = gkbar * (n^4)
  ik = gk * (v - ek)
}

DERIVATIVE states {
  n' = (ninf - n) / ntau
}
