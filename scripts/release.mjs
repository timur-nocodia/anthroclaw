#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const ROOT_PACKAGE = resolve(ROOT, 'package.json');
const UI_PACKAGE = resolve(ROOT, 'ui', 'package.json');
const VERSION_FILE = resolve(ROOT, 'VERSION');
const CHANGELOG = resolve(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const checkOnly = args.includes('--check');
const bump = args.find((arg) => !arg.startsWith('--'));

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitMaybe(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) fail(`invalid semver version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(current, kind) {
  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(kind)) return kind;

  const parsed = parseVersion(current);
  if (kind === 'major') return `${parsed.major + 1}.0.0`;
  if (kind === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  if (kind === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;

  fail('usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]');
}

function ensureCleanWorktree() {
  const status = git(['status', '--porcelain']);
  if (status) {
    fail('worktree must be clean before creating a release');
  }
}

function latestVersionTag() {
  return gitMaybe(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*']);
}

function releaseCommits() {
  const latestTag = latestVersionTag();
  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const raw = gitMaybe(['log', '--pretty=format:%h%x09%s', range]);
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    const [sha, ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
}

function changelogEntry(version) {
  const date = new Date().toISOString().slice(0, 10);
  const commits = releaseCommits();
  const lines = [`## [${version}] - ${date}`, '', '### Changed'];

  if (commits.length === 0) {
    lines.push('- No notable changes recorded.');
  } else {
    for (const commit of commits) {
      lines.push(`- ${commit.subject} (${commit.sha})`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function updateChangelog(version) {
  const entry = changelogEntry(version);

  if (!existsSync(CHANGELOG)) {
    return `# Changelog\n\nAll notable changes to AnthroClaw are documented here.\n\n${entry}`;
  }

  const current = readFileSync(CHANGELOG, 'utf8');
  if (current.includes(`## [${version}]`)) {
    fail(`CHANGELOG.md already contains version ${version}`);
  }

  const marker = '## [Unreleased]';
  if (current.includes(marker)) {
    return current.replace(marker, `${marker}\n\n${entry}`);
  }

  return current.replace(/\n/, `\n\n${entry}\n`);
}

function checkVersions() {
  const rootPkg = readJson(ROOT_PACKAGE);
  const uiPkg = readJson(UI_PACKAGE);
  const versionFile = existsSync(VERSION_FILE)
    ? readFileSync(VERSION_FILE, 'utf8').trim()
    : '';

  parseVersion(rootPkg.version);

  const errors = [];
  if (uiPkg.version !== rootPkg.version) {
    errors.push(`ui/package.json version ${uiPkg.version} does not match root ${rootPkg.version}`);
  }
  if (versionFile !== rootPkg.version) {
    errors.push(`VERSION ${versionFile || '(missing)'} does not match root ${rootPkg.version}`);
  }
  if (!existsSync(CHANGELOG)) {
    errors.push('CHANGELOG.md is missing');
  }

  if (errors.length > 0) {
    for (const error of errors) console.error(`release: ${error}`);
    process.exit(1);
  }

  console.log(`release: version ${rootPkg.version} is consistent`);
}

if (checkOnly) {
  checkVersions();
  process.exit(0);
}

if (!bump) {
  fail('usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--dry-run]');
}

const rootPkg = readJson(ROOT_PACKAGE);
const uiPkg = readJson(UI_PACKAGE);
const version = nextVersion(rootPkg.version, bump);
parseVersion(version);

if (uiPkg.version !== rootPkg.version) {
  fail(`ui/package.json version ${uiPkg.version} does not match root ${rootPkg.version}`);
}

if (dryRun) {
  console.log(`release: ${rootPkg.version} -> ${version}`);
  console.log('release: dry run only; no files, commits, or tags were created');
  process.exit(0);
}

ensureCleanWorktree();

rootPkg.version = version;
uiPkg.version = version;

writeJson(ROOT_PACKAGE, rootPkg);
writeJson(UI_PACKAGE, uiPkg);
writeFileSync(VERSION_FILE, `${version}\n`, 'utf8');
writeFileSync(CHANGELOG, updateChangelog(version), 'utf8');

git(['add', 'package.json', 'ui/package.json', 'VERSION', 'CHANGELOG.md']);
git(['commit', '-m', `chore(release): v${version}`]);
git(['tag', '-a', `v${version}`, '-m', `v${version}`]);

console.log(`release: created v${version}`);
console.log('release: push with: git push && git push --tags');
