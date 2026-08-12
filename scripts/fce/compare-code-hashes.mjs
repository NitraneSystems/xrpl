/**
 * Prove (1) matching-engine ≠ ai-agent hashes and
 * (2) rebuild-twice with SOURCE_DATE_EPOCH pinned yields identical matching-engine hash (same machine).
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const EPOCH = process.env.SOURCE_DATE_EPOCH ?? "1700000000";

function hashBuiltMain(label, dir) {
  const pkg = join(dir, "package.json");
  const mainJs = join(dir, "dist/main.js");
  const configTs = join(dir, "src/app/config.ts");
  const configJs = join(dir, "src/app/config.js");
  if (!existsSync(mainJs)) {
    throw new Error(`${label}: missing ${mainJs} — build first`);
  }
  const h = createHash("sha256");
  h.update(`SOURCE_DATE_EPOCH=${EPOCH}\n`);
  h.update(readFileSync(pkg));
  h.update(readFileSync(mainJs));
  if (existsSync(configTs)) h.update(readFileSync(configTs));
  else if (existsSync(configJs)) h.update(readFileSync(configJs));
  const digest = h.digest("hex");
  console.log(`${label}: 0x${digest}`);
  return digest;
}

function rebuild(dir) {
  const dist = join(dir, "dist");
  if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
  execSync("npm run build", {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, SOURCE_DATE_EPOCH: EPOCH },
  });
}

const meDir = join(ROOT, "fce-matching-engine/typescript");
const aiDir = join(ROOT, "fce-ai-agent/typescript");

console.log(`SOURCE_DATE_EPOCH=${EPOCH}`);
console.log("--- rebuild matching-engine #1 ---");
rebuild(meDir);
const me1 = hashBuiltMain("matching-engine-build1", meDir);

console.log("--- rebuild matching-engine #2 ---");
rebuild(meDir);
const me2 = hashBuiltMain("matching-engine-build2", meDir);

if (me1 !== me2) {
  console.error("FAIL: matching-engine rebuild hashes differ (same-machine reproducibility broken)");
  process.exit(1);
}
console.log("OK: rebuild-twice identical matching-engine hash");

rebuild(aiDir);
const ai = hashBuiltMain("ai-agent", aiDir);

if (me1 === ai) {
  console.error("FAIL: matching-engine and ai-agent code hashes are identical");
  process.exit(1);
}
console.log("OK: FCE code hashes are distinct");

// Persist for submission / Stage A documentation (local artifact hashes — not on-chain until FCC register).
import { writeFileSync, mkdirSync } from "node:fs";
const outDir = join(ROOT, "config");
mkdirSync(outDir, { recursive: true });
const artifact = {
  sourceDateEpoch: EPOCH,
  note: "Local TypeScript extension digests (same-machine). On-chain TeeExtensionRegistry hashes require FCC register; see docs/KNOWN-LIMITATIONS.md.",
  matchingEngine: `0x${me1}`,
  aiAgent: `0x${ai}`,
  generatedAt: new Date().toISOString(),
};
writeFileSync(join(outDir, "fce-code-hashes.json"), JSON.stringify(artifact, null, 2) + "\n");
console.log("Wrote config/fce-code-hashes.json");
