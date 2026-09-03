import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    content: "src/content/content.ts",
    "page-bridge": "src/content/page-bridge.ts",
    popup: "src/popup/popup.ts"
  },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir,
  sourcemap: true,
  logLevel: "info"
});

const sourceManifest = JSON.parse(await readFile("manifest.json", "utf8"));
const removeDistPrefix = (path) => path.replace(/^dist\//, "");
const distributionManifest = {
  ...sourceManifest,
  action: {
    ...sourceManifest.action,
    default_popup: removeDistPrefix(sourceManifest.action.default_popup)
  },
  content_scripts: sourceManifest.content_scripts.map((entry) => ({
    ...entry,
    ...(entry.js ? { js: entry.js.map(removeDistPrefix) } : {}),
    ...(entry.css ? { css: entry.css.map(removeDistPrefix) } : {})
  }))
};

await Promise.all([
  writeFile(`${outdir}/manifest.json`, `${JSON.stringify(distributionManifest, null, 2)}\n`),
  cp("src/content/content.css", `${outdir}/content.css`),
  cp("src/popup/popup.html", `${outdir}/popup.html`),
  cp("src/popup/popup.css", `${outdir}/popup.css`)
]);
