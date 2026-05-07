// name: redeclare13.mo
// keywords:
// status: correct
//
// Checks that redeclares are propagated to the correct element when there's
// multiple extends.
//

model A
  replaceable Real x;
end A;

model B
  replaceable Real y;
end B;

model C
  extends A;
  extends B;
end C;

model D
  C c(redeclare Real x = 3.0);
end D;

// Result:
// Error processing file: redeclare13.mo
// Error: Failed to load package redeclare13 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare13.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare13.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
