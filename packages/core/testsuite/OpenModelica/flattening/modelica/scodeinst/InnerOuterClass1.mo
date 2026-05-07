// name: InnerOuterClass1
// keywords:
// status: correct
//

model A
  Real x;
end A;

model B
  Real x;
  Real y;
end B;

model C
  outer model M = A;
  M m;
end C;

model D
  inner model M = B;
  C c;
end D;

// Result:
// Error processing file: InnerOuterClass1.mo
// Error: Failed to load package InnerOuterClass1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InnerOuterClass1 not found in scope <top>.
// Error: Error occurred while flattening model InnerOuterClass1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
