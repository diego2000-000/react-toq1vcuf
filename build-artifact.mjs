// Produit artifact/index.html : l'application complète en un seul fichier,
// sans aucune dépendance réseau hormis la police Google Fonts.
//
//   node build-artifact.mjs
//
// Le fichier obtenu est ce qu'on publie. Une fois en ligne, la page se
// republie elle-même à chaque sauvegarde en relisant son propre <script>
// et en réinjectant les données à côté (voir renderPage dans src/storage.js).

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { PAGE_CSS, FONT_HREF } from "./src/storage.js";

const OUT_DIR = "artifact";
const OUT_FILE = `${OUT_DIR}/index.html`;

const result = await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  loader: { ".js": "jsx" },
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});

let bundle = result.outputFiles[0].text;

// Un « </script> » littéral dans le code fermerait la balise qui le contient.
// La séquence n'apparaît qu'à l'intérieur de chaînes : y échapper la barre
// oblique ne change rien au sens, et la page relit exactement cette forme.
bundle = bundle.replace(/<\/script/gi, "<\\/script");

const page = `<title>Dossiers DKI Refexio</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_HREF}">
<style>${PAGE_CSS}</style>
<div id="root"></div>
<script id="dki-bundle">${bundle}</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, page);

const kb = (n) => `${Math.round(n / 1024)} Ko`;
console.log(`${OUT_FILE} — ${kb(page.length)} (code applicatif ${kb(bundle.length)})`);
