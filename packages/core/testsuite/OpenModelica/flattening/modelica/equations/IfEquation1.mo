// name: IfEquation1
// status: correct

model IfEquation1
  Real x;
  parameter Boolean b = true;
equation
  if b then
    x = 1.0;
  else
    x = 2.0;
  end if;
end IfEquation1;

// Result:
// class IfEquation1
//   Real x;
//   parameter Boolean b = true;
// equation
//   x = 1.0;
// end IfEquation1;
// endResult
