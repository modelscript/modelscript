

function Sumit
  input Integer x;
  input Integer y;
  input Real t;
  output Real z;
algorithm
  z := x + y + t;
  //z := z + floor(23.12);
  //z := z + ceil(16.22);
  //z := z + integer(16.22);
  //z := z + Integer(16.22);
end Sumit;



// Result:
// Error processing file: func_explicit_typeconv.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/func_explicit_typeconv.mo:3:1-14:10:writable] Error: Cannot instantiate Sumit due to class specialization function.
//
// Execution failed!
// endResult
