

function MultiRet
  input Integer n;
  output Integer z1;
  output Real z2;
  output Integer z3;
algorithm
  z1 := n * 10;
  z2 := n * 100;
end MultiRet;



// Result:
// Error processing file: func_multiple_return.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/func_multiple_return.mo:3:1-11:13:writable] Error: Cannot instantiate MultiRet due to class specialization function.
//
// Execution failed!
// endResult
