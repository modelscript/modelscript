model UnpOpPrecedence

equation
  X=not (A and (B or C));
  Y=not A and B or C;
end UnpOpPrecedence;

// Result:
// Error processing file: UnpOpPrecedence.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/UnpOpPrecedence.mo:4:3-4:25:writable] Error: Variable X not found in scope UnpOpPrecedence.
//
// Execution failed!
// endResult
