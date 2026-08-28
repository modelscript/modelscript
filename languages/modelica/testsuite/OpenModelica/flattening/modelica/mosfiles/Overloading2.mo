function TestFunc
  input Real x;
  output Real y;
algorithm
  y := 3.0 ^ x;
end TestFunc;
// Result:
// Error processing file: Overloading2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/Overloading2.mo:1:1-6:13:writable] Error: Cannot instantiate TestFunc due to class specialization function.
//
// Execution failed!
// endResult
