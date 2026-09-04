import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const outdir = "dist";

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: {
    background: "src/background/background.ts",
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
  ...(sourceManifest.icons
    ? { icons: Object.fromEntries(Object.entries(sourceManifest.icons).map(([size, path]) => [size, removeDistPrefix(path)])) }
    : {}),
  background: {
    ...sourceManifest.background,
    service_worker: removeDistPrefix(sourceManifest.background.service_worker)
  },
  action: {
    ...sourceManifest.action,
    ...(sourceManifest.action?.default_icon
      ? { default_icon: Object.fromEntries(Object.entries(sourceManifest.action.default_icon).map(([size, path]) => [size, removeDistPrefix(path)])) }
      : {}),
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
  cp("src/popup/popup.css", `${outdir}/popup.css`),
  cp("src/assets/icons", `${outdir}/icons`, { recursive: true })
]);

await mkdir("backend/dist", { recursive: true });
await build({
  entryPoints: ["backend/worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: "backend/dist/worker.js",
  sourcemap: true,
  logLevel: "info"
});
