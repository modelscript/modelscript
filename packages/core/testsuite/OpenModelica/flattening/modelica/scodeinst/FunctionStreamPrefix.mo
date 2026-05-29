// name: FunctionStreamPrefix
// keywords:
// status: correct
//

function f
  stream input Real x;
end f;

model FunctionStreamPrefix
algorithm
  f(1.0);
end FunctionStreamPrefix;

// Result:
// class FunctionStreamPrefix
// end FunctionStreamPrefix;
// endResult
