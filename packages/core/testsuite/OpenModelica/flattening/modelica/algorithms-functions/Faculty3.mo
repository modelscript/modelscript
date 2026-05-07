// name:     Faculty3
// keywords: algorithm
// status:   correct
//
// Definition of faculty using a while loop. The while loop can not be
// unrolled.
//

function Faculty3
  input Integer x;
  output Integer y;
protected
  Integer i;
algorithm
  y := 1;
  i := 2;
  while (i <= x) loop
    y := i * y;
    i := i + 1;
  end while;
end Faculty3;

model Faculty3Model
  Integer x;
  Integer y;
equation
  y = Faculty3(x);
end Faculty3Model;

// Result:
// Error processing file: Faculty3.mo
// [OpenModelica/flattening/modelica/algorithms-functions/Faculty3.mo:9:1-21:13:writable] Error: Cannot instantiate Faculty3 due to class specialization function.
// Error: Error occurred while flattening model Faculty3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
