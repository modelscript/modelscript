// name: DuplicateMod3.mo
// keywords:
// status: incorrect
//

model A
  Real x;
end A;

model B
  A a;
end B;

model DuplicateMod3
  B b(a(x = 4), a(x = 6));
end DuplicateMod3;

// Result:
// Error processing file: DuplicateMod3.mo
// [OpenModelica/flattening/modelica/modification/DuplicateMod3.mo:15:9-15:14:writable] Notification: From here:
// [OpenModelica/flattening/modelica/modification/DuplicateMod3.mo:15:19-15:24:writable] Error: Duplicate modification of element a.x on component b.
// Error: Class DuplicateMod3.mo not found in scope <top>.
// Error: Error occurred while flattening model DuplicateMod3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
