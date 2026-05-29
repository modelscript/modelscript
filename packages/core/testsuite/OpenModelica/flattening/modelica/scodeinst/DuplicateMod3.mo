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
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/DuplicateMod3.mo:15:9-15:14:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/DuplicateMod3.mo:15:19-15:24:writable] Error: Duplicate modification of element a.x on component b.
//
// Execution failed!
// endResult
