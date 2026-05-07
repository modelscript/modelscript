// name:     Derivative Annotation
// keywords: functions, index reduction
// status:   correct
//

function f1
  input Real a;
  output Real b;
  external b = myfoo(a) annotation(derivative=df1,Library="foo.o",Include="#include \"myfoo.h\"");
end f1;

function df1
  input Real a;
  input Real b;
  output Real c;
  external c = dmyfoo(a,b) annotation(Library="foo.o",Include="#include \"myfoo.h\"");
end df1;

package FooFunctions
function foo0
  input Real x;
  output Real y;
  external "C" y=sin(x) annotation(derivative=foo1);
end foo0;

function foo1
  input Real x;
  input Real der_x;
  output Real der_y;
  external "C" der_y=cos(x) annotation(derivative=foo2);
end foo1;

function foo2
  input Real x;
  input Real der_x;
  input Real derder_x;
  input Real derderder_x;
  output Real der_der_y;
  external "C" der_der_y=sin(x);
end foo2;
end FooFunctions;

model extfunction
  Real y1,y2;
  Real t;
  Real x(start=1);
  Real z[3];
  Real u[3](each fixed=false);
equation
 t = time -x;
 y1 = f1(t);
 y2 = der(y1);
 der(x) = y1 + y2;
 z[1]=FooFunctions.foo0(exp(time));
 der(z[1:2])=z[2:3];
 z[3]=u[3];
 der(u[1:2])=u[2:3];
end extfunction;

// Result:
// class ExternalFunctionBuiltin
//   Real r1 = sin(time);
//   Real r2 = sin(time);
//   Real r3 = cos(time);
//   Real r4 = cos(time);
// end ExternalFunctionBuiltin;
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionBuiltin.mo:28:3-28:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionBuiltin.mo:29:3-29:23:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionBuiltin.mo:30:3-30:22:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/external-functions/ExternalFunctionBuiltin.mo:31:3-31:23:writable] Warning: Components are deprecated in class.
// endResult
