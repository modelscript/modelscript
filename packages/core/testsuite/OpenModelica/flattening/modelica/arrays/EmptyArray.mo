// name:     EmptyArray
// keywords: array, constructor, empty
// status:   incorrect
//
// Checks that empty array constructors are not allowed, as per 10.4 in the
// Modelica 3.2 specification.
//

model EmptyArray
  Real r[:] = {};
end EmptyArray;

// Result:
// Error processing file: EmptyArray.mo
// [OpenModelica/flattening/modelica/arrays/EmptyArray.mo:10:15-10:16:writable] Error: Parse error: Empty array constructors are not valid in Modelica.
// Error: Failed to load package EmptyArray (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class EmptyArray not found in scope <top>.
// Error: Error occurred while flattening model EmptyArray
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
