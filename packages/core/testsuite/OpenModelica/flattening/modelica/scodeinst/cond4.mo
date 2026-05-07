// name: cond4.mo
// keywords:
// status: correct
//

model A
  parameter Boolean b;
  Real x if b;
end A;

model B
  parameter Boolean b = true;
  A a(b = b);
end B;

// Result:
// Error processing file: cond4.mo
// Error: Failed to load package cond4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class cond4.mo not found in scope <top>.
// Error: Error occurred while flattening model cond4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
