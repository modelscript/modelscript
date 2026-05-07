// name: ArrayConnect4
// keywords:
// status: correct
//

connector Port
  Real v;
  flow Real i;
end Port;

model M
  Port port;
equation
  port.v = 10 * port.i;
end M;

model S
  parameter Integer N = 3;
  M m[N];
equation
  for i in 1:N-1 loop
    connect(m[i].port, m[i+1].port);
  end for;
end S;

// Result:
// class S
//   final parameter Integer N = 3;
//   Real m[1].port.v;
//   Real m[1].port.i;
//   Real m[2].port.v;
//   Real m[2].port.i;
//   Real m[3].port.v;
//   Real m[3].port.i;
// equation
//   m[2].port.v = m[3].port.v;
//   m[2].port.v = m[1].port.v;
//   m[3].port.i + m[2].port.i + m[1].port.i = 0.0;
//   m[1].port.v = 10.0 * m[1].port.i;
//   m[2].port.v = 10.0 * m[2].port.i;
//   m[3].port.v = 10.0 * m[3].port.i;
// end S;
// endResult
