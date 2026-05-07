// name: type2.mo
// keywords:
// status: correct
//


type MyReal
  extends Real(max = 1.0);
end MyReal;

type MyReal2
  extends MyReal(min = 1.0);
end MyReal2;

model M
  MyReal2 m(start = 1.0);
end M;

// Result:
// Error processing file: type2.mo
// Error: Failed to load package type2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class type2.mo not found in scope <top>.
// Error: Error occurred while flattening model type2.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
