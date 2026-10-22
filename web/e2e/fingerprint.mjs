// What ties an evidence record to the code it was made on: a hash of a spec file (line endings ignored, so a
// Windows and a Linux checkout agree) and the commit the working tree sits on.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

export const fingerprint = (text) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex").slice(0, 16);

/** The short commit ID, and whether anything the tests exercise has uncommitted changes. */
export function gitState(cwd) {
  const git = (args) => execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  return { commit: git("rev-parse --short HEAD"), uncommitted: git("status --porcelain -- :/web :/backend").length > 0 };
}
