// name: IllegalSubscript
// status: correct
// Should fail in backend; not frontend

class IllegalSubscript
  Real r[1];
equation
  r[0] = 1.0;
end IllegalSubscript;

// Result:
// Error processing file: IllegalSubscript.mo
// [OpenModelica/flattening/modelica/others/IllegalSubscript.mo:6:3-6:12:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/others/IllegalSubscript.mo:8:3-8:13:writable] Warning: Equation sections are deprecated in class.
// [OpenModelica/flattening/modelica/others/IllegalSubscript.mo:8:3-8:13:writable] Error: Subscript '0' for dimension 1 (size = 1) of r is out of bounds.
// Error: Error occurred while flattening model IllegalSubscript
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
