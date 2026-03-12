#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function getInput(name, fallback = "") {
  const key = `INPUT_${name.toUpperCase().replace(/-/g, "_")}`;
  return (process.env[key] ?? fallback).trim();
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set");
  }
  fs.appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0) {
    const cmd = `git ${args.join(" ")}`;
    const stderr = (result.stderr || "").trim();
    throw new Error(`Command failed: ${cmd}${stderr ? `\n${stderr}` : ""}`);
  }

  return (result.stdout || "").trim();
}

function parseEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }
}

function parseVersion(versionText) {
  const match = versionText.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function findLatestTag(cwd, tagPrefix) {
  const allTags = git(["tag", "--list"], { cwd })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rx = new RegExp(`^${escapeRegex(tagPrefix)}(\\d+\\.\\d+\\.\\d+)$`);

  const parsed = allTags
    .map((tag) => {
      const match = tag.match(rx);
      if (!match) return null;
      const parsedVersion = parseVersion(match[1]);
      if (!parsedVersion) return null;
      return { tag, version: parsedVersion };
    })
    .filter(Boolean);

  if (parsed.length === 0) {
    return null;
  }

  parsed.sort((left, right) => compareVersions(right.version, left.version));
  return parsed[0];
}

function determineRange(eventName, payload, latestTag) {
  if (eventName === "pull_request" && payload?.pull_request?.base?.sha && payload?.pull_request?.head?.sha) {
    return {
      range: `${payload.pull_request.base.sha}..${payload.pull_request.head.sha}`,
      mode: "pull_request",
    };
  }

  if (eventName === "push" && payload?.before && payload?.after && payload.before !== "0000000000000000000000000000000000000000") {
    return {
      range: `${payload.before}..${payload.after}`,
      mode: "push",
    };
  }

  if (latestTag?.tag) {
    return {
      range: `${latestTag.tag}..HEAD`,
      mode: "since_latest_tag",
    };
  }

  return {
    range: "HEAD",
    mode: "head_only",
  };
}

function getCommitPathFilter(cwd) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], { cwd });
  const relativePath = path.relative(repoRoot, cwd);

  if (!relativePath || relativePath === ".") {
    return null;
  }

  // Git pathspecs should use POSIX separators.
  return relativePath.split(path.sep).join("/");
}

function collectCommits(cwd, range, commitPathFilter) {
  const separatorCommit = "\u001e";
  const separatorField = "\u001f";

  const args = ["log", "--format=%H%x1f%s%x1f%b%x1e", "--no-merges", range];
  if (commitPathFilter) {
    args.push("--", commitPathFilter);
  }

  const raw = git(args, { cwd });
  if (!raw) {
    return [];
  }

  return raw
    .split(separatorCommit)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = "", body = ""] = entry.split(separatorField);
      return { sha, subject: subject.trim(), body: body.trim() };
    });
}

function bumpPriority(bump) {
  if (bump === "major") return 3;
  if (bump === "minor") return 2;
  return 1;
}

function detectCommitBump(commit) {
  const subject = commit.subject;
  const body = commit.body || "";

  const conventional = subject.match(/^([a-z]+)(\([^)]+\))?(!)?:\s.+$/i);
  const isBreaking = Boolean(conventional?.[3]) || /BREAKING CHANGE:/i.test(body);

  if (isBreaking) {
    return "major";
  }

  if (conventional) {
    const type = conventional[1].toLowerCase();
    if (type === "feat") {
      return "minor";
    }

    // All other recognized conventional commits default to patch.
    return "patch";
  }

  // Non-conventional commits must not fail the action.
  return "patch";
}

function computeNextVersion(base, bump) {
  const next = { ...base };

  if (bump === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    return next;
  }

  if (bump === "minor") {
    next.minor += 1;
    next.patch = 0;
    return next;
  }

  next.patch += 1;
  return next;
}

function stringifyVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function main() {
  const tagPrefix = getInput("tag-prefix", "");
  const workingDirectoryInput = getInput("working-directory", ".");
  const cwd = path.resolve(process.cwd(), workingDirectoryInput);

  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const payload = parseEventPayload();

  const latestTag = findLatestTag(cwd, tagPrefix);
  const baseVersion = latestTag?.version || { major: 0, minor: 0, patch: 0 };

  const { range, mode } = determineRange(eventName, payload, latestTag);
  const commitPathFilter = getCommitPathFilter(cwd);
  const commits = collectCommits(cwd, range, commitPathFilter);

  let bumpType = "patch";
  for (const commit of commits) {
    const commitBump = detectCommitBump(commit);
    if (bumpPriority(commitBump) > bumpPriority(bumpType)) {
      bumpType = commitBump;
    }
  }

  const nextVersionObj = computeNextVersion(baseVersion, bumpType);
  const nextVersion = stringifyVersion(nextVersionObj);
  const nextTag = `${tagPrefix}${nextVersion}`;

  setOutput("next-version", nextVersion);
  setOutput("next-tag", nextTag);
  setOutput("bump-type", bumpType);
  setOutput("commit-count", String(commits.length));

  console.log(`mode=${mode}`);
  console.log(`range=${range}`);
  console.log(`path-filter=${commitPathFilter || "<repo-root>"}`);
  console.log(`latest-tag=${latestTag?.tag || "<none>"}`);
  console.log(`base-version=${stringifyVersion(baseVersion)}`);
  console.log(`bump-type=${bumpType}`);
  console.log(`next-version=${nextVersion}`);
  console.log(`next-tag=${nextTag}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = {
  parseVersion,
  compareVersions,
  determineRange,
  bumpPriority,
  detectCommitBump,
  computeNextVersion,
  stringifyVersion,
};
