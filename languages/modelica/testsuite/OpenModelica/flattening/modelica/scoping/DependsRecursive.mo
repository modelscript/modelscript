// name:     DependsRecursive
// keywords: scoping
// status:   incorrect
//
// A recursive model can not be instantiated.
//

model DependsRecursive
  Real head;
  DependsRecursive tail;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DependsRecursive;
// Result:
// Error processing file: DependsRecursive.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scoping/DependsRecursive.mo:10:3-10:24:writable] Error: Declaration of element tail causes recursive definition of class DependsRecursive.
// Error: Error occurred while flattening model DependsRecursive
//
// Execution failed!
// endResult
