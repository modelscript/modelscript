// Finned Power-Electronics Heatsink Enclosure (mm)
$fn = 32;

box_len = 120;
box_wid = 80;
box_h = 34;
wall_t = 4;
fin_count = 11;
fin_t = 2.5;
fin_h = 12;
boss_r = 4.5;
screw_r = 1.7;

function fin_pitch(total_w, n, t) = (total_w - t) / (n - 1);

module heatsink_enclosure() {
  pitch = fin_pitch(box_wid, fin_count, fin_t);
  difference() {
    union() {
      cube([box_len, box_wid, box_h]);
      for (i = [0 : fin_count - 1]) {
        translate([0, i * pitch, box_h])
          cube([box_len, fin_t, fin_h]);
      }
    }
    translate([wall_t, wall_t, -1])
      cube([box_len - 2 * wall_t, box_wid - 2 * wall_t, box_h - wall_t + 1]);
  }

  for (x = [wall_t + boss_r, box_len - wall_t - boss_r]) {
    for (y = [wall_t + boss_r, box_wid - wall_t - boss_r]) {
      difference() {
        translate([x, y, 0])
          cylinder(r = boss_r, h = box_h - wall_t);
        translate([x, y, -1])
          cylinder(r = screw_r, h = box_h);
      }
    }
  }
}

heatsink_enclosure();
