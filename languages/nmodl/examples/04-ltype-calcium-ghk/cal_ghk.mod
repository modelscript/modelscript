TITLE L-Type Calcium Channel with GHK Permeation

NEURON {
  SUFFIX cal_ghk
  USEION ca READ cai, cao WRITE ica
  RANGE pbar, gca, ica
  GLOBAL minf, hinf, mtau, htau
}

PARAMETER {
  pbar = 0.00015 (cm/s) <0, 1e9>
  cai = 0.0001 (mM)
  cao = 2.0 (mM)
  eca = 120.0 (mV)
}

STATE {
  m
  h
}

ASSIGNED {
  v (mV)
  gca (S/cm2)
  ica (mA/cm2)
}

INITIAL {
  m = 0.02
  h = 0.85
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  gca = pbar * (m^2) * h
  ica = gca * (v - eca)
}

DERIVATIVE states {
  m' = (minf - m) / mtau
  h' = (hinf - h) / htau
}
