// name:     BreakComponentInvalid4
// keywords: modification break
// status:   incorrect
//

type NoStartReal
  extends Real(break start);
end NoStartReal;

model BreakComponentInvalid4
  NoStartReal x;
end BreakComponentInvalid4;

// Result:
// Error processing file: BreakComponentInvalid4.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/modification/BreakComponentInvalid4.mo:7:16-7:27:writable] Error: Invalid use of break on non-component 'start'.
//
// Execution failed!
// endResult
