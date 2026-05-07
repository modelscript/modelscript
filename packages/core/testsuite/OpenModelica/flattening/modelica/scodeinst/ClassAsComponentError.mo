// name: ClassAsComponentError
// keywords: type error
// status: incorrect
//
// Checks that an error is output if a class is used as a component.
//

model ClassAsComponentError
  model M end M;
equation
  M = 3;
end ClassAsComponentError;

// Result:
// Error processing file: ClassAsComponentError.mo
// [OpenModelica/flattening/modelica/scodeinst/ClassAsComponentError.mo:11:3-11:8:writable] Error: Expected M to be a component, but found class instead.
// Error: Error occurred while flattening model ClassAsComponentError
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
