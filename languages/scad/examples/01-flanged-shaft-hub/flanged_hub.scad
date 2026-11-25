// Parametric Flanged Shaft Hub (mm)
$fn = 48;

flange_r = 32;
flange_h = 6;
boss_r = 16;
boss_h = 18;
bore_r = 8;
bolt_circle_r = 24;
bolt_hole_r = 2.6;
bolt_count = 6;

module flanged_hub() {
  difference() {
    union() {
      cylinder(r = flange_r, h = flange_h);
      cylinder(r = boss_r, h = boss_h);
    }
    translate([0, 0, -1])
      cylinder(r = bore_r, h = boss_h + 2);
    for (i = [0 : bolt_count - 1]) {
      angle = i * 360 / bolt_count;
      rotate([0, 0, angle])
        translate([bolt_circle_r, 0, -1])
          cylinder(r = bolt_hole_r, h = flange_h + 2);
    }
  }
}

flanged_hub();
