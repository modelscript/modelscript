// Reusable spur gear library module
module parametric_gear(m = 1.5, z = 16, width = 12.0, bore_r = 4.0) {
  r_root = (m * z) / 2.0 - 1.15 * m;
  tooth_h = 2.15 * m;
  tooth_w = 1.4 * m;

  difference() {
    union() {
      cylinder(r = r_root, h = width, $fn = 36);
      for (i = [0 : z - 1]) {
        rotate([0, 0, i * 360 / z])
          translate([r_root - 0.2, -tooth_w / 2, 0])
            cube([tooth_h + 0.2, tooth_w, width]);
      }
    }
    translate([0, 0, -1])
      cylinder(r = bore_r, h = width + 2, $fn = 24);
  }
}
