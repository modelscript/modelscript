// Parametric Metric Spur Gear Generator (mm)
$fn = 36;

module_m = 2.0;
teeth = 24;
face_width = 10.0;
bore_dia = 10.0;
keyway_w = 3.0;
keyway_d = 1.5;

function pitch_radius(m, z) = (m * z) / 2.0;
function root_radius(m, z) = pitch_radius(m, z) - 1.25 * m;

module spur_gear(m = 2.0, z = 24, width = 10.0, bore = 10.0) {
  r_pitch = pitch_radius(m, z);
  r_root = root_radius(m, z);
  tooth_h = 2.25 * m;
  tooth_w = 1.45 * m;

  difference() {
    union() {
      cylinder(r = r_root, h = width);
      for (i = [0 : z - 1]) {
        rotate([0, 0, i * 360 / z])
          translate([r_root - 0.3, -tooth_w / 2, 0])
            cube([tooth_h + 0.3, tooth_w, width]);
      }
    }
    translate([0, 0, -1])
      cylinder(r = bore / 2, h = width + 2);
    translate([bore / 2 - 0.5, -keyway_w / 2, -1])
      cube([keyway_d + 0.5, keyway_w, width + 2]);
  }
}

spur_gear(m = module_m, z = teeth, width = face_width, bore = bore_dia);
