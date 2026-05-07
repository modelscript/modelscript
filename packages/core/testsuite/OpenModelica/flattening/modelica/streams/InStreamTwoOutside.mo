// name: InStreamTwoOutside
// keywords: stream instream connector outside
// status: correct
//
// Checks that inStream is evaluated correctly on two outside connected stream
// connectors.
//

connector S
  Real r;
  flow Real f;
  stream Real s;
end S;

model A
  S s1;
  S s2;
  Real instream_s1;
  Real instream_s2;
equation
  connect(s1, s2);
  instream_s1 = inStream(s1.s);
  instream_s2 = inStream(s2.s);
end A;

model InStreamTwoInside
  A a;
  Real instream_a_s1;
  Real instream_a_s2;
equation
  instream_a_s1 = inStream(a.s1.s);
  instream_a_s2 = inStream(a.s2.s);
end InStreamTwoInside;

// Result:
// Error processing file: InStreamTwoOutside.mo
// Error: Failed to load package InStreamTwoOutside (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InStreamTwoOutside not found in scope <top>.
// Error: Error occurred while flattening model InStreamTwoOutside
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
