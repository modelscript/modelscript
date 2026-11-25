FUNCTION_BLOCK PlantAlarmManager
  VAR_INPUT
    OverPressure : BOOL := FALSE;
    LowTankLevel : BOOL := FALSE;
    AckButton : BOOL := FALSE;
  END_VAR
  VAR_OUTPUT
    AlarmActive : BOOL := FALSE;
    SirenOn : BOOL := FALSE;
  END_VAR

  IF OverPressure OR LowTankLevel THEN
    AlarmActive := TRUE;
    SirenOn := NOT AckButton;
  ELSE
    AlarmActive := FALSE;
    SirenOn := FALSE;
  END_IF;
END_FUNCTION_BLOCK
