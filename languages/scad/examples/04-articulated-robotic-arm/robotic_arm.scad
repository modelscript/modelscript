// Articulated 3-DOF Industrial Robotic Arm (mm)
$fn = 36;

base_angle = 25;
shoulder_angle = 35;
elbow_angle = -45;
link1_len = 160;
link2_len = 130;

module arm_link(length, width, thickness) {
  difference() {
    union() {
      cylinder(r = width / 2, h = thickness);
      translate([0, -width / 2, 0])
        cube([length, width, thickness]);
      translate([length, 0, 0])
        cylinder(r = width / 2, h = thickness);
    }
    translate([0, 0, -1])
      cylinder(r = width * 0.25, h = thickness + 2);
    translate([length, 0, -1])
      cylinder(r = width * 0.25, h = thickness + 2);
  }
}

module parallel_gripper() {
  cube([28, 36, 16], center = true);
  translate([24, 12, 0])
    cube([26, 6, 12], center = true);
  translate([24, -12, 0])
    cube([26, 6, 12], center = true);
}

module robot_arm() {
  cylinder(r = 55, h = 20);
  translate([0, 0, 20])
    rotate([0, 0, base_angle]) {
      cylinder(r = 32, h = 45);
      translate([0, 0, 45])
        rotate([90, -shoulder_angle, 0]) {
          arm_link(link1_len, 32, 22);
          translate([link1_len, 0, 22])
            rotate([0, 0, elbow_angle]) {
              arm_link(link2_len, 26, 18);
              translate([link2_len + 14, 0, 9])
                parallel_gripper();
            }
        }
    }
}

robot_arm();
