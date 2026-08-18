// ─── PERSISTANCE ──────────────────────────────────────────────────────────────
//
// Trois niveaux, du plus durable au plus volatil :
//
//   1. L'instantané publié DANS la page (capacité « artifact »). C'est la
//      seule couche partagée entre appareils : ce que tu vois sur ton
//      téléphone vient de là. Republier remplace la page au complet et
//      recharge toutes les vues ouvertes.
//   2. localStorage — brouillon instantané, propre à l'appareil. Il encaisse
//      chaque frappe pour qu'aucune saisie ne dépende du réseau.
//   3. window.storage — l'aperçu StackBlitz, qui fournit sa propre API.
//
// Chaque instantané porte un `savedAt`; au chargement on garde le plus récent.

export const STORAGE_KEY = "dki-refexio-final";
const DATA_EL = "dki-data";
const BUNDLE_EL = "dki-bundle";
const VIEW_KEY = "dki-view";

export const makePayload = (dossiers) => ({
  v: 1,
  savedAt: new Date().toISOString(),
  dossiers,
});

function parsePayload(raw) {
  if (!raw) return null;
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(p)) return { v: 1, savedAt: "", dossiers: p }; // ancien format
    if (Array.isArray(p && p.dossiers))
      return { v: 1, savedAt: p.savedAt || "", dossiers: p.dossiers };
  } catch (_) {}
  return null;
}

const readEmbedded = () => {
  const el = document.getElementById(DATA_EL);
  return el ? parsePayload(el.textContent) : null;
};

const readLocal = () => {
  try { return parsePayload(localStorage.getItem(STORAGE_KEY)); } catch (_) { return null; }
};

async function readLegacy() {
  try {
    const res = await window.storage.get(STORAGE_KEY);
    return parsePayload(res && res.value);
  } catch (_) { return null; }
}

export async function loadDossiers(seed) {
  const found = [readEmbedded(), readLocal(), await readLegacy()].filter(Boolean);
  if (!found.length) return seed;
  found.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  return found[0].dossiers;
}

export function saveLocal(payload) {
  const raw = JSON.stringify(payload);
  try { localStorage.setItem(STORAGE_KEY, raw); } catch (_) {}
  try { window.storage.set(STORAGE_KEY, raw); } catch (_) {}
}

// ─── PUBLICATION DANS LA PAGE ─────────────────────────────────────────────────

let artifactPromise;
function getArtifact() {
  if (!artifactPromise) {
    artifactPromise = (window.claude && typeof window.claude.use === "function")
      ? window.claude.use("artifact").catch(() => null)
      : Promise.resolve(null);
  }
  return artifactPromise;
}

export const PAGE_CSS =
  "html,body{margin:0;padding:0;background:#0c0c0c;color:#e0d8c8;" +
  "font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;" +
  "-webkit-text-size-adjust:100%}";

export const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,600;0,700;1,400&display=swap";

// La page se réécrit à partir de ses propres morceaux : le code applicatif est
// relu depuis son <script>, les données sont réinjectées à côté. On ne
// sérialise jamais le DOM vivant — il contient l'état de session et les
// scripts injectés par la visionneuse.
function renderPage(payload) {
  const bundleEl = document.getElementById(BUNDLE_EL);
  if (!bundleEl) throw new Error("code applicatif introuvable");
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return [
    "<!doctype html>",
    '<html lang="fr">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Dossiers DKI Refexio</title>",
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="' + FONT_HREF + '">',
    "<style>" + PAGE_CSS + "</style>",
    "</head>",
    "<body>",
    '<div id="root"></div>',
    '<script type="application/json" id="' + DATA_EL + '">' + json + "</" + "script>",
    '<script id="' + BUNDLE_EL + '">' + bundleEl.textContent + "</" + "script>",
    "</body>",
    "</html>",
  ].join("\n");
}

// Résultat : "published" | "unavailable" | "readonly" | "conflict" | "retry" | "error"
export async function publishSnapshot(payload) {
  const artifact = await getArtifact();
  if (!artifact) return { status: "unavailable" };
  try {
    await artifact.publish(renderPage(payload));
    return { status: "published" };
  } catch (err) {
    const code = (err && err.code) || "upstream_error";
    if (code === "conflict") return { status: "conflict" };
    if (["not_writer", "not_granted", "not_declared", "consent_required",
         "capability_disabled", "capability_removed"].includes(code)) {
      return { status: "readonly", code };
    }
    if (code === "rate_limited") return { status: "retry", code };
    return { status: "error", code, message: (err && err.message) || String(err) };
  }
}

// ─── POSITION DE LECTURE ──────────────────────────────────────────────────────
// Publier recharge la vue. On note où on était pour y revenir.

export function stashView(view) {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (_) {}
}

export function popView() {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY);
    sessionStorage.removeItem(VIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
