// name: InStreamUnconnected
// keywords: stream connector
// status: correct

connector FluidPort
  flow Real m_flow;
  stream Real h_outflow;
end FluidPort;

model InStreamUnconnected
  FluidPort c;
equation
  c.m_flow = 0.0;
  c.h_outflow = 100.0;
end InStreamUnconnected;

// Result:
// class InStreamUnconnected
//   Real c.m_flow;
//   Real c.h_outflow;
// equation
//   c.m_flow = 0.0;
//   c.h_outflow = 100.0;
//   c.m_flow = 0.0;
// end InStreamUnconnected;
// endResult
