TITLE Muscarinic M-Type Spike Frequency Adaptation Potassium Channel

NEURON {
  SUFFIX km_adapt
  USEION k READ ek WRITE ik
  RANGE gkmbar, gkm, ik
  GLOBAL minf, mtau
}

PARAMETER {
  gkmbar = 0.005 (S/cm2) <0, 1e9>
  ek = -85.0 (mV)
}

STATE {
  m
}

ASSIGNED {
  v (mV)
  gkm (S/cm2)
  ik (mA/cm2)
}

INITIAL {
  m = 0.05
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gkm = gkmbar * m
  ik = gkm * (v - ek)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
}
