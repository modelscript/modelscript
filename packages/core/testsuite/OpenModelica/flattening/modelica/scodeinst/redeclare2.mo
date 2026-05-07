// name: redeclare2.mo
// keywords:
// status: correct
//


model A
  replaceable Real x;
end A;

model B
  A a(redeclare parameter Real x = 0);
end B;

// Result:
// Error processing file: redeclare2.mo
// Error: Failed to load package redeclare2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare2.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
