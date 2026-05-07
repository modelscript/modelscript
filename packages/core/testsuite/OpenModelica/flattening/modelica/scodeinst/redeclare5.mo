// name: redeclare5.mo
// keywords:
// status: correct
//


model A
  Real x;
end A;

model B
  extends A;
  Real y;
end B;

model C
  replaceable B b extends A(x = 4, y = 6) "hej";
end C;

// Result:
// Error processing file: redeclare5.mo
// Error: Failed to load package redeclare5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare5.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
