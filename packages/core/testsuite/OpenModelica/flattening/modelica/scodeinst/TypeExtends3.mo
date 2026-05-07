// name: TypeExtends3
// keywords:
// status: correct
//

type TypeInteger
  extends Integer;
end TypeInteger;

// Result:
// Error processing file: TypeExtends3.mo
// Error: Failed to load package TypeExtends3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class TypeExtends3 not found in scope <top>.
// Error: Error occurred while flattening model TypeExtends3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
