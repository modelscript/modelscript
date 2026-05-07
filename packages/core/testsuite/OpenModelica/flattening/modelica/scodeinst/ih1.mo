// name: ih1.mo
// keywords:
// status: correct
//


model A
  Real x;
  Real y;
equation
  y = 1.0;
end A;

model B
  A a;
end B;

model C
  B b;
equation
  b.a.x = 2.0;
end C;

// Result:
// Error processing file: ih1.mo
// Error: Failed to load package ih1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ih1.mo not found in scope <top>.
// Error: Error occurred while flattening model ih1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
