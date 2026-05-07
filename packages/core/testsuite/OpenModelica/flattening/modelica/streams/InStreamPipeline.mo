// name: InStreamTwoInside
// keywords: stream inStream connector inside
// status: correct
//
// Checks that inStream is evaluated correctly for a model where the stream just
// passes through some components.
//

connector S
  flow Real f;
  Real e;
  stream Real s;
end S;

model A
  S s1;
  S s2;
  Real s1_instream;
  Real s2_instream;
equation
  connect(s1, s2);
  s1_instream = inStream(s1.s);
  s2_instream = inStream(s2.s);
end A;

model B
  S s;
equation
  s.f = 1;
  s.s = 10;
end B;

model C
  S s;
equation
  s.e = 0;
  s.s = 20;
end C;

model InStreamPipeline
  A a1;
  A a2;
  B b;
  C c;
equation
  connect(b.s, a1.s1);
  connect(a1.s2, a2.s1);
  connect(a2.s2, c.s);
end InStreamPipeline;

// Result:
// Error processing file: InStreamPipeline.mo
// Error: Failed to load package InStreamTwoInside (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InStreamTwoInside not found in scope <top>.
// Error: Error occurred while flattening model InStreamTwoInside
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
