// name:     Enum10
// keywords: enumeration enum type extends
// status:   correct
//
// Tests creation of new enumeration type by extending an already existing one.
//

type enum1 = enumeration(one, two, three);
type enum2 = enum1(start = two);

model Enum10
  enum1 e1;
  enum2 e2;
end Enum10;

// Result:
// Error processing file: Enum10.mo
// [OpenModelica/flattening/modelica/enums/Enum10.mo:9:20-9:31:writable] Error: Variable two not found in scope <top>.
// Error: Error occurred while flattening model Enum10
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
