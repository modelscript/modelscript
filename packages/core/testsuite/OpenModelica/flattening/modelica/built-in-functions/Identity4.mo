// status: correct

model Identity4

function f
  input Integer is[3];
  input Integer s;
  output Integer o1[3,3] = diagonal(is);
  output Integer o2[s,s] = identity(s);
end f;

  Integer[3,3] o1,o2;
algorithm
  (o1,o2) := f({1,2,3},3);
end Identity4;

// Result:
// Error processing file: Identity4.mo
// Error: Failed to load package f (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class f not found in scope <top>.
// Error: Error occurred while flattening model f
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
