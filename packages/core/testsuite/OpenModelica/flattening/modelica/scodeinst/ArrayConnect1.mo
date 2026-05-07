// name: ArrayConnect1
// keywords:
// status: correct
//

connector C
  Real e;
  flow Real f;
end C;

model A
  C p;
  C n;
end A;

model ArrayConnect1
  parameter Integer N = 10;
  A S, R[N], C[N], G;
equation
  connect(S.p, R[1].p);
  connect(S.n, G.p);
  for i in 1:N-1 loop
    connect(R[i].n, R[i+1].p);
  end for;
  for i in 1:N loop
    connect(C[i].p, R[i].n);
    connect(C[i].n, G.p);
  end for;
end ArrayConnect1;

// Result:
// class ArrayConnect1
//   final parameter Integer N = 10;
//   Real S.p.e;
//   Real S.p.f;
//   Real S.n.e;
//   Real S.n.f;
//   Real R[1].p.e;
//   Real R[1].p.f;
//   Real R[1].n.e;
//   Real R[1].n.f;
//   Real R[2].p.e;
//   Real R[2].p.f;
//   Real R[2].n.e;
//   Real R[2].n.f;
//   Real R[3].p.e;
//   Real R[3].p.f;
//   Real R[3].n.e;
//   Real R[3].n.f;
//   Real R[4].p.e;
//   Real R[4].p.f;
//   Real R[4].n.e;
//   Real R[4].n.f;
//   Real R[5].p.e;
//   Real R[5].p.f;
//   Real R[5].n.e;
//   Real R[5].n.f;
//   Real R[6].p.e;
//   Real R[6].p.f;
//   Real R[6].n.e;
//   Real R[6].n.f;
//   Real R[7].p.e;
//   Real R[7].p.f;
//   Real R[7].n.e;
//   Real R[7].n.f;
//   Real R[8].p.e;
//   Real R[8].p.f;
//   Real R[8].n.e;
//   Real R[8].n.f;
//   Real R[9].p.e;
//   Real R[9].p.f;
//   Real R[9].n.e;
//   Real R[9].n.f;
//   Real R[10].p.e;
//   Real R[10].p.f;
//   Real R[10].n.e;
//   Real R[10].n.f;
//   Real C[1].p.e;
//   Real C[1].p.f;
//   Real C[1].n.e;
//   Real C[1].n.f;
//   Real C[2].p.e;
//   Real C[2].p.f;
//   Real C[2].n.e;
//   Real C[2].n.f;
//   Real C[3].p.e;
//   Real C[3].p.f;
//   Real C[3].n.e;
//   Real C[3].n.f;
//   Real C[4].p.e;
//   Real C[4].p.f;
//   Real C[4].n.e;
//   Real C[4].n.f;
//   Real C[5].p.e;
//   Real C[5].p.f;
//   Real C[5].n.e;
//   Real C[5].n.f;
//   Real C[6].p.e;
//   Real C[6].p.f;
//   Real C[6].n.e;
//   Real C[6].n.f;
//   Real C[7].p.e;
//   Real C[7].p.f;
//   Real C[7].n.e;
//   Real C[7].n.f;
//   Real C[8].p.e;
//   Real C[8].p.f;
//   Real C[8].n.e;
//   Real C[8].n.f;
//   Real C[9].p.e;
//   Real C[9].p.f;
//   Real C[9].n.e;
//   Real C[9].n.f;
//   Real C[10].p.e;
//   Real C[10].p.f;
//   Real C[10].n.e;
//   Real C[10].n.f;
//   Real G.p.e;
//   Real G.p.f;
//   Real G.n.e;
//   Real G.n.f;
// equation
//   S.p.e = R[1].p.e;
//   C[10].n.e = G.p.e;
//   C[10].n.e = C[9].n.e;
//   C[10].n.e = C[8].n.e;
//   C[10].n.e = C[7].n.e;
//   C[10].n.e = C[6].n.e;
//   C[10].n.e = C[5].n.e;
//   C[10].n.e = C[4].n.e;
//   C[10].n.e = C[3].n.e;
//   C[10].n.e = C[2].n.e;
//   C[10].n.e = C[1].n.e;
//   C[10].n.e = S.n.e;
//   C[1].p.e = R[1].n.e;
//   C[1].p.e = R[2].p.e;
//   C[2].p.e = R[2].n.e;
//   C[2].p.e = R[3].p.e;
//   C[3].p.e = R[3].n.e;
//   C[3].p.e = R[4].p.e;
//   C[4].p.e = R[4].n.e;
//   C[4].p.e = R[5].p.e;
//   C[5].p.e = R[5].n.e;
//   C[5].p.e = R[6].p.e;
//   C[6].p.e = R[6].n.e;
//   C[6].p.e = R[7].p.e;
//   C[7].p.e = R[7].n.e;
//   C[7].p.e = R[8].p.e;
//   C[8].p.e = R[8].n.e;
//   C[8].p.e = R[9].p.e;
//   C[9].p.e = R[9].n.e;
//   C[9].p.e = R[10].p.e;
//   C[10].p.e = R[10].n.e;
//   R[1].p.f + S.p.f = 0.0;
//   G.p.f + C[10].n.f + C[9].n.f + C[8].n.f + C[7].n.f + C[6].n.f + C[5].n.f + C[4].n.f + C[3].n.f + C[2].n.f + C[1].n.f + S.n.f = 0.0;
//   C[1].p.f + R[2].p.f + R[1].n.f = 0.0;
//   C[2].p.f + R[3].p.f + R[2].n.f = 0.0;
//   C[3].p.f + R[4].p.f + R[3].n.f = 0.0;
//   C[4].p.f + R[5].p.f + R[4].n.f = 0.0;
//   C[5].p.f + R[6].p.f + R[5].n.f = 0.0;
//   C[6].p.f + R[7].p.f + R[6].n.f = 0.0;
//   C[7].p.f + R[8].p.f + R[7].n.f = 0.0;
//   C[8].p.f + R[9].p.f + R[8].n.f = 0.0;
//   C[9].p.f + R[10].p.f + R[9].n.f = 0.0;
//   C[10].p.f + R[10].n.f = 0.0;
//   G.n.f = 0.0;
// end ArrayConnect1;
// endResult
