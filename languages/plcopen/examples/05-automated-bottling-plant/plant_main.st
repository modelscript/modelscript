PROGRAM BottlingPlantMain
  VAR_INPUT
    LineAutoMode : BOOL := TRUE;
    BottleAtFiller : BOOL := FALSE;
    FillerPressureBar : REAL := 2.4;
    EmergencyStop : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    MainConveyorRun : BOOL := FALSE;
    FillValveOpen : BOOL := FALSE;
    CapperEngage : BOOL := FALSE;
    BottlesFilled : INT := 0;
  END_VAR
  VAR
    FillDone : BOOL := FALSE;
    FillTimer : TON;
    PressureError : REAL := 0.0;
    TargetPressureBar : REAL := 2.5;
  END_VAR

  IF EmergencyStop THEN
    MainConveyorRun := FALSE;
    FillValveOpen := FALSE;
    CapperEngage := FALSE;
  ELSE
    PressureError := TargetPressureBar - FillerPressureBar;
    MainConveyorRun := LineAutoMode AND NOT BottleAtFiller;
    FillTimer(IN := BottleAtFiller, PT := T#1500ms, Q => FillDone);
    FillValveOpen := BottleAtFiller AND NOT FillDone;
    CapperEngage := FillDone;

    IF FillDone THEN
      BottlesFilled := BottlesFilled + 1;
    END_IF;
  END_IF;
END_PROGRAM
