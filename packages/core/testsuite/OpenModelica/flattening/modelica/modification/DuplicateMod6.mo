// name: DuplicateMod6.mo
// keywords:
// status: incorrect
//

model A
  Real x;
end A;

model DuplicateMod6
  extends A(x = 1.0, x = 2.0);
end DuplicateMod6;

// Result:
// Error processing file: DuplicateMod6.mo
// [OpenModelica/flattening/modelica/modification/DuplicateMod6.mo:11:22-11:29:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/DuplicateMod6.mo:11:13-11:20:writable] Error: Duplicate modification of element x on extends A.
// Error: Class DuplicateMod6.mo not found in scope <top>.
// Error: Error occurred while flattening model DuplicateMod6.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
