#!/usr/bin/env node
//
// Importe les dossiers ouverts dans Encircle vers l'application.
//
//   # à partir d'un export manuel (fonctionne aujourd'hui)
//   node scripts/sync-encircle.mjs --claims reclamations.json --page artifact/index.html --page-out artifact/index.html
//
//   # directement depuis l'API (demande un jeton et l'URL de l'endpoint)
//   ENCIRCLE_TOKEN=… ENCIRCLE_CLAIMS_URL=… node scripts/sync-encircle.mjs --from-encircle --page artifact/index.html --page-out artifact/index.html
//
// L'URL de l'endpoint est une variable d'environnement plutôt qu'une constante
// parce qu'elle n'a pas été vérifiée contre la spécification d'Encircle
// (https://api.encircleapp.com/openapi_v3.json). Elle se règle une fois, au
// vu de la vraie documentation, sans toucher au code.

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { mergeClaims } from "../src/merge.js";

const DATA_EL = "dki-data";
const OPEN_TAG = '<script type="application/json" id="' + DATA_EL + '">';
const CLOSE_TAG = "<" + "/script>";

// ─── ARGUMENTS ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { opts[key] = next; i++; }
    else opts.flags.add(key);
  }
  return opts;
}

// ─── LECTURE DE L'ÉTAT COURANT ────────────────────────────────────────────────

const readPayload = (raw) => {
  const p = JSON.parse(raw);
  return Array.isArray(p) ? p : (p.dossiers || []);
};

function dossiersFromPage(html) {
  const start = html.indexOf(OPEN_TAG);
  if (start === -1) return [];
  const from = start + OPEN_TAG.length;
  const end = html.indexOf(CLOSE_TAG, from);
  if (end === -1) throw new Error("bloc de données non refermé dans la page");
  return readPayload(html.slice(from, end));
}

function pageWithDossiers(html, dossiers) {
  const payload = { v: 1, savedAt: new Date().toISOString(), dossiers };
  const block = OPEN_TAG + JSON.stringify(payload).replace(/</g, "\\u003c") + CLOSE_TAG;
  const start = html.indexOf(OPEN_TAG);
  if (start !== -1) {
    const end = html.indexOf(CLOSE_TAG, start + OPEN_TAG.length);
    return html.slice(0, start) + block + html.slice(end + CLOSE_TAG.length);
  }
  // Pas encore de bloc de données : on l'insère juste avant le code applicatif.
  const anchor = '<script id="dki-bundle">';
  const at = html.indexOf(anchor);
  if (at === -1) throw new Error("page inattendue : ni bloc de données, ni code applicatif");
  return html.slice(0, at) + block + "\n" + html.slice(at);
}

// ─── NORMALISATION ────────────────────────────────────────────────────────────
//
// La forme exacte des objets renvoyés par Encircle n'a pas été observée depuis
// cet environnement : l'API est bloquée par la politique réseau. Plutôt que de
// deviner des noms de champs, on essaie les candidats les plus courants et on
// s'arrête net en affichant les clés réellement reçues si aucun ne correspond.

const CANDIDATES = {
  externalId: ["id", "uuid", "claim_id", "claimId"],
  client:     ["name", "claim_name", "customer_name", "insured_name", "policyholder_name", "title"],
  createdAt:  ["created_at", "createdAt", "date_created", "opened_at", "date_of_loss"],
};

const pick = (raw, keys) => {
  for (const k of keys) {
    const v = raw[k];
    if (v != null && String(v).trim() !== "") return v;
  }
  return undefined;
};

export function normalizeClaim(raw) {
  const externalId = pick(raw, CANDIDATES.externalId);
  if (externalId === undefined) {
    throw new Error(
      "Aucun identifiant reconnu dans cette réclamation.\n" +
      "Clés reçues : " + Object.keys(raw).join(", ") + "\n" +
      "Ajoute la bonne clé à CANDIDATES.externalId dans scripts/sync-encircle.mjs."
    );
  }
  return {
    externalId,
    client: pick(raw, CANDIDATES.client),
    createdAt: pick(raw, CANDIDATES.createdAt),
  };
}

// ─── SOURCE ───────────────────────────────────────────────────────────────────

const listFrom = (parsed) =>
  Array.isArray(parsed) ? parsed
  : Array.isArray(parsed.claims) ? parsed.claims
  : Array.isArray(parsed.data) ? parsed.data
  : Array.isArray(parsed.results) ? parsed.results
  : (() => { throw new Error("liste de réclamations introuvable (clés : " + Object.keys(parsed).join(", ") + ")"); })();

export async function fetchClaims() {
  const token = process.env.ENCIRCLE_TOKEN;
  const url = process.env.ENCIRCLE_CLAIMS_URL;
  if (!token) throw new Error("ENCIRCLE_TOKEN manquant (Encircle : Réglages → Bots/Public API → Create Bot → Create Bearer Token).");
  if (!url) throw new Error("ENCIRCLE_CLAIMS_URL manquant : l'URL de la liste des réclamations, prise dans https://api.encircleapp.com/openapi_v3.json");
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token, Accept: "application/json" } });
  if (!res.ok) throw new Error("Encircle a répondu " + res.status + " " + res.statusText);
  return listFrom(await res.json());
}

const readClaimsFile = (path) =>
  listFrom(JSON.parse(path === "-" ? readFileSync(0, "utf8") : readFileSync(path, "utf8")));

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const page = opts.page ? readFileSync(opts.page, "utf8") : null;
  const dossiers = opts.dossiers ? readPayload(readFileSync(opts.dossiers, "utf8"))
                 : page ? dossiersFromPage(page)
                 : [];

  const brut = opts.flags.has("from-encircle") ? await fetchClaims()
             : opts.claims ? readClaimsFile(opts.claims)
             : (() => { throw new Error("il faut --claims <fichier|-> ou --from-encircle"); })();

  const claims = brut.map(normalizeClaim);
  const r = mergeClaims(dossiers, claims);

  console.error(
    `${claims.length} réclamation(s) lue(s) — ` +
    `${r.added.length} ajoutée(s), ${r.linked.length} rattachée(s), ` +
    `${r.enriched.length} complétée(s), ${r.untouched} inchangée(s). ` +
    `Total : ${r.dossiers.length} dossier(s).`
  );
  if (r.added.length) console.error("Ajoutés : " + r.added.join(", "));

  if (opts["page-out"]) {
    if (!page) throw new Error("--page-out demande --page");
    writeFileSync(opts["page-out"], pageWithDossiers(page, r.dossiers));
    console.error("Page écrite : " + opts["page-out"]);
  }
  if (opts.out) {
    writeFileSync(opts.out, JSON.stringify({ v: 1, savedAt: new Date().toISOString(), dossiers: r.dossiers }, null, 2));
    console.error("Données écrites : " + opts.out);
  }
  if (!opts["page-out"] && !opts.out) {
    process.stdout.write(JSON.stringify({ v: 1, savedAt: new Date().toISOString(), dossiers: r.dossiers }, null, 2) + "\n");
  }
}

// Lancé directement : on exécute. Importé par un test : on se tait.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error("\n✗ " + e.message + "\n"); process.exit(1); });
}
