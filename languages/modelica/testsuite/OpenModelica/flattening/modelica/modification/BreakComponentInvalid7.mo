// name:     BreakComponentInvalid7
// keywords: modification break
// status:   incorrect
//

model A
  Real x[3];
end A;

model BreakComponentInvalid7
  extends A(break a[2]);
end BreakComponentInvalid7;

// Result:
// Error processing file: BreakComponentInvalid7.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/modification/BreakComponentInvalid7.mo:11:20-12:28:writable] Error: Syntax Error
//
// Execution failed!
// endResult
