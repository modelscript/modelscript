

function Factorial
  input Integer n;
  output Integer z;
algorithm
  if n == 0 then
    z := 1;
  else
    z := n * Factorial(n - 1);
  end if;
end Factorial;



// Result:
// Error processing file: func_factorial.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/mosfiles/func_factorial.mo:3:1-12:14:writable] Error: Cannot instantiate Factorial due to class specialization function.
//
// Execution failed!
// endResult
