// name: Clock2
// keywords:
// status: incorrect
//

model Clock
  Real t;
end Clock;

model Clock2
  Clock c;
end Clock2;

// Result:
// Error processing file: Clock2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [/usr/lib/omc/NFModelicaBuiltin.mo:47:1-49:10:readonly] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/Clock2.mo:6:1-8:10:writable] Error: An element with name Clock is already declared in this scope.
//
// Execution failed!
// endResult
