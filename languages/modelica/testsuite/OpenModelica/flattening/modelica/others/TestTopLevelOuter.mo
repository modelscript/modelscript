package TestNonStandardExtensions

model InnerDefinition
  parameter Real x = 1;
end InnerDefinition;

model TestTopLevelOuter
  outer InnerDefinition o;
  parameter Real y = 2;
end TestTopLevelOuter;

end TestNonStandardExtensions;

// Result:
// Error processing file: TestTopLevelOuter.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/others/TestTopLevelOuter.mo:1:1-12:30:writable] Error: Cannot instantiate TestNonStandardExtensions due to class specialization package.
//
// Execution failed!
// endResult
