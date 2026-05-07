// name: inst5.mo
// keywords:
// status: correct
//
// Check that instances are cloned properly, so that modifiers don't "stick" to
// a class.
//

model A
  Real x;
end A;

model B
  A a1(x = 3);
  A a2;
  A a3(x = 5);
end B;

// Result:
// Error processing file: inst5.mo
// Error: Failed to load package inst5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class inst5.mo not found in scope <top>.
// Error: Error occurred while flattening model inst5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
