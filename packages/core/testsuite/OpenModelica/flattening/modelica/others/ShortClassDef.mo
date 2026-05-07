// name: ShortClassDef
// keywords: class
// status: correct
//
// Tests short class definitions of the form class foo = bar;
//

class TestClass
  Integer i1;
end TestClass;

class ShortClassDef = TestClass 

// Result:
// Error processing file: ShortClassDef.mo
// [OpenModelica/flattening/modelica/others/ShortClassDef.mo:19:0-19:0:writable] Error: Missing token: SEMICOLON
// Error: Failed to load package ShortClassDef (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class ShortClassDef not found in scope <top>.
// Error: Error occurred while flattening model ShortClassDef
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
