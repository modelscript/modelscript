// name: RedeclarationComponentNames
// keywords: component
// status: incorrect
//
// This test should produce a warning (or even fail, according to Modelica Specifications)
// Tests whether or not a component can have the same name as its type specifier in a redeclaraton
//

class A
  Real x;
end A;

class B
  Real x;
  Real y;
end B;

model Legal
  replaceable A B;
end Legal;

model IllegalRedeclaredComponentName
  extends Legal(redeclare B B);
end IllegalRedeclaredComponentName;

// Result:
// Error processing file: ComponentNamesRedecl.mo
// Error: Failed to load package RedeclarationComponentNames (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RedeclarationComponentNames not found in scope <top>.
// Error: Error occurred while flattening model RedeclarationComponentNames
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
