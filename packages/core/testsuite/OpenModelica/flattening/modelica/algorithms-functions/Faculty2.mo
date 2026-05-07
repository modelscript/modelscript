// name:     Faculty2
// keywords: algorithm
// status:   correct
//
// Definition of faculty using a for loop. The for loop can not be
// unrolled.
//

function Faculty2
  input Integer x;
  output Integer y;
algorithm
  y := 1;
  for i in 2:x loop
    y := i * y;
  end for;
end Faculty2;

model Faculty2Model
  Integer x;
  Integer y;
equation
  y = Faculty2(x);
end Faculty2Model;

// Result:
// Error processing file: Faculty2.mo
// [OpenModelica/flattening/modelica/algorithms-functions/Faculty2.mo:9:1-17:13:writable] Error: Cannot instantiate Faculty2 due to class specialization function.
// Error: Error occurred while flattening model Faculty2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
