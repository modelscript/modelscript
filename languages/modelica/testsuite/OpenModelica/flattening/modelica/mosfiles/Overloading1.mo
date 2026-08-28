function TestFunc
  input Real x;
  output Real y;
algorithm
  y := x ^ 3.0;
end TestFunc;
// Result:
// Error processing file: Overloading1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/Overloading1.mo:1:1-6:13:writable] Error: Cannot instantiate TestFunc due to class specialization function.
//
// Execution failed!
// endResult
