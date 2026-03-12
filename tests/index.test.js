const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseVersion,
  compareVersions,
  determineRange,
  bumpPriority,
  detectCommitBump,
  computeNextVersion,
  stringifyVersion,
} = require("../index.js");

test("parseVersion parses valid semver", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
});

test("parseVersion returns null for invalid input", () => {
  assert.equal(parseVersion("v1.2.3"), null);
  assert.equal(parseVersion("1.2"), null);
});

test("compareVersions compares semver values", () => {
  assert.ok(compareVersions({ major: 1, minor: 0, patch: 0 }, { major: 0, minor: 9, patch: 9 }) > 0);
  assert.ok(compareVersions({ major: 1, minor: 2, patch: 0 }, { major: 1, minor: 2, patch: 3 }) < 0);
  assert.equal(compareVersions({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 }), 0);
});

test("determineRange prefers pull_request range", () => {
  const payload = {
    pull_request: {
      base: { sha: "base123" },
      head: { sha: "head456" },
    },
  };

  assert.deepEqual(determineRange("pull_request", payload, null), {
    range: "base123..head456",
    mode: "pull_request",
  });
});

test("determineRange uses push range when available", () => {
  const payload = {
    before: "before123",
    after: "after456",
  };

  assert.deepEqual(determineRange("push", payload, null), {
    range: "before123..after456",
    mode: "push",
  });
});

test("determineRange falls back to latest tag or HEAD", () => {
  assert.deepEqual(determineRange("workflow_dispatch", {}, { tag: "v1.0.0" }), {
    range: "v1.0.0..HEAD",
    mode: "since_latest_tag",
  });

  assert.deepEqual(determineRange("workflow_dispatch", {}, null), {
    range: "HEAD",
    mode: "head_only",
  });
});

test("detectCommitBump handles conventional and non-conventional commits", () => {
  assert.equal(detectCommitBump({ subject: "feat: add endpoint", body: "" }), "minor");
  assert.equal(detectCommitBump({ subject: "chore: tidy", body: "" }), "patch");
  assert.equal(detectCommitBump({ subject: "random message", body: "" }), "patch");
});

test("detectCommitBump detects breaking changes", () => {
  assert.equal(detectCommitBump({ subject: "feat!: break API", body: "" }), "major");
  assert.equal(detectCommitBump({ subject: "feat: add", body: "BREAKING CHANGE: changed payload" }), "major");
});

test("bumpPriority orders bump levels", () => {
  assert.ok(bumpPriority("major") > bumpPriority("minor"));
  assert.ok(bumpPriority("minor") > bumpPriority("patch"));
});

test("computeNextVersion increments semver correctly", () => {
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "patch"), { major: 1, minor: 2, patch: 4 });
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "minor"), { major: 1, minor: 3, patch: 0 });
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "major"), { major: 2, minor: 0, patch: 0 });
});

test("stringifyVersion formats semver", () => {
  assert.equal(stringifyVersion({ major: 2, minor: 5, patch: 9 }), "2.5.9");
});
