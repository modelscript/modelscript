// name: InStreamTwoInside
// keywords: stream connector
// status: correct

connector FluidPort
  flow Real m_flow;
  stream Real h_outflow;
end FluidPort;

model Source
  FluidPort c;
equation
  c.m_flow = -1.0;
  c.h_outflow = 300.0;
end Source;

model Sink
  FluidPort c;
  Real h;
equation
  c.m_flow = 1.0;
  c.h_outflow = 0.0;
  h = inStream(c.h_outflow);
end Sink;

model InStreamTwoInside
  Source source;
  Sink sink;
equation
  connect(source.c, sink.c);
end InStreamTwoInside;

// Result:
// class InStreamTwoInside
//   Real source.c.m_flow;
//   Real source.c.h_outflow;
//   Real sink.c.m_flow;
//   Real sink.c.h_outflow;
//   Real sink.h;
// equation
//   source.c.m_flow = -1.0;
//   source.c.h_outflow = 300.0;
//   sink.c.m_flow = 1.0;
//   sink.c.h_outflow = 0.0;
//   sink.h = inStream(sink.c.h_outflow);
//   -(source.c.m_flow + sink.c.m_flow) = 0.0;
//   source.c.m_flow = 0.0;
//   sink.c.m_flow = 0.0;
// end InStreamTwoInside;
// endResult
