// name: TypeRestriction3
// keywords:
// status: incorrect
//

type T
  extends Real;
protected
  model M
  end M;
end T;

class TypeRestriction3
  T t;
end TypeRestriction3;

// Result:
// Error processing file: TypeRestriction3.mo
// [OpenModelica/flattening/modelica/declarations/TypeRestriction3.mo:9:3-10:8:writable] Error: Protected sections are not allowed in type.
// Error: Error occurred while flattening model TypeRestriction3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
