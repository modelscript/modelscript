// name:     Type3
// keywords: type
// status:   incorrect
//
// This should give a type error because the expression i/4 is of
// type Real.

class Type3
  Integer i = 16;
  Real x[100];
equation
  x[i/4] = 0.5;
end Type3;

// Result:
// Error processing file: Type3.mo
// [OpenModelica/flattening/modelica/types/Type3.mo:9:3-9:17:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/types/Type3.mo:10:3-10:14:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/types/Type3.mo:12:3-12:15:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/types/Type3.mo:12:3-12:15:writable] Error: Subscript 'CAST(Real, i) / 4.0' has type Real, expected type Integer.
// Error: Error occurred while flattening model Type3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
