// name: TypeMissingBaseType1
// keywords:
// status: incorrect
//

type T
end T;

model TypeMissingBaseType1
  T t;
end TypeMissingBaseType1;

// Result:
// Error processing file: TypeMissingBaseType1.mo
// [OpenModelica/flattening/modelica/scodeinst/TypeMissingBaseType1.mo:6:1-7:6:writable] Error: Type 'T' does not extend a basic type.
// Error: Error occurred while flattening model TypeMissingBaseType1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
