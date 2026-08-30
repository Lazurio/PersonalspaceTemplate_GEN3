import { runCommand } from "./command-runner.mjs";
import { fileURLToPath } from "url";
import {
  parseFsckObjectFindings,
  parseLsTreeLongEntries,
  trackedPathPrivacyIssues,
  trackedTextPrivacyIssues,
} from "./personalspace-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const commits = runCommand("git", ["rev-list", "--all"], { cwd: root }).stdout
  .split(/\r?\n/)
  .filter(Boolean);
const failures = [];
const seenBlobs = new Set();
let scannedBytes = 0;
let scannedFiles = 0;

const metadataForbidden = [
  ["absolutní macOS home cesta", new RegExp(`/${["Users", "[^/\\s]+"].join("/")}/`)],
  ["absolutní Windows home cesta", new RegExp(`${"C:"}\\\\${"Users"}\\\\`, "i")],
  ["interní klientská cesta", new RegExp(["Client", "Companies"].join(""), "i")],
];

for (const commit of commits) {
  const tree = runCommand("git", ["ls-tree", "-r", "-l", "-z", commit], { cwd: root }).stdout;
  for (const { mode, type, object: blob, sizeText, file } of parseLsTreeLongEntries(tree)) {
    const pathLabel = `objekt ${blob.slice(0, 12)}@${commit.slice(0, 12)}`;
    if (mode === "160000" || type === "commit") {
      failures.push(`${pathLabel}: historický gitlink je zakázaný`);
      continue;
    }
    if (mode === "120000") {
      failures.push(`${pathLabel}: historický symlink je v privacy auditu zakázaný`);
      continue;
    }
    if (file === ".gitmodules" || file.endsWith("/.gitmodules")) {
      failures.push(`${pathLabel}: historický .gitmodules je zakázaný`);
    }
    for (const [label, pattern] of metadataForbidden) {
      if (pattern.test(file)) failures.push(`${pathLabel}: ${label} v názvu souboru`);
    }
    if (trackedPathPrivacyIssues([file]).length > 0) {
      failures.push(`${pathLabel}: zakázaný privacy path`);
    }
    failures.push(...trackedTextPrivacyIssues("název souboru", file, { label: pathLabel }));
    if (seenBlobs.has(blob)) continue;
    seenBlobs.add(blob);
    const size = Number(sizeText);
    if (Number.isFinite(size) && size > 1_000_000) {
      failures.push(`${pathLabel}: blob je větší než 1 MB`);
      continue;
    }
    const result = runCommand("git", ["cat-file", "blob", blob], {
      cwd: root,
      allowFailure: true,
    });
    if (result.status !== 0) {
      failures.push(`${pathLabel}: blob nejde přečíst`);
      continue;
    }
    scannedFiles += 1;
    scannedBytes += Buffer.byteLength(result.stdout, "utf8");
    for (const [label, pattern] of metadataForbidden) {
      if (pattern.test(result.stdout)) failures.push(`${pathLabel}: ${label}`);
    }
    failures.push(...trackedTextPrivacyIssues("historický blob", result.stdout, {
      label: pathLabel,
    }));
  }
}

for (const commit of commits) {
  const message = runCommand("git", ["show", "-s", "--format=%B", commit], { cwd: root }).stdout;
  for (const [label, pattern] of metadataForbidden) {
    if (pattern.test(message)) failures.push(`${commit.slice(0, 12)}: ${label} v commit message`);
  }
  failures.push(...trackedTextPrivacyIssues("commit message", message, {
    label: commit.slice(0, 12),
  }));
}

const refs = runCommand("git", ["for-each-ref", "--format=%(refname)"], { cwd: root }).stdout
  .split(/\r?\n/)
  .filter(Boolean);
for (let index = 0; index < refs.length; index += 1) {
  const ref = refs[index];
  const refLabel = `Git ref #${index + 1}`;
  for (const [label, pattern] of metadataForbidden) {
    if (pattern.test(ref)) failures.push(`${refLabel}: ${label} v názvu Git refu`);
  }
  failures.push(...trackedTextPrivacyIssues("název Git refu", ref, { label: refLabel }));
}

