// ─── IMPORT D'UNE SOURCE EXTERNE ──────────────────────────────────────────────
//
// Une règle, non négociable : la source externe décide QU'UN dossier existe.
// Elle ne décide jamais OÙ il en est. L'avancement — tâches, notes, visites,
// chantier, fin d'urgence — est saisi ici et n'est jamais écrasé par un import.
//
// Conséquences assumées :
//   • un dossier qui disparaît du flux n'est jamais supprimé ;
//   • un dossier déjà connu n'est complété que sur les champs restés vides ;
//   • relancer l'import deux fois de suite ne change rien la seconde fois.

import { newDossierTemplate } from "./dossier.js";

export const PLACEHOLDER_CLIENT = "Nouveau client";

const isBlank = (v) => v == null || String(v).trim() === "";
const isUnnamed = (v) => isBlank(v) || String(v).trim() === PLACEHOLDER_CLIENT;

/**
 * @param {Array} dossiers  l'état actuel
 * @param {Array} claims    réclamations normalisées : { externalId, client, createdAt, id? }
 * @returns {{ dossiers: Array, added: Array, linked: Array, enriched: Array, untouched: number }}
 */
export function mergeClaims(dossiers, claims) {
  const out = dossiers.map((d) => ({ ...d }));
  const byExternal = new Map();
  const byId = new Map();
  for (const d of out) {
    if (d.externalId) byExternal.set(String(d.externalId), d);
    if (d.id) byId.set(String(d.id), d);
  }

  const added = [], linked = [], enriched = [];
  let untouched = 0;

  for (const claim of claims) {
    if (isBlank(claim.externalId)) throw new Error("réclamation sans externalId : " + JSON.stringify(claim));
    const externalId = String(claim.externalId).trim();

    let target = byExternal.get(externalId);

    // Dossier saisi à la main avant que le lien existe : on l'adopte au lieu
    // d'en créer un doublon.
    if (!target && claim.id && byId.has(String(claim.id))) {
      target = byId.get(String(claim.id));
      target.externalId = externalId;
      byExternal.set(externalId, target);
      linked.push(target.id);
    }

    if (!target) {
      const fresh = newDossierTemplate();
      if (claim.id) fresh.id = String(claim.id);
      fresh.externalId = externalId;
      if (!isBlank(claim.client)) fresh.client = String(claim.client).trim();
      if (!isBlank(claim.createdAt)) fresh.createdAt = new Date(claim.createdAt).toISOString();
      out.push(fresh);
      byExternal.set(externalId, fresh);
      byId.set(fresh.id, fresh);
      added.push(fresh.id);
      continue;
    }

    // Complément prudent : uniquement ce qui est encore vide.
    let changed = false;
    if (isUnnamed(target.client) && !isBlank(claim.client)) {
      target.client = String(claim.client).trim();
      changed = true;
    }
    if (isBlank(target.createdAt) && !isBlank(claim.createdAt)) {
      target.createdAt = new Date(claim.createdAt).toISOString();
      changed = true;
    }
    if (changed && !linked.includes(target.id)) enriched.push(target.id);
    else if (!changed && !linked.includes(target.id)) untouched++;
  }

  out.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return { dossiers: out, added, linked, enriched, untouched };
}
