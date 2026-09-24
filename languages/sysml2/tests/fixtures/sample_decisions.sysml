// SPDX-License-Identifier: AGPL-3.0-or-later

action def CruiseControl {
  in speed : Real;
  decide d1;
  action lowSpeed;
  action midSpeed;
  action highSpeed;

  first d1 then lowSpeed if speed < 30;
  first d1 then midSpeed if speed >= 30 and speed <= 70;
  first d1 then highSpeed if speed > 70;
}
