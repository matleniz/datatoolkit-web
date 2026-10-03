#!/usr/bin/env node
// Fail when a built Studio (dist/) embeds a path of the build machine: the
// release zip runs on other machines (datatoolkit-issues#123).
// Usage: node scripts/check-dist-paths.mjs [dist]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(process.argv[2] ?? "dist");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Literal needles (paths of 2+ segments: "/app" or "/root" would match
 * library strings), then generic absolute home / CI runner paths. */
const deep = (p) => p.split(/[\\/]/).filter(Boolean).length >= 2;
const literals = [repo, homedir()].filter(deep).concat("e2e/fixtures");
const patterns = [
  /\/home\/runner\b/,
  /\/home\/[a-z_][\w.-]*\/[\w.-]/,
  /\/Users\/[\w.-]+\/[\w.-]/,
  /[A-Za-z]:\\\\?Users\\\\?[\w.-]+/,
];
const TEXT = /\.(html|js|mjs|css|json|map|txt|svg|webmanifest)$/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const hits = [];
for (const file of walk(dist).filter((f) => TEXT.test(f))) {
  const text = readFileSync(file, "utf8");
  for (const needle of literals) {
    if (text.includes(needle)) hits.push(`${file}: contains ${JSON.stringify(needle)}`);
  }
  for (const re of patterns) {
    const m = text.match(re);
    if (m) hits.push(`${file}: matches ${re} (${JSON.stringify(m[0])})`);
  }
}

if (hits.length) {
  console.error(`dist embeds build-machine paths:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`ok: no build-machine path in ${dist}`);
