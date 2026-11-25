PROGRAM PackagingLineMain
  VAR_INPUT
    EStopHealthy : BOOL := TRUE;
    GuardClosed : BOOL := TRUE;
    StartCmd : BOOL := FALSE;
    StopCmd : BOOL := FALSE;
    CartonReady : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    StateCode : INT := 0;
    SealHeaterOn : BOOL := FALSE;
    DriveEnable : BOOL := FALSE;
  END_VAR
  VAR
    SafetyOk : BOOL := FALSE;
    WarmupDone : BOOL := FALSE;
    WarmupTimer : TON;
  END_VAR

  SafetyOk := EStopHealthy AND GuardClosed;

  IF NOT SafetyOk THEN
    StateCode := 99;
    DriveEnable := FALSE;
    SealHeaterOn := FALSE;
  ELSE
    CASE StateCode OF
      0:
        DriveEnable := FALSE;
        IF StartCmd THEN
          StateCode := 10;
        END_IF;
      10:
        SealHeaterOn := TRUE;
        WarmupTimer(IN := TRUE, PT := T#5s, Q => WarmupDone);
        IF WarmupDone THEN
          StateCode := 20;
        END_IF;
      20:
        DriveEnable := CartonReady;
        IF StopCmd THEN
          StateCode := 0;
        END_IF;
      99:
        IF NOT StartCmd THEN
          StateCode := 0;
        END_IF;
    END_CASE;
  END_IF;
END_PROGRAM
