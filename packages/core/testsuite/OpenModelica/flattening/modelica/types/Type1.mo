// name:     Type1
// keywords: type
// status:   incorrect
//
// You cannot define your own types, only derive them from the builtings.
//

type Type1
  Real x;
end Type1;
// Result:
// Error processing file: Type1.mo
// [OpenModelica/flattening/modelica/types/Type1.mo:8:1-11:10:writable] Error: Type 'Type1' does not extend a basic type.
// Error: Error occurred while flattening model Type1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
