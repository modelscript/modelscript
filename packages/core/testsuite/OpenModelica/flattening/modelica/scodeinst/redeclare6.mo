// name: redeclare6.mo
// keywords:
// status: correct
//


model A
  replaceable Integer x;
end A;

model B
  extends A(redeclare replaceable Integer x = 2);
end B;

model C
  extends B(redeclare Real x = 3);
end C;

// Result:
// Error processing file: redeclare6.mo
// Error: Failed to load package redeclare6 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare6.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
