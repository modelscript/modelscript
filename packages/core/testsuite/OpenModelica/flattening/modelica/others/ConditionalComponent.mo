// name:     ConditionalComponent
// keywords: conditional component
// status:   correct
//
// This is a simple test conditional components.
//

connector Pin
  Real v;
  flow Real i;
end Pin;

model Resistor
  Pin p,n;
equation
end Resistor;

model ConditionalComponent
  parameter Boolean b=true;

  Resistor R1, R2 if b, R3 if not b;
equation
  connect(R1.n,R2.p);
  connect(R2.n,R3.p);
  connect(R3.p,R1.p);
end ConditionalComponent;

model Array1
  Integer x[5] = {1,2,3,4,5};
  Integer y[3] = 1:3;
end Array1;

// Result:
// class ConditionalComponent
//   final parameter Boolean b = true;
//   Real R1.p.v;
//   Real R1.p.i;
//   Real R1.n.v;
//   Real R1.n.i;
//   Real R2.p.v;
//   Real R2.p.i;
//   Real R2.n.v;
//   Real R2.n.i;
// equation
//   R1.n.v = R2.p.v;
//   R1.p.i = 0.0;
//   R2.p.i + R1.n.i = 0.0;
//   R2.n.i = 0.0;
// end ConditionalComponent;
// endResult
