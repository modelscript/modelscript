// name:     UsertypeModifications
// keywords: usertypes, modifications, arrays, extend
// status:   correct
//
// Tests that modifications on usertypes are propagated correctly
//

type Alias = Real[3](each unit = "new_bugs/fix");

type Alias2
  extends Alias(each start = 3);
end Alias2;

model AliasType
  type B = Real[4](each start=2);
  B b;
  parameter Real[4] a = zeros(4);
  Alias2 a2;
equation
  b = a;
  a2 = ones(3);
end AliasType;

// Result:
// Error processing file: UsertypeModifications.mo
// Error: Failed to load package UsertypeModifications (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class UsertypeModifications not found in scope <top>.
// Error: Error occurred while flattening model UsertypeModifications
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
