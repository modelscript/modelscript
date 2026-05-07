// name: VectorizeBindings5
// keywords:
// status: correct
//

model Failing
  parameter Boolean initialEquation = true;
  Real pOut(start=0);
initial equation
  if initialEquation then
    pOut = 1;
  end if;
equation
  der(pOut) = sin(time);
end Failing;

model Module
  parameter Boolean initialEquation = true;
  Failing f(initialEquation = initialEquation);
end Module;

model VectorizeBindings5
  parameter Integer N = 2;
  parameter Boolean initialEquation[N] = fill(true,N);
  Module module[N](initialEquation = initialEquation);
end VectorizeBindings5;

// Result:
// class VectorizeBindings5
//   final parameter Integer N = 2;
//   final parameter Boolean initialEquation[1] = true;
//   final parameter Boolean initialEquation[2] = true;
//   final parameter Boolean module[1].initialEquation = true;
//   final parameter Boolean module[1].f.initialEquation = true;
//   Real module[1].f.pOut(start = 0.0);
//   final parameter Boolean module[2].initialEquation = true;
//   final parameter Boolean module[2].f.initialEquation = true;
//   Real module[2].f.pOut(start = 0.0);
// initial equation
//   module[1].f.pOut = 1.0;
//   module[2].f.pOut = 1.0;
// equation
//   der(module[1].f.pOut) = sin(time);
//   der(module[2].f.pOut) = sin(time);
// end VectorizeBindings5;
// endResult
