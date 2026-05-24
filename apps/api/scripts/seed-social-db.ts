import bcrypt from "bcryptjs";
import path from "node:path";
import { LibraryDatabase } from "../src/database.js";

const dbDir = path.join(process.cwd(), "data");
const db = new LibraryDatabase(dbDir);

console.log("Seeding social database...");

// 1. Create some users
const users = [
  {
    username: "modelica",
    email: "contact@modelica.org",
    displayName: "Modelica Association",
    bio: "The non-profit organization developing the Modelica Language.",
    avatarUrl: "https://avatars.githubusercontent.com/u/10189397?s=200&v=4",
  },
  {
    username: "sysml_guru",
    email: "sysml@example.com",
    displayName: "SysML v2 Team",
    bio: "Systems engineering at scale.",
    avatarUrl: "https://api.dicebear.com/7.x/identicon/svg?seed=sysml_guru",
  },
  {
    username: "engineer_jane",
    email: "jane@example.com",
    displayName: "Jane Doe",
    bio: "Aerospace engineer. I build rockets.",
    avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=engineer_jane",
  },
  {
    username: "omar",
    email: "omar@modelscript.org",
    displayName: "Omar",
    bio: "Creator of ModelScript.",
    avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=omar",
  },
  {
    username: "dev",
    email: "dev@modelscript.org",
    displayName: "Dev User",
    bio: "Developer testing account.",
    avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=dev",
  },
];

const createdUsers: Record<string, number> = {};

for (const u of users) {
  let existing = db.getUserByUsername(u.username);
  if (!existing) {
    const hash = bcrypt.hashSync("password", 10);
    existing = db.createUser(u.username, u.email, hash);
    console.log(`Created user ${u.username}`);
  }
  db.updateProfile(existing.id, {
    display_name: u.displayName,
    bio: u.bio,
    avatar_url: u.avatarUrl,
    location: "Internet",
    website: "https://modelscript.org",
  });
  createdUsers[u.username] = existing.id;
}

// 2. Setup Follows
db.followUser(createdUsers["engineer_jane"], createdUsers["modelica"]);
db.followUser(createdUsers["engineer_jane"], createdUsers["sysml_guru"]);
db.followUser(createdUsers["sysml_guru"], createdUsers["modelica"]);
db.followUser(createdUsers["omar"], createdUsers["modelica"]);
db.followUser(createdUsers["omar"], createdUsers["engineer_jane"]);

// 3. Create Artifact Views
const artifact1 = db.createArtifactView(
  createdUsers["engineer_jane"],
  "modelica-code",
  "upload",
  JSON.stringify({
    code: "model BouncingBall\n  parameter Real e=0.7;\n  Real h(start=1);\n  Real v;\nend BouncingBall;",
  }),
  "BouncingBall Model",
);

const artifact2 = db.createArtifactView(
  createdUsers["omar"],
  "simulation-plot",
  "upload",
  JSON.stringify({
    model: "BouncingBall",
    variables: ["h", "v"],
    timeRange: [0, 5],
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Bouncing_ball_trajectory.svg/1200px-Bouncing_ball_trajectory.svg.png",
  }),
  "BouncingBall Trajectory",
);

const artifactCad = db.createArtifactView(
  createdUsers["engineer_jane"],
  "cad-step",
  "upload",
  JSON.stringify({
    url: "https://raw.githubusercontent.com/Idered/Three.js-STEP-loader/master/models/test.step",
    thumbnail_url: "https://images.unsplash.com/photo-1537462715879-360eeb61a0ad?auto=format&fit=crop&q=80&w=600",
  }),
  "Suspension Assembly CAD",
);

const artifactVid = db.createArtifactView(
  createdUsers["modelica"],
  "video",
  "upload",
  JSON.stringify({
    url: "https://www.w3schools.com/html/mov_bbb.mp4",
    thumbnail_url: "https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&q=80&w=600",
  }),
  "Modelica Conference 2026 Keynote",
);

const artifactImg = db.createArtifactView(
  createdUsers["sysml_guru"],
  "picture",
  "upload",
  JSON.stringify({
    url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=600",
    thumbnail_url: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=600",
  }),
  "System Architecture Diagram",
);

