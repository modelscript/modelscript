// name: Final5
// keywords:
// status: incorrect
//

model A
  parameter Real x;
end A;

model B
  A a(final x = 1.0);
end B;

model Final4
  B b(a(x = 2.0));
end Final4;

// Result:
// Error processing file: Final5.mo
// Error: Failed to load package Final5 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Final5 not found in scope <top>.
// Error: Error occurred while flattening model Final5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
