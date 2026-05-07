// name:     Type9
// keywords: types
// status:   correct
//
// This checks that attributes are propagated from types to instances.
//


type T = Real(final unit = "m/s");

type T2 = T(displayUnit="ms");

type T3 = Integer(final quantity = "pcs");
type T4 = String(final quantity="name");
type T5 = Boolean(final quantity="foo");

class A
  Real a(unit = "m/s");
  T b;
  T2 b2;
  T3 b3;
  T4 b4;
  T5 b5;
end A;
// Result:
// Error processing file: Type9.mo
// Error: Failed to load package Type9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Type9 not found in scope <top>.
// Error: Error occurred while flattening model Type9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult
