TITLE Submembrane Calcium Extrusion Pump Mechanism

NEURON {
  SUFFIX ca_pump
  USEION ca READ ica WRITE cai
  RANGE taur, cainf, depth
}

PARAMETER {
  taur = 80.0 (ms)
  cainf = 0.0001 (mM)
  depth = 0.1 (um)
}

STATE {
  cai (mM)
}

ASSIGNED {
  ica (mA/cm2)
}

INITIAL {
  cai = 0.0001
}

BREAKPOINT {
  SOLVE states METHOD cnexp
  cai = cai
}

DERIVATIVE states {
  cai' = (cainf - cai) / taur
}
