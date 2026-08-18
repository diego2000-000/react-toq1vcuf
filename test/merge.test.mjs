import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeClaims } from "../src/merge.js";
import { newDossierTemplate } from "../src/dossier.js";

const dossierAvance = () => {
  const d = newDossierTemplate();
  d.id = "2603MO027";
  d.externalId = "enc-1";
  d.client = "SDC Le Callière";
  d.createdAt = "2026-03-26T10:00:00.000Z";
  d.tasks.intervention_urgence = "done";
  d.notes.rapport_intervention = "Pompage 3h.";
  d.visites = [{ id: "v1", date: "2026-03-30T09:00:00.000Z", note: "Séchage en cours." }];
  d.finUrgence = "2026-03-28T16:00";
  return d;
};

test("un dossier inconnu est ajouté", () => {
  const r = mergeClaims([], [{ externalId: "enc-9", client: "Copropriété du Fleuve", createdAt: "2026-04-02T14:00:00.000Z" }]);
  assert.equal(r.dossiers.length, 1);
  assert.equal(r.added.length, 1);
  assert.equal(r.dossiers[0].client, "Copropriété du Fleuve");
  assert.equal(r.dossiers[0].externalId, "enc-9");
  assert.equal(r.dossiers[0].tasks.intervention_urgence, "pending");
});

test("l'avancement saisi ici n'est jamais écrasé", () => {
  const avant = dossierAvance();
  const r = mergeClaims([avant], [{ externalId: "enc-1", client: "AUTRE NOM VENU DU FLUX", createdAt: "2020-01-01T00:00:00.000Z" }]);
  const apres = r.dossiers[0];
  assert.equal(apres.client, "SDC Le Callière");           // pas remplacé
  assert.equal(apres.createdAt, "2026-03-26T10:00:00.000Z"); // pas reculé
  assert.equal(apres.tasks.intervention_urgence, "done");
  assert.equal(apres.notes.rapport_intervention, "Pompage 3h.");
  assert.equal(apres.visites.length, 1);
  assert.equal(apres.finUrgence, "2026-03-28T16:00");
  assert.equal(r.untouched, 1);
});

test("un dossier encore anonyme reçoit le nom du client", () => {
  const brouillon = newDossierTemplate();
  brouillon.externalId = "enc-2";
  const r = mergeClaims([brouillon], [{ externalId: "enc-2", client: "Résidences Bonaventure" }]);
  assert.equal(r.dossiers[0].client, "Résidences Bonaventure");
  assert.deepEqual(r.enriched, [brouillon.id]);
});

test("un dossier créé à la main est adopté, pas dupliqué", () => {
  const manuel = newDossierTemplate();
  manuel.id = "2604MO101";
  manuel.client = "Tour Bellevue";
  const r = mergeClaims([manuel], [{ externalId: "enc-7", id: "2604MO101", client: "Tour Bellevue" }]);
  assert.equal(r.dossiers.length, 1);
  assert.equal(r.dossiers[0].externalId, "enc-7");
  assert.deepEqual(r.linked, ["2604MO101"]);
});

test("relancer l'import ne change rien la seconde fois", () => {
  const claims = [
    { externalId: "enc-1", client: "SDC Le Callière", createdAt: "2026-03-26T10:00:00.000Z" },
    { externalId: "enc-5", client: "Marché Central", createdAt: "2026-04-05T08:00:00.000Z" },
  ];
  const un = mergeClaims([dossierAvance()], claims);
  const deux = mergeClaims(un.dossiers, claims);
  assert.equal(deux.added.length, 0);
  assert.equal(deux.enriched.length, 0);
  assert.deepEqual(deux.dossiers, un.dossiers);
});

test("un dossier absent du flux survit", () => {
  const orphelin = newDossierTemplate();
  orphelin.externalId = "enc-fermé";
  orphelin.client = "Dossier clos chez Encircle";
  const r = mergeClaims([orphelin], [{ externalId: "enc-neuf", client: "Nouveau chantier" }]);
  assert.equal(r.dossiers.length, 2);
  assert.ok(r.dossiers.some(d => d.externalId === "enc-fermé"));
});

test("les plus récents remontent en tête", () => {
  const r = mergeClaims([], [
    { externalId: "a", client: "Vieux", createdAt: "2026-01-01T00:00:00.000Z" },
    { externalId: "b", client: "Récent", createdAt: "2026-08-01T00:00:00.000Z" },
  ]);
  assert.deepEqual(r.dossiers.map(d => d.client), ["Récent", "Vieux"]);
});

test("une réclamation sans identifiant externe est refusée", () => {
  assert.throws(() => mergeClaims([], [{ client: "Sans identifiant" }]), /externalId/);
});
