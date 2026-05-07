// name: InStreamArray2
// keywords: stream instream connector
// status: correct
//

connector C
  Real p;
  flow Real f;
  stream Real s;
end C;

partial model A
  C c;
end A;

model M
  A1 a1;
  A2 a2;
  input Real s;
equation
  connect(a1.c, a2.c);
end M;

model A1
  extends A;
equation
  c.p = sin(time);
  c.s = cos(time);
end A1;

model A2
  extends A;
equation
  c.f = sin(time);
  c.s = cos(time);
end A2;

model InStreamArray2
  M[2] m(s={inStream(m[i].a1.c.s) + inStream(m[i].a2.c.s) for i in 1:2});
end InStreamArray2;

// Result:
// class InStreamArray2
//   Real m[1].a1.c.p;
//   Real m[1].a1.c.f;
//   Real m[1].a1.c.s;
//   Real m[1].a2.c.p;
//   Real m[1].a2.c.f;
//   Real m[1].a2.c.s;
//   Real m[1].s = m[1].a2.c.s + m[1].a1.c.s;
//   Real m[2].a1.c.p;
//   Real m[2].a1.c.f;
//   Real m[2].a1.c.s;
//   Real m[2].a2.c.p;
//   Real m[2].a2.c.f;
//   Real m[2].a2.c.s;
//   Real m[2].s = m[2].a2.c.s + m[2].a1.c.s;
// equation
//   m[1].a1.c.p = m[1].a2.c.p;
//   m[2].a1.c.p = m[2].a2.c.p;
//   m[1].a2.c.f + m[1].a1.c.f = 0.0;
//   m[2].a2.c.f + m[2].a1.c.f = 0.0;
//   m[1].a1.c.p = sin(time);
//   m[1].a1.c.s = cos(time);
//   m[1].a2.c.f = sin(time);
//   m[1].a2.c.s = cos(time);
//   m[2].a1.c.p = sin(time);
//   m[2].a1.c.s = cos(time);
//   m[2].a2.c.f = sin(time);
//   m[2].a2.c.s = cos(time);
// end InStreamArray2;
// endResult
