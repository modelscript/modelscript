// name: WhenInitial3
// keywords:
// status: correct
//

model WhenInitial3
  Integer i;
equation
  when not initial() then
    i = 1;
  end when;
end WhenInitial3;

// Result:
// class WhenInitial3
//   Integer i;
// equation
//   when not initial() then
//     i = 1;
//   end when;
// end WhenInitial3;
// endResult
