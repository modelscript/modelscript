// name: ErrorMultipleClasses
// status: incorrect

class A
end A;

class A
end A;

class sin
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end sin;
// Result:
// Error processing file: ErrorMultipleClasses.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
// Failed to parse file: OpenModelica/flattening/modelica/declarations/ErrorMultipleClasses.mo!
//
// Failed to parse file: OpenModelica/flattening/modelica/declarations/ErrorMultipleClasses.mo!
//
// [OpenModelica/flattening/modelica/declarations/ErrorMultipleClasses.mo:4:1-5:6:writable] Notification: From here:
// [OpenModelica/flattening/modelica/declarations/ErrorMultipleClasses.mo:7:1-8:6:writable] Error: An element with name A is already declared in this scope.
//
// Execution failed!
// endResult
