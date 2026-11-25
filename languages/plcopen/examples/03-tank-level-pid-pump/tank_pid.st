PROGRAM TankLevelControl
  VAR_INPUT
    LevelPV : REAL := 50.0;
    LevelSP : REAL := 60.0;
    HighLevelSwitch : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    Pump1SpeedPct : REAL := 0.0;
    Pump2BoostRun : BOOL := FALSE;
    HighLevelAlarm : BOOL := FALSE;
  END_VAR
  VAR
    Error : REAL := 0.0;
    IntegralTerm : REAL := 0.0;
    Kp : REAL := 2.2;
    Ki : REAL := 0.15;
    Dt : REAL := 0.1;
    RawCmd : REAL := 0.0;
  END_VAR

  Error := LevelSP - LevelPV;
  IntegralTerm := IntegralTerm + (Ki * Error * Dt);

  IF IntegralTerm > 80.0 THEN
    IntegralTerm := 80.0;
  ELSIF IntegralTerm < 0.0 THEN
    IntegralTerm := 0.0;
  END_IF;

  RawCmd := (Kp * Error) + IntegralTerm;
  IF RawCmd > 100.0 THEN
    Pump1SpeedPct := 100.0;
  ELSIF RawCmd < 0.0 THEN
    Pump1SpeedPct := 0.0;
  ELSE
    Pump1SpeedPct := RawCmd;
  END_IF;

  Pump2BoostRun := (Pump1SpeedPct > 85.0) AND NOT HighLevelSwitch;
  HighLevelAlarm := HighLevelSwitch;
END_PROGRAM
