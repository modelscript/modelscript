// Outer ring gear housing module
module gearbox_housing(outer_r = 40.0, inner_r = 31.0, height = 16.0) {
  difference() {
    cylinder(r = outer_r, h = height, $fn = 48);
    translate([0, 0, -1])
      cylinder(r = inner_r, h = height + 2, $fn = 48);
    for (k = [0 : 5]) {
      rotate([0, 0, k * 60])
        translate([outer_r - 4.5, 0, -1])
          cylinder(r = 2.1, h = height + 2, $fn = 18);
    }
  }
}
