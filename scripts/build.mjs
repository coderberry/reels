import { build } from "esbuild";
import { mkdir, cp, readFile, readdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("static", "dist", { recursive: true });
await build({
  entryPoints: [
    "src/content.ts",
    "src/media.ts",
    "src/background.ts",
    "src/popup.ts",
  ],
  bundle: true,
  outdir: "dist",
  format: "iife",
  target: "chrome111",
  sourcemap: false,
  legalComments: "none",
});
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
for (const file of [
  manifest.action.default_popup,
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((script) => script.js),
])
  await readFile(`dist/${file}`);
for (const file of await readdir("dist")) {
  if (!file.endsWith(".js")) continue;
  const source = await readFile(`dist/${file}`, "utf8");
  if (
    /reels-scrubber\.workers\.dev|stripe\.com|check-license|restore-purchase|telemetryUrl/.test(
      source,
    )
  )
    throw new Error(`Unexpected external-service code in ${file}`);
}
console.log("Built and validated unpacked extension: dist/");
