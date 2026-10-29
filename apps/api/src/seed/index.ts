// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { LibraryDatabase } from "../database.js";
import { pregenerateServerSvgThumbnail } from "../services/artifact-preprocessor.js";
import { AEROSPACE_PROPULSION_POSTS } from "./artifacts-catalog/aerospace-propulsion.js";
import { CAE_CAD_MANUFACTURING_POSTS } from "./artifacts-catalog/cae-cad-manufacturing.js";
import { CONTROL_COMPUTING_BIO_POSTS } from "./artifacts-catalog/control-computing-bio.js";
import { FLUIDS_PROCESS_ENERGY_POSTS } from "./artifacts-catalog/fluids-process-energy.js";
import { MULTIBODY_ROBOTICS_POSTS } from "./artifacts-catalog/multibody-robotics.js";
import { POWER_ELECTRONICS_POSTS } from "./artifacts-catalog/power-electronics.js";
import { SYSTEMS_ONTOLOGICAL_POSTS } from "./artifacts-catalog/systems-ontological.js";
import { SEED_FOLLOW_PAIRS, SEED_PERSONAS } from "./personas.js";
import type { SeedPostSpec } from "./types.js";

const SEED_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SEED_DIR, "../..");

export { SEED_FOLLOW_PAIRS, SEED_PERSONAS, type SeedPersona } from "./personas.js";
export type { SeedComment, SeedCommentReply, SeedPostSpec } from "./types.js";

/**
 * Complete catalog of 44 flagship engineering posts and artifacts — one for every
 * language supported in `languages/*`.
 */
export const ALL_44_LANGUAGE_SEED_POSTS: SeedPostSpec[] = [
  ...SYSTEMS_ONTOLOGICAL_POSTS,
  ...POWER_ELECTRONICS_POSTS,
  ...FLUIDS_PROCESS_ENERGY_POSTS,
  ...MULTIBODY_ROBOTICS_POSTS,
  ...AEROSPACE_PROPULSION_POSTS,
  ...CAE_CAD_MANUFACTURING_POSTS,
  ...CONTROL_COMPUTING_BIO_POSTS,
];

