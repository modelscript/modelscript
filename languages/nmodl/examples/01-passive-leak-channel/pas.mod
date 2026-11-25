TITLE Passive Leak Membrane Conductance

NEURON {
  SUFFIX pas_leak
  NONSPECIFIC_CURRENT i
  RANGE g, e, i
}

PARAMETER {
  g = 0.0003 (S/cm2) <0, 1e9>
  e = -65.0 (mV)
}

ASSIGNED {
  v (mV)
  i (mA/cm2)
}

BREAKPOINT {
  i = g * (v - e)
}
