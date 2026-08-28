// name: DuplicateMod5.mo
// keywords:
// status: incorrect
//

model A
  Real x;
end A;

model B
  replaceable A a;
end B;

model DuplicateMod5
  B b(redeclare A a(x = 5), a(x = 1));
end DuplicateMod5;

// Result:
// Error processing file: DuplicateMod5.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/DuplicateMod5.mo:15:29-15:37:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/DuplicateMod5.mo:15:7-15:27:writable] Error: Duplicate modification of element a on component b.
//
// Execution failed!
// endResult
