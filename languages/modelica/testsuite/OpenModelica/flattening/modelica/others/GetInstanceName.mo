// name: GetInstanceName
// status: correct
// cflags: -i=O.N

function f
  output String s = getInstanceName();
end f;

package P
  constant String s = getInstanceName();
end P;

model M
  String s1 = getInstanceName();
  String s2 = f();
  String s3 = P.s;
end M;

model O
model P
  M m;
end P;
model N
  M m;
  P p;
end N;
  annotation(__OpenModelica_commandLineOptions="-i=O.N");
end O;

// Result:
// class O
// end O;
// endResult
