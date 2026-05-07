// name: usertype4.mo
// keywords:
// status: correct
//

type MyReal = Real;
type MyReal2 = MyReal(start = 3.0);
type MyReal3 = MyReal2(start = 4.0);

model M
  MyReal x;
  MyReal2 y;
  MyReal3 z;
end M;

// Result:
// Error processing file: usertype4.mo
// Error: Failed to load package usertype4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class usertype4.mo not found in scope <top>.
// Error: Error occurred while flattening model usertype4.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
