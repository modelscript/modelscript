// name: loop1.mo
// keywords:
// status: incorrect
//
//


model A
  constant Integer b = a;
  constant Integer a = i;
  constant Integer i = j;
  constant Integer x[i];
  constant Integer j = size(x, 1);
end A;

// Result:
// Error processing file: loop1.mo
// Error: Failed to load package loop1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class loop1.mo not found in scope <top>.
// Error: Error occurred while flattening model loop1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
