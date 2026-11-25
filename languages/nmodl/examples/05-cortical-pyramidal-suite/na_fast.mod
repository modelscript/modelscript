TITLE Cortical Pyramidal Fast Inactivating Sodium Channel

NEURON {
  SUFFIX na_fast
  USEION na READ ena WRITE ina
  RANGE gnabar, gna, ina
  GLOBAL minf, hinf, mtau, htau
}

PARAMETER {
  gnabar = 0.15 (S/cm2) <0, 1e9>
  ena = 55.0 (mV)
}

STATE {
  m
  h
}

ASSIGNED {
  v (mV)
  gna (S/cm2)
  ina (mA/cm2)
}

INITIAL {
  m = 0.04
  h = 0.65
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gna = gnabar * (m^3) * h
  ina = gna * (v - ena)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
}
