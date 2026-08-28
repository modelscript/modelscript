// name: InitialStateTest
// keywords: state machines features
// status: wrong

model InitialStateTest
  block AState
  output Real dummy;
  end AState;
  AState aState;
equation
  initialState(aState);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end InitialStateTest;

// Result:
// class InitialStateTest
// stateMachine aState
//   state aState
//       output Real aState.dummy;
//   end aState;
//   equation
//     initialState(aState);
// end aState;
// end InitialStateTest;
// endResult
