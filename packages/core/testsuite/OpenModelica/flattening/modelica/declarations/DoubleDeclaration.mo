// name: DoubleDeclaration
// keywords: component, declaration
// status: incorrect
//
// Tests that it's not allowed to declare two elements with the same name in the
// same scope.
//

model DoubleDeclaration
  Integer x;
  Real x;
equation
  x = 1;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DoubleDeclaration;

// Result:
// Error processing file: DoubleDeclaration.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/declarations/DoubleDeclaration.mo:11:3-11:9:writable] Notification: From here:
// [OpenModelica/flattening/modelica/declarations/DoubleDeclaration.mo:10:3-10:12:writable] Error: Duplicate elements (due to inherited elements) not identical:
//   first element is:  Real x
//   second element is: Integer x
// Error: Error occurred while flattening model DoubleDeclaration
//
// Execution failed!
// endResult
