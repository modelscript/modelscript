// name: RealPow2
// keywords: real, power
// status: incorrect
//
// tests Real powers
//

model RealPow2
  constant Real x = (-1.0)^0.5;
end RealPow2;

// Result:
// Error processing file: RealPow2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/operators/RealPow2.mo:9:3-9:31:writable] Error: Invalid operation -1.0 ^ 0.5, exponent must be an Integer when the base is negative.
//
// Execution failed!
// endResult
