// name:     FinalMod1
// keywords: final modification #2964
// status:   incorrect
//
// Tests that the compiler gives an error when trying to modify a final element.
//

model A
  Real x = 10;
  final Real y = 20;
end A;

model B
  A a(x = 15, y = 30);
end B;

// Result:
// Error processing file: FinalMod1.mo
// Error: Failed to load package FinalMod1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FinalMod1 not found in scope <top>.
// Error: Error occurred while flattening model FinalMod1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
