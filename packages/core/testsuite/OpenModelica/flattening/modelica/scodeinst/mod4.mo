// name: mod4.mo
// keywords:
// status: correct
//


model M
  Real z;
end M;

model A
  Real x;
  M m;
end A;

model B
  Real y;
  A a;
end B;

model C
  B b(a(x = 1.0), y = 2.0, a(m(z = 3.0)));
end C;

// Result:
// Error processing file: mod4.mo
// Error: Failed to load package mod4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod4.mo not found in scope <top>.
// Error: Error occurred while flattening model mod4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
