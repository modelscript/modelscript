TITLE Hodgkin-Huxley Voltage-Gated Sodium and Potassium Channels

NEURON {
  SUFFIX hh_axon
  USEION na READ ena WRITE ina
  USEION k READ ek WRITE ik
  NONSPECIFIC_CURRENT il
  RANGE gnabar, gkbar, gl, el, gna, gk, ina, ik, il
  GLOBAL minf, hinf, ninf, mtau, htau, ntau
}

PARAMETER {
  gnabar = 0.12 (S/cm2) <0, 1e9>
  gkbar = 0.036 (S/cm2) <0, 1e9>
  gl = 0.0003 (S/cm2) <0, 1e9>
  ena = 50.0 (mV)
  ek = -77.0 (mV)
  el = -54.3 (mV)
}

STATE {
  m
  h
  n
}

ASSIGNED {
  v (mV)
  gna (S/cm2)
  gk (S/cm2)
  ina (mA/cm2)
  ik (mA/cm2)
  il (mA/cm2)
}

INITIAL {
  m = 0.05
  h = 0.60
  n = 0.32
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gna = gnabar * (m^3) * h
  ina = gna * (v - ena)
  gk = gkbar * (n^4)
  ik = gk * (v - ek)
  il = gl * (v - el)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
  n' = (ninf - n) / ntau
}
