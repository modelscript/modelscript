// name: BuiltinAttribute7
// keywords:
// status: incorrect
//

model BuiltinAttribute7
  Real x(redeclare Real start = 1.0);
end BuiltinAttribute7;

// Result:
// Error processing file: BuiltinAttribute7.mo
// [OpenModelica/flattening/modelica/scodeinst/BuiltinAttribute7.mo:7:10-7:36:writable] Error: Invalid redeclaration of start, attributes of basic types may not be redeclared.
// Error: Error occurred while flattening model BuiltinAttribute7
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