function hoursAgoSqliteTimestamp(hoursAgo: number): string {
  const ms = Date.now() - Math.max(0, hoursAgo) * 3_600_000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/**
 * Seeds the 20 engineering personas, their follow graph, and flagship linked repositories.
 * Idempotent: safe to run on every server startup or dev reset.
 */
export function seedPolyglotUsers(db: LibraryDatabase): Map<string, number> {
  let passwordHash: string | null = null;
  const userIds = new Map<string, number>();

  for (const persona of SEED_PERSONAS) {
    let existing = db.getUserByUsername(persona.username);
    if (!existing) {
      if (!passwordHash) {
        passwordHash = bcrypt.hashSync("password", 4);
      }
      const created = db.createUser(persona.username, persona.email, passwordHash, {
        emailVerified: true,
        initialCredits: persona.initialCredits ?? (persona.accountType === "admin" ? 5000.0 : 1500.0),
        accountType: persona.accountType ?? "user",
        status: "active",
      });
      existing = db.getUserById(created.id);
    }
    if (!existing) continue;

    userIds.set(persona.username, existing.id);

    if (persona.accountType === "admin" && existing.account_type !== "admin") {
      db.setUserAccountType(existing.id, "admin");
    }

    if (
      existing.display_name !== persona.displayName ||
      existing.bio !== persona.bio ||
      existing.location !== persona.location ||
      existing.website !== persona.website ||
      existing.avatar_url !== persona.avatarSvg ||
      existing.banner_url !== persona.bannerSvg
    ) {
      db.updateProfile(existing.id, {
        display_name: persona.displayName,
        bio: persona.bio,
        location: persona.location,
        website: persona.website,
        avatar_url: persona.avatarSvg,
        banner_url: persona.bannerSvg,
      });
    }
  }

  for (const [followerUsername, followingUsername] of SEED_FOLLOW_PAIRS) {
    const followerId = userIds.get(followerUsername);
    const followingId = userIds.get(followingUsername);
    if (followerId && followingId && followerId !== followingId) {
      db.followUser(followerId, followingId);
    }
  }

  const flagshipRepos: {
    owner: string;
    provider: string;
    externalId: string;
    fullName: string;
    branch: string;
    description: string;
    avatarUrl?: string;
  }[] = [
    {
      owner: "omar",
      provider: "github",
      externalId: "seed-repo-aether-flight",
      fullName: "modelica/ModelicaStandardLibrary",
      branch: "master",
      description:
        "Free standard-conforming Modelica library for mechanical (1D/3D), electrical, magnetic, thermal, fluid, control systems, and state machines.",
      avatarUrl: "https://avatars.githubusercontent.com/u/3016309?v=4",
    },
    {
      owner: "omar",
      provider: "github",
      externalId: "seed-repo-sysml2-release",
      fullName: "Systems-Modeling/SysML-v2-Release",
      branch: "master",
      description:
        "Official OMG Systems Modeling Language (SysML v2) and KerML standard specification, metamodel, and reference systems models.",
      avatarUrl: "https://avatars.githubusercontent.com/u/42151535?v=4",
    },
    {
      owner: "omar",
      provider: "gitlab",
      externalId: "seed-repo-eigen-gitlab",
      fullName: "libeigen/eigen",
      branch: "master",
      description:
        "Eigen C++ template library for linear algebra: sparse/dense matrices, numerical DAE/ODE solvers, and decomposition algorithms.",
      avatarUrl: "/ms-logo.png",
    },
    {
      owner: "elena_vance",
      provider: "github",
      externalId: "seed-repo-orbiter-tvc",
      fullName: "OpenModelica/OpenModelica",
      branch: "master",
      description:
        "OpenModelica open-source Modelica modeling, DAE index-reduction, compilation, and multi-domain simulation environment.",
      avatarUrl: "https://avatars.githubusercontent.com/u/1693152?v=4",
    },
    {
      owner: "marcus_chen",
      provider: "github",
      externalId: "seed-repo-hvdc-emt",
      fullName: "modelica/fmi-standard",
      branch: "main",
      description:
        "Specification of the Functional Mock-up Interface (FMI 2.0 & 3.0) for model exchange and co-simulation.",
      avatarUrl: "https://avatars.githubusercontent.com/u/3016309?v=4",
    },
    {
      owner: "claire_dubois",
      provider: "gitlab",
      externalId: "seed-repo-iso26262-sbw",
      fullName: "graphviz/graphviz",
      branch: "main",
      description:
        "Graphviz open-source graph visualization and hierarchical schematic layout engine (DOT, Sugiyama auto-routing).",
      avatarUrl: "/avatars/claire_dubois.png",
    },
    {
      owner: "kenji_takahashi",
      provider: "github",
      externalId: "seed-repo-aether-cobot",
      fullName: "openscad/openscad",
      branch: "master",
      description:
        "OpenSCAD — The Programmers Solid 3D CAD Modeller for parametric CSG mechanical components and robotic kinematics.",
      avatarUrl: "https://avatars.githubusercontent.com/u/1059366?v=4",
    },
    {
      owner: "priya_nair",
      provider: "github",
      externalId: "seed-repo-methanation-process",
      fullName: "su2code/SU2",
      branch: "master",
      description:
        "SU2: Open-source multiphysics PDE solver suite for computational fluid dynamics (CFD) and aerodynamic shape optimization.",
      avatarUrl: "https://avatars.githubusercontent.com/u/5622854?v=4",
    },
    {
      owner: "astrid_solberg",
      provider: "gitlab",
      externalId: "seed-repo-inkscape-gitlab",
      fullName: "inkscape/inkscape",
      branch: "master",
      description:
        "Inkscape professional vector graphics editor and SVG standards rendering engine for technical schematics.",
      avatarUrl: "/avatars/astrid_solberg.png",
    },
  ];

  for (const repo of flagshipRepos) {
    const ownerId = userIds.get(repo.owner);
    if (ownerId) {
      db.linkRepo(
        ownerId,
        repo.provider,
        repo.externalId,
        repo.fullName,
        repo.branch,
        repo.description,
        repo.avatarUrl,
      );
    }
  }

  return userIds;
}

function indexPostHashtags(db: LibraryDatabase, postId: number, content: string): void {
  const hashtagMatches = content.match(/#[a-zA-Z0-9_]+/g);
  if (!hashtagMatches) return;
  const seen = new Set<string>();
  for (const rawTag of hashtagMatches) {
    const display = rawTag.slice(1);
    const concept = display.toLowerCase();
    if (!concept || seen.has(concept)) continue;
    seen.add(concept);
    const topicId = db.updateTopicScore(concept, display, 10);
    db.linkPostToTopic(postId, topicId);
  }
}

export interface SeedPolyglotSummary {
  usersSeeded: number;
  postsCreated: number;
  artifactsCreated: number;
  commentsCreated: number;
}

/**
 * Seeds all 44 polyglot engineering language artifacts, posts, multi-turn peer review
 * comments, nested replies, likes, reposts, bookmarks, and forked parameter-delta posts.
 * Idempotent: skips any artifact whose title already exists unless `options.force` is true.
 */
export async function seedPolyglotSocialData(
  db: LibraryDatabase,
  options?: { uploadDir?: string | undefined; force?: boolean | undefined },
): Promise<SeedPolyglotSummary> {
  const userIds = seedPolyglotUsers(db);
  const uploadDir = options?.uploadDir ?? path.join(API_ROOT, "data", "uploads");
  fs.mkdirSync(uploadDir, { recursive: true });

  let postsCreated = 0;
  let artifactsCreated = 0;
  let commentsCreated = 0;

  const createdPostByLanguage = new Map<string, { postId: number; artifactViewId: number; spec: SeedPostSpec }>();

  for (const spec of ALL_44_LANGUAGE_SEED_POSTS) {
    const existingArtifact = db.getArtifactViewByTitle(spec.title);
    if (existingArtifact && !options?.force) {
      continue;
    }

    const language = (spec.language ?? spec.languageId ?? "modelica").trim();
    const authorUsername = (spec.authorUsername ?? spec.author ?? "omar").trim();
    const postHoursAgo = spec.createdHoursAgo ?? spec.hoursAgo ?? 24;

    const authorId = userIds.get(authorUsername) ?? userIds.get("omar") ?? 1;
    const filePath = path.join(uploadDir, spec.filename);
    fs.writeFileSync(filePath, spec.code, "utf8");

    const pre = await pregenerateServerSvgThumbnail(filePath, spec.viewType, spec.filename, uploadDir);

    const viewConfig: Record<string, unknown> = {
      code: spec.code,
      title: spec.title,
      filename: spec.filename,
      language,
      url: `/uploads/${spec.filename}`,
      standalone: true,
      ...(pre.svg ? { svg: pre.svg } : {}),
      ...(pre.thumbnailUrl
        ? {
            thumbnailUrl: pre.thumbnailUrl,
            thumbnailUrlLight: pre.thumbnailUrl,
            thumbnailUrlDark: pre.thumbnailUrl,
          }
        : {}),
      ...(pre.viewConfigAdditions ?? {}),
      ...(spec.extraViewConfig ?? {}),
    };

    const artifactViewId = db.createArtifactView(
      authorId,
      spec.viewType,
      "upload",
      JSON.stringify(viewConfig),
      spec.title,
      pre.thumbnailUrl,
    );
    artifactsCreated++;

    const langTag = language.replace(/[^a-zA-Z0-9]/g, "");
    const fullPostContent = spec.postContent.includes("#ModelScript")
      ? spec.postContent
      : `${spec.postContent}\n\n#${langTag} #ModelScript #Engineering`;
    const createdAt = hoursAgoSqliteTimestamp(postHoursAgo);

    const { id: postId } = db.createPost(
      authorId,
      fullPostContent,
      artifactViewId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      createdAt,
      createdAt,
      {
        language,
        artifactTitle: spec.title,
        filename: spec.filename,
      },
    );
    postsCreated++;
    createdPostByLanguage.set(language, { postId, artifactViewId, spec });

    indexPostHashtags(db, postId, fullPostContent);

    for (const likerUsername of spec.likedBy) {
      const likerId = userIds.get(likerUsername);
      if (likerId) {
        db.likePost(likerId, postId);
      }
    }

    for (const reposterUsername of spec.repostedBy ?? []) {
      const reposterId = userIds.get(reposterUsername);
      if (reposterId) {
        db.toggleRepost(reposterId, postId);
      }
    }

    for (const bookmarkerUsername of spec.bookmarkedBy ?? []) {
      const bookmarkerId = userIds.get(bookmarkerUsername);
      if (bookmarkerId) {
        db.toggleBookmark(bookmarkerId, postId);
      }
    }

    const effectiveComments =
      spec.comments.length >= 2
        ? spec.comments
        : [
            ...spec.comments,
            {
              authorUsername: authorUsername === "omar" ? "elena_vance" : "omar",
              content: `Clean ${language.toUpperCase()} artifact baseline for \`${spec.filename}\` — verified the extracted Studio Inspector metadata and vector schematic preview in the workspace.`,
              likedBy: [authorUsername, "claire_dubois"],
              replies: [
                {
                  authorUsername,
                  content: `Thanks! All boundary conditions and solver tolerances in \`${spec.filename}\` are locked for reproducible regression runs.`,
                  likedBy: ["omar", "elena_vance"],
                },
              ],
            },
          ];

    for (const [commentIdx, comment] of effectiveComments.entries()) {
      const commentAuthorUsername = (comment.authorUsername ?? comment.author ?? "omar").trim();
      const commentAuthorId = userIds.get(commentAuthorUsername) ?? userIds.get("omar") ?? 1;
      const commentHoursAgo = comment.createdHoursAgo ?? Math.max(1, postHoursAgo - (commentIdx + 1) * 2);
      const commentCreatedAt = hoursAgoSqliteTimestamp(commentHoursAgo);
      const { id: commentId } = db.createPost(
        commentAuthorId,
        comment.content,
        undefined,
        postId,
        undefined,
        undefined,
        undefined,
        undefined,
        commentCreatedAt,
        commentCreatedAt,
      );
      commentsCreated++;

      for (const likerUsername of comment.likedBy ?? [authorUsername, "omar"]) {
        const likerId = userIds.get(likerUsername);
        if (likerId) {
          db.likePost(likerId, commentId);
        }
      }

      if (comment.replies) {
        for (const [replyIdx, reply] of comment.replies.entries()) {
          const replyAuthorUsername = (reply.authorUsername ?? reply.author ?? authorUsername).trim();
          const replyAuthorId = userIds.get(replyAuthorUsername) ?? authorId;
          const replyHoursAgo = reply.createdHoursAgo ?? Math.max(1, commentHoursAgo - (replyIdx + 1));
          const replyCreatedAt = hoursAgoSqliteTimestamp(replyHoursAgo);
          const { id: replyId } = db.createPost(
            replyAuthorId,
            reply.content,
            undefined,
            commentId,
            undefined,
            undefined,
            undefined,
            undefined,
            replyCreatedAt,
            replyCreatedAt,
          );
          commentsCreated++;

          for (const replyLiker of reply.likedBy ?? [commentAuthorUsername]) {
            const replyLikerId = userIds.get(replyLiker);
            if (replyLikerId) {
              db.likePost(replyLikerId, replyId);
            }
          }
        }
      }
    }
  }

  // Seed a forked parameter-delta post demonstrating social design iteration
  const modelicaEntry = createdPostByLanguage.get("modelica");
  const forkTitle1 = "ElectroHydrostaticActuator — High-Bandwidth Stiff Bulk Modulus Variant (Fork)";
  if (modelicaEntry && !db.getArtifactViewByTitle(forkTitle1)) {
    const omarId = userIds.get("omar") ?? 1;
    const baseView = db.getArtifactView(modelicaEntry.artifactViewId);
    const baseConfig = baseView?.view_config ? (JSON.parse(baseView.view_config) as Record<string, unknown>) : {};
    const forkedCode = modelicaEntry.spec.code
      .replace("parameter Real Kp_pos = 1.80e4", "parameter Real Kp_pos = 2.40e4")
      .replace("parameter Real beta_oil = 1.20e9", "parameter Real beta_oil = 1.45e9")
      .replace("parameter Real C_leak = 2.10e-12", "parameter Real C_leak = 1.20e-12");
    const forkConfig: Record<string, unknown> = {
      ...baseConfig,
      title: forkTitle1,
      code: forkedCode,
      forkedFromId: modelicaEntry.artifactViewId,
      forkedFromPostId: modelicaEntry.postId,
      modifiedParametersCount: 3,
      parameterDeltas: [
        { name: "Kp_pos", oldValue: "1.80e4", newValue: "2.40e4", unit: "rad/(s.m)" },
        { name: "beta_oil", oldValue: "1.20e9", newValue: "1.45e9", unit: "Pa" },
        { name: "C_leak", oldValue: "2.10e-12", newValue: "1.20e-12", unit: "m3/(s.Pa)" },
      ],
    };
    const forkArtifactId = db.createArtifactView(
      omarId,
      modelicaEntry.spec.viewType,
      "upload",
      JSON.stringify(forkConfig),
      forkTitle1,
      baseView?.thumbnail_url ?? undefined,
    );
    artifactsCreated++;

    const forkCreatedAt = hoursAgoSqliteTimestamp(1);
    const forkContent =
      "Forked @elena_vance's primary flight control EHA Modelica model (`ElectroHydrostaticActuator.mo`) and increased position loop proportional gain `Kp_pos` from `1.80e4` to `2.40e4 rad/(s·m)` with degassed Skydrol bulk modulus `beta_oil = 1.45e9 Pa` and reduced internal cross-port laminar leakage `C_leak = 1.20e-12 m³/(s·Pa)`.\n\n#modelica #ParameterSweep #FlightControl #ModelScript";
    const { id: forkPostId } = db.createPost(
      omarId,
      forkContent,
      forkArtifactId,
      undefined,
      modelicaEntry.postId,
      undefined,
      undefined,
      undefined,
      forkCreatedAt,
      forkCreatedAt,
      {
        forkedFromId: modelicaEntry.artifactViewId,
        forkedFromPostId: modelicaEntry.postId,
        parameterDeltas: forkConfig["parameterDeltas"],
      },
    );
    postsCreated++;
    indexPostHashtags(db, forkPostId, forkContent);
    for (const u of ["elena_vance", "claire_dubois", "mateo_silva", "kenji_takahashi"]) {
      const uid = userIds.get(u);
      if (uid) db.likePost(uid, forkPostId);
    }
  }

  return {
    usersSeeded: userIds.size,
    postsCreated,
    artifactsCreated,
    commentsCreated,
  };
}