const annotatedTags = runCommand(
  "git",
  ["for-each-ref", "refs/tags", "--format=%(objecttype)\t%(objectname)\t%(refname)"],
  { cwd: root },
).stdout.split(/\r?\n/).filter(Boolean);
for (const entry of annotatedTags) {
  const [type, object] = entry.split("\t");
  if (type !== "tag" || !object) continue;
  const tagLabel = `tag ${object.slice(0, 12)}`;
  const payload = runCommand("git", ["cat-file", "tag", object], { cwd: root, allowFailure: true });
  if (payload.status !== 0) {
    failures.push(`${tagLabel}: anotovaný tag nejde přečíst`);
    continue;
  }
  for (const [label, pattern] of metadataForbidden) {
    if (pattern.test(payload.stdout)) failures.push(`${tagLabel}: ${label} v payloadu anotovaného tagu`);
  }
  failures.push(...trackedTextPrivacyIssues("payload anotovaného tagu", payload.stdout, {
    label: tagLabel,
  }));
}

const fsck = runCommand("git", ["fsck", "--full", "--no-reflogs", "--unreachable"], {
  cwd: root,
  allowFailure: true,
});
if (fsck.status !== 0) failures.push("git fsck nedokončil kontrolu objektové databáze");
const fsckFindings = `${fsck.stdout}\n${fsck.stderr}`.trim();
const detached = parseFsckObjectFindings(fsckFindings);
for (const finding of detached.unexpected) {
  failures.push(`git fsck neočekávaný nález: ${finding}`);
}
const detachedObjectIds = new Set();
const detachedTreeQueue = [];
const queuedDetachedTreePaths = new Set();
const maxDetachedTreePathStates = 10_000;
let detachedTreeBudgetExceeded = false;

function enqueueDetachedTree(object, prefix) {
  const key = `${object}\u0000${prefix}`;
  if (queuedDetachedTreePaths.has(key)) return;
  if (queuedDetachedTreePaths.size >= maxDetachedTreePathStates) {
    if (!detachedTreeBudgetExceeded) {
      failures.push(
        `detached tree traversal překročil fail-closed limit ${maxDetachedTreePathStates} path stavů`,
      );
      detachedTreeBudgetExceeded = true;
    }
    return;
  }
  queuedDetachedTreePaths.add(key);
  detachedTreeQueue.push({ object, prefix });
}

for (const entry of detached.objects) {
  if (detachedObjectIds.has(entry.object)) continue;
  detachedObjectIds.add(entry.object);
  if (entry.type === "tree") {
    enqueueDetachedTree(entry.object, "");
    continue;
  }
  if (entry.type === "blob" && seenBlobs.has(entry.object)) continue;
  const sizeResult = runCommand("git", ["cat-file", "-s", entry.object], {
    cwd: root,
    allowFailure: true,
  });
  const size = Number(sizeResult.stdout);
  if (sizeResult.status !== 0 || !Number.isFinite(size)) {
    failures.push(`${entry.type} ${entry.object.slice(0, 12)}: detached objekt nejde změřit`);
    continue;
  }
  if (size > 1_000_000) {
    failures.push(`${entry.type} ${entry.object.slice(0, 12)}: detached objekt je větší než 1 MB`);
    continue;
  }
  const payload = runCommand("git", ["cat-file", entry.type, entry.object], {
    cwd: root,
    allowFailure: true,
  });
  if (payload.status !== 0) {
    failures.push(`${entry.type} ${entry.object.slice(0, 12)}: detached objekt nejde přečíst`);
    continue;
  }
  if (entry.type === "blob") {
    seenBlobs.add(entry.object);
    scannedFiles += 1;
    scannedBytes += Buffer.byteLength(payload.stdout, "utf8");
  }
  for (const [label, pattern] of metadataForbidden) {
    if (pattern.test(payload.stdout)) {
      failures.push(`${entry.type} ${entry.object.slice(0, 12)}: ${label} v detached objektu`);
    }
  }
  failures.push(...trackedTextPrivacyIssues(
    `${entry.type} detached objekt`,
    payload.stdout,
    { label: entry.object.slice(0, 12) },
  ));
}

