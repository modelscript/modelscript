// name:     Faculty1
// keywords: algorithm,scoping
// status:   correct
//
// Example for a recursive function. The function 'Faculty' must be
// known during its definition in order to be called from itself.

function Faculty1
  input Integer x;
  output Integer y;
algorithm
  y := if x > 0 then x*Faculty1(x-1) else 1;
end Faculty1;


model Test
  Real x=Faculty1(integer(2*time));
end Test;

// Result:
// Error processing file: Faculty1.mo
// [OpenModelica/flattening/modelica/algorithms-functions/Faculty1.mo:8:1-13:13:writable] Error: Cannot instantiate Faculty1 due to class specialization function.
// Error: Error occurred while flattening model Faculty1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
