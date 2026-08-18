import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDossierId, newDossierTemplate } from "../src/dossier.js";
import { mergeClaims } from "../src/merge.js";

const juin2026 = new Date("2026-06-15T09:00:00Z");

test("le premier dossier de l'année porte le rang 001", () => {
  assert.equal(nextDossierId([], juin2026), "2606MO001");
});

test("le rang suit le plus haut déjà pris dans l'année", () => {
  const existants = [{ id: "2602MO014" }, { id: "2603MO027" }, { id: "2603MO031" }];
  assert.equal(nextDossierId(existants, juin2026), "2606MO032");
});

test("le mois vient de l'ouverture du dossier, pas d'aujourd'hui", () => {
  assert.equal(nextDossierId([{ id: "2603MO031" }], new Date("2026-11-02T00:00:00Z")), "2611MO032");
});

test("une nouvelle année repart à 001", () => {
  const existants = [{ id: "2612MO214" }];
  assert.equal(nextDossierId(existants, new Date("2027-01-08T00:00:00Z")), "2701MO001");
});

test("un identifiant étranger au format n'entre pas dans le compte", () => {
  assert.equal(nextDossierId([{ id: "9f2c-aaa1" }, { id: "" }, {}], juin2026), "2606MO001");
});

test("l'identifiant Encircle ne devient jamais le numéro de dossier", () => {
  const r = mergeClaims([], [{ externalId: "9f2c-aaa1", client: "Tour Bellevue", createdAt: "2026-06-16T13:20:00Z" }]);
  const d = r.dossiers[0];
  assert.equal(d.externalId, "9f2c-aaa1");
  assert.match(d.id, /^2606MO\d{3}$/);
});

test("deux réclamations importées d'un coup reçoivent des numéros distincts", () => {
  const claims = [
    { externalId: "enc-a", client: "A", createdAt: "2026-06-16T13:20:00Z" },
    { externalId: "enc-b", client: "B", createdAt: "2026-06-17T07:45:00Z" },
    { externalId: "enc-c", client: "C", createdAt: "2026-06-18T07:45:00Z" },
  ];
  const r = mergeClaims([{ id: "2603MO031", client: "Existant", createdAt: "2026-03-28T00:00:00Z", tasks: {}, notes: {} }], claims);
  const nums = r.dossiers.filter(d => d.externalId).map(d => d.id);
  assert.equal(new Set(nums).size, 3, "numéros dupliqués : " + nums.join(", "));
  assert.deepEqual([...nums].sort(), ["2606MO032", "2606MO033", "2606MO034"]);
});

test("le numéro attribué à l'import survit à un second import", () => {
  const claims = [{ externalId: "enc-a", client: "A", createdAt: "2026-06-16T13:20:00Z" }];
  const un = mergeClaims([], claims);
  const deux = mergeClaims(un.dossiers, claims);
  assert.equal(deux.added.length, 0);
  assert.equal(deux.dossiers[0].id, un.dossiers[0].id);
});

test("le gabarit sans argument reste utilisable", () => {
  const d = newDossierTemplate();
  assert.match(d.id, /^\d{4}MO\d{3}$/);
});