const artifactPdf = db.createArtifactView(
  createdUsers["dev"],
  "pdf",
  "upload",
  JSON.stringify({
    url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
    thumbnail_url: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=600",
  }),
  "FMI 3.0 Standard Specification",
);

const artifactDiag = db.createArtifactView(
  createdUsers["omar"],
  "modelica-diagram",
  "upload",
  JSON.stringify({
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Circuit_diagram_-_RC_series_AC.svg/640px-Circuit_diagram_-_RC_series_AC.svg.png",
  }),
  "Electrical Subsystem Diagram",
);

// 4. Create Posts
const post1 = db.createPost(
  createdUsers["modelica"],
  "We are excited to announce Modelica 3.5! Lots of great new features for multi-domain modeling.",
);
const post2 = db.createPost(
  createdUsers["engineer_jane"],
  "Just finished simulating the new suspension system. Modelica makes this so easy!",
  artifact1,
);
const post3 = db.createPost(
  createdUsers["sysml_guru"],
  "System integration is key. Here is how SysML interacts with our FMUs.",
);
const post4 = db.createPost(
  createdUsers["omar"],
  "Look at this simulation trajectory for the bouncing ball!",
  artifact2,
);
db.createPost(
  createdUsers["engineer_jane"],
  "Check out the new suspension assembly we'll be simulating today.",
  artifactCad,
);
db.createPost(createdUsers["modelica"], "Missed the keynote? Watch the full recap video here:", artifactVid);
db.createPost(createdUsers["sysml_guru"], "Working on the new high-level architecture diagram.", artifactImg);
db.createPost(createdUsers["dev"], "I've attached the FMI 3.0 spec for reference.", artifactPdf);
db.createPost(createdUsers["omar"], "Here is a quick electrical subsystem diagram I sketched up.", artifactDiag);

// 5. Interactions
db.toggleLike(createdUsers["omar"], post1.id);
db.toggleLike(createdUsers["sysml_guru"], post2.id);
db.toggleRepost(createdUsers["omar"], post3.id);
db.createPost(createdUsers["engineer_jane"], "This is awesome!", undefined, post4.id); // Reply

// 6. Dummy Packages
console.log("Creating dummy packages...");
db.db.exec(`
  INSERT OR IGNORE INTO packages (name, description, repository_type, repository_url) VALUES ('Modelica', 'The Standard Modelica Library', 'git', 'https://github.com/modelica/ModelicaStandardLibrary');
`);
const pkg = db.db.prepare(`SELECT id FROM packages WHERE name = 'Modelica'`).get() as { id: number };
db.db.exec(`
  INSERT OR IGNORE INTO package_versions (package_id, version, tarball_path, tarball_shasum, tarball_size, manifest, published_by) 
  VALUES (${pkg.id}, '4.0.0', '/tmp/dummy.tgz', 'dummy_sha', 1024, '{}', ${createdUsers["modelica"]});
  
  INSERT OR IGNORE INTO package_versions (package_id, version, tarball_path, tarball_shasum, tarball_size, manifest, published_by) 
  VALUES (${pkg.id}, '3.2.3', '/tmp/dummy2.tgz', 'dummy_sha2', 1024, '{}', ${createdUsers["modelica"]});

  INSERT OR IGNORE INTO dist_tags (package_id, tag, version) VALUES (${pkg.id}, 'latest', '4.0.0');
`);

// 7. Linked Repositories for Dev User
console.log("Linking repositories to dev user...");
db.linkRepo(
  createdUsers["dev"],
  "github",
  "12345",
  "modelica/ModelicaStandardLibrary",
  "master",
  "The official Modelica Standard Library",
);
db.linkRepo(
  createdUsers["dev"],
  "gitlab",
  "67890",
  "modelscript/compiler",
  "main",
  "Salsa-powered Modelica compiler and simulation engine",
);
db.linkRepo(
  createdUsers["dev"],
  "github",
  "11111",
  "modelscript/web",
  "main",
  "Frontend social workspace for ModelScript",
);
db.linkRepo(
  createdUsers["dev"],
  "github",
  "22222",
  "modelica-association/FMI-Standard",
  "master",
  "Functional Mock-up Interface standard definitions",
);

console.log("Database seeded successfully!");
