// name: CevalFunc2
// keywords:
// status: correct
//
//

function f
  input Integer n;
  output Integer res;
algorithm
  res := 0;

  for i in 1:n loop
    res := res + i;
  end for;
end f;

model CevalFunc1
  constant Real x = f(10);
end CevalFunc1;

// Result:
// Error processing file: CevalFuncFor1.mo
// Error: Failed to load package CevalFunc2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class CevalFunc2 not found in scope <top>.
// Error: Error occurred while flattening model CevalFunc2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
