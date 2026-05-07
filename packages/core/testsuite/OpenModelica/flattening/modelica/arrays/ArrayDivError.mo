// name:     ArrayDivError
// keywords: array
// status:   incorrect
//
// Drmodelica: 7.6 Arithmetic Array Operators (p. 223)
//

class ArrayDivError
  Real Div1[1, 3], Div2, Div3;
equation
  Div1 = {2, 4, 6} / 2; // Result:
// Error processing file: ArrayDivError.mo
// [OpenModelica/flattening/modelica/arrays/ArrayDivError.mo:9:3-9:30:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/arrays/ArrayDivError.mo:11:3-11:23:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/arrays/ArrayDivError.mo:11:3-11:23:writable] Error: Type mismatch in equation Div1 = {2, 4, 6} / 2 of type Real[1, 3] = Real[3].
// Error: Error occurred while flattening model ArrayDivError
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
