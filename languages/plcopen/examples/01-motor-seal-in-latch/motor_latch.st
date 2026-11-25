PROGRAM MotorStarterLatch
  VAR_INPUT
    StartPB : BOOL := FALSE;
    StopPB : BOOL := TRUE;
    OverloadTrip : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    MotorContactor : BOOL := FALSE;
    FaultLamp : BOOL := FALSE;
  END_VAR

  MotorContactor := (StartPB OR MotorContactor) AND StopPB AND NOT OverloadTrip;
  FaultLamp := OverloadTrip;
END_PROGRAM