const scannedDetachedTreePaths = new Set();
const detachedTreeEntries = new Map();
let detachedTreeIndex = 0;
while (detachedTreeIndex < detachedTreeQueue.length) {
  const { object: treeObject, prefix } = detachedTreeQueue[detachedTreeIndex];
  detachedTreeIndex += 1;
  if (!treeObject) continue;
  const treePathKey = `${treeObject}\u0000${prefix}`;
  if (scannedDetachedTreePaths.has(treePathKey)) continue;
  scannedDetachedTreePaths.add(treePathKey);
  detachedObjectIds.add(treeObject);
  const treeLabel = `tree ${treeObject.slice(0, 12)}`;
  if (!detachedTreeEntries.has(treeObject)) {
    const sizeResult = runCommand("git", ["cat-file", "-s", treeObject], {
      cwd: root,
      allowFailure: true,
    });
    const size = Number(sizeResult.stdout);
    if (sizeResult.status !== 0 || !Number.isFinite(size) || size > 1_000_000) {
      failures.push(`${treeLabel}: detached tree nejde bezpečně změřit`);
      detachedTreeEntries.set(treeObject, null);
    } else {
      const listing = runCommand("git", ["ls-tree", "-l", "-z", treeObject], {
        cwd: root,
        allowFailure: true,
      });
      if (listing.status !== 0) {
        failures.push(`${treeLabel}: detached tree nejde přečíst`);
        detachedTreeEntries.set(treeObject, null);
      } else {
        detachedTreeEntries.set(treeObject, parseLsTreeLongEntries(listing.stdout));
      }
    }
  }
  const treeEntries = detachedTreeEntries.get(treeObject);
  if (!treeEntries) continue;
  const fullPaths = treeEntries.map(({ file }) => prefix ? `${prefix}/${file}` : file);
  if (trackedPathPrivacyIssues(fullPaths).length > 0) {
    failures.push(`${treeLabel}: zakázaný privacy path`);
  }
  for (let index = 0; index < treeEntries.length; index += 1) {
    const nested = treeEntries[index];
    const fullPath = fullPaths[index];
    const nestedLabel = `${treeLabel}:entry #${index + 1}`;
    if (fullPath === ".gitmodules" || fullPath.endsWith("/.gitmodules")) {
      failures.push(`${nestedLabel}: historický .gitmodules je zakázaný`);
    }
    for (const [label, pattern] of metadataForbidden) {
      if (pattern.test(fullPath)) failures.push(`${nestedLabel}: ${label} v názvu souboru`);
    }
    failures.push(...trackedTextPrivacyIssues("název souboru", fullPath, {
      label: nestedLabel,
    }));
    if (nested.mode === "160000" || nested.type === "commit") {
      failures.push(`${nestedLabel}: historický gitlink je zakázaný`);
      continue;
    }
    if (nested.mode === "120000") {
      failures.push(`${nestedLabel}: historický symlink je v privacy auditu zakázaný`);
      continue;
    }
    if (nested.type === "tree") {
      enqueueDetachedTree(nested.object, fullPath);
      continue;
    }
    if (nested.type !== "blob" || seenBlobs.has(nested.object)) continue;
    seenBlobs.add(nested.object);
    const nestedSize = Number(nested.sizeText);
    if (!Number.isFinite(nestedSize) || nestedSize > 1_000_000) {
      failures.push(`${nestedLabel}: blob nejde bezpečně zahrnout do privacy scanu`);
      continue;
    }
    const nestedPayload = runCommand("git", ["cat-file", "blob", nested.object], {
      cwd: root,
      allowFailure: true,
    });
    if (nestedPayload.status !== 0) {
      failures.push(`${nestedLabel}: blob nejde přečíst`);
      continue;
    }
    scannedFiles += 1;
    scannedBytes += Buffer.byteLength(nestedPayload.stdout, "utf8");
    for (const [label, pattern] of metadataForbidden) {
      if (pattern.test(nestedPayload.stdout)) failures.push(`${nestedLabel}: ${label}`);
    }
    failures.push(...trackedTextPrivacyIssues("detached blob", nestedPayload.stdout, {
      label: nestedLabel,
    }));
  }
}

if (failures.length > 0) {
  console.error("History/privacy audit FAIL");
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

const authors = runCommand("git", ["log", "--all", "--format=%ae"], { cwd: root }).stdout
  .split(/\r?\n/)
  .filter(Boolean);
console.log("History/privacy audit PASS");
console.log(`- reachable commits: ${commits.length}`);
console.log(`- unique blobs: ${seenBlobs.size}`);
console.log(`- text blobs scanned: ${scannedFiles} (${scannedBytes} B)`);
console.log(`- distinct author-email metadata: ${new Set(authors.map((email) => email.toLowerCase())).size} (hodnoty se nelogují)`);
console.log(`- unreachable/dangling objects scanned: ${detachedObjectIds.size} (žádné publikovatelné privacy nálezy)`);
