// name:     Modification14
// keywords: modification
// status:   correct
//
// This file tests modification precedence.
// This is currently(2008-03-05) not working.
//

model M
  replaceable model Foo
    parameter Real q = 1.0;
  end Foo;
  Foo f(q=2.0);
end M;

model Modification6
  model myFoo parameter Real q=5.0; parameter Real z=1.0; end myFoo;
  M m1(redeclare model Foo=myFoo(q=3.0), f(q=4.0,z=3));
  M m2(f(q=4.0), redeclare model Foo=myFoo(q=3.0));
  M m3(redeclare model Foo=myFoo(q=333));
end Modification6;

// Instantiating element: m1
// Instantiating element: m1.f
// Instantiating element: m1.f.q
// Instantiating element: m1.f.z
// Instantiating element: m1.Foo
// Instantiating element: m2
// Instantiating element: m2.f
// Instantiating element: m2.f.q
// Instantiating element: m2.f.z
// Instantiating element: m2.Foo
// Instantiating element: m3
// Instantiating element: m3.f
// Instantiating element: m3.f.q
// Instantiating element: m3.f.z
// Instantiating element: m3.Foo
// Instantiating element: myFoo
// Result:
// Error processing file: Modification14.mo
// Error: Failed to load package Modification14 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Modification14 not found in scope <top>.
// Error: Error occurred while flattening model Modification14
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
