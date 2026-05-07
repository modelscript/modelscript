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
// class A
//   Real a(unit = "m/s");
//   Real b(unit = "m/s");
//   Real b2(unit = "m/s", displayUnit = "ms");
//   Integer b3(quantity = "pcs");
//   String b4(quantity = "name");
//   Boolean b5(quantity = "foo");
// end A;
// [<interactive>:18:3-18:23:writable] Warning: Components are deprecated in class.
// [<interactive>:19:3-19:6:writable] Warning: Components are deprecated in class.
// [<interactive>:20:3-20:8:writable] Warning: Components are deprecated in class.
// [<interactive>:21:3-21:8:writable] Warning: Components are deprecated in class.
// [<interactive>:22:3-22:8:writable] Warning: Components are deprecated in class.
// [<interactive>:23:3-23:8:writable] Warning: Components are deprecated in class.
// endResult
