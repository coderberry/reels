import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
await mkdir("artifacts", { recursive: true });
const version = JSON.parse(
  await readFile("static/manifest.json", "utf8"),
).version;
const name = `local-reel-controls-${version}.zip`;
execFileSync("zip", ["-q", "-r", "-FS", path.resolve("artifacts", name), "."], {
  cwd: "dist",
});
const archive = await readFile(`artifacts/${name}`);
await writeFile(
  `artifacts/${name}.sha256`,
  `${createHash("sha256").update(archive).digest("hex")}  ${name}\n`,
);
const files = await readdir("dist");
console.log(
  `Packaged ${files.length} files: artifacts/${name} (${archive.length} bytes)`,
);
