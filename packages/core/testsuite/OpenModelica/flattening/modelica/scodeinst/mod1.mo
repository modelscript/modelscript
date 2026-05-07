// name: mod1.mo
// keywords:
// status: correct
//

model M
  Real z;
end M;

model A
  extends M;
  Real x;
end A;

model B
  extends A;
  Real y;
end B;

model C
  B b(x = 1.0, y = 2.0, z = 4.0);
end C;

// Result:
// Error processing file: mod1.mo
// Error: Failed to load package mod1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class mod1.mo not found in scope <top>.
// Error: Error occurred while flattening model mod1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
