// name: ConferenceTut1
// keywords: state machines features
// status: correct

model ConferenceTut1
  inner Integer i(start=0);
  model State1
  outer output Integer i;
  equation
    i = previous(i) + 2;
  end State1;
  State1 state1;
  model State2
  outer output Integer i;
  equation
    i = previous(i) - 1;
  end State2;
  State2 state2;
equation
  initialState(state1);
  transition(
    state1,
    state2,
    i > 10,
    immediate=false);
  transition(
    state2,
    state1,
    i < 1,
    immediate=false);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ConferenceTut1;


// Result:
// class ConferenceTut1
//   Integer i(start = 0);
//   stateMachine state1
//     state state1
//       equation
//         /*Real*/(i) = 2.0 + previous(i);
//     end state1;
//     state state2
//       equation
//         /*Real*/(i) = -1.0 + previous(i);
//     end state2;
//     equation
//       initialState(state1);
//       transition(state1, state2, i > 10, false, true, false, 1);
//       transition(state2, state1, i < 1, false, true, false, 1);
//   end state1;
// end ConferenceTut1;
// endResult
