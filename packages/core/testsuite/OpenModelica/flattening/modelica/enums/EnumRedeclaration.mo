// name:     EnumRedeclaration
// keywords: enumeration enum
// status:   correct
// cflags:   -i=Ex
//
//


model Ex
  class Foo1
    extends Foo(redeclare type T = enumeration(One, Two));
  end Foo1;
  class Foo2 = Foo(redeclare type T = enumeration(One));
  parameter Foo1.T f1 = Foo1.T.Two;
  parameter Foo2.T f2 = Foo2.T.One;
end Ex;

class Foo
  replaceable type T = enumeration(:);
end Foo;

// Result:
// Error processing file: EnumRedeclaration.mo
// Error: Failed to load package EnumRedeclaration (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class EnumRedeclaration not found in scope <top>.
// Error: Error occurred while flattening model EnumRedeclaration
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
