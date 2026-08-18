// Tests du chemin réseau de l'import Encircle.
//
// L'API d'Encircle est inaccessible depuis cet environnement (politique
// d'egress : CONNECT refusé sur api.encircleapp.com). On teste donc tout ce
// qui entoure l'appel — en-têtes, codes d'erreur, formes de réponse,
// normalisation — contre un serveur local qui joue le rôle d'Encircle.
// Ce qui reste non vérifié : la forme réelle des objets renvoyés par Encircle.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchClaims, normalizeClaim } from "../scripts/sync-encircle.mjs";

// ─── SERVEUR FACTICE ──────────────────────────────────────────────────────────

/** Démarre un faux Encircle. `handler(req)` renvoie { status?, body }. */
async function fauxEncircle(handler) {
  const recues = [];
  const server = createServer((req, res) => {
    recues.push({ method: req.method, headers: req.headers });
    const { status = 200, body = {} } = handler(req) || {};
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}/claims`,
    recues,
    fermer: () => new Promise((r) => server.close(r)),
  };
}

/** Exécute fn() avec ENCIRCLE_* positionnés, puis restaure l'environnement. */
async function avecEnv({ token, url }, fn) {
  const avant = { token: process.env.ENCIRCLE_TOKEN, url: process.env.ENCIRCLE_CLAIMS_URL };
  token === undefined ? delete process.env.ENCIRCLE_TOKEN : (process.env.ENCIRCLE_TOKEN = token);
  url === undefined ? delete process.env.ENCIRCLE_CLAIMS_URL : (process.env.ENCIRCLE_CLAIMS_URL = url);
  try { return await fn(); }
  finally {
    avant.token === undefined ? delete process.env.ENCIRCLE_TOKEN : (process.env.ENCIRCLE_TOKEN = avant.token);
    avant.url === undefined ? delete process.env.ENCIRCLE_CLAIMS_URL : (process.env.ENCIRCLE_CLAIMS_URL = avant.url);
  }
}

// ─── AUTHENTIFICATION ─────────────────────────────────────────────────────────

test("le jeton part bien en Bearer, et on annonce vouloir du JSON", async () => {
  const enc = await fauxEncircle(() => ({ body: { claims: [] } }));
  try {
    await avecEnv({ token: "jeton-secret", url: enc.url }, () => fetchClaims());
    assert.equal(enc.recues.length, 1);
    assert.equal(enc.recues[0].headers.authorization, "Bearer jeton-secret");
    assert.equal(enc.recues[0].headers.accept, "application/json");
  } finally { await enc.fermer(); }
});

test("sans jeton, on s'arrête avant tout appel réseau", async () => {
  await avecEnv({ token: undefined, url: "http://127.0.0.1:1/claims" }, async () => {
    await assert.rejects(() => fetchClaims(), /ENCIRCLE_TOKEN manquant/);
  });
});

test("sans URL, on s'arrête avant tout appel réseau", async () => {
  await avecEnv({ token: "x", url: undefined }, async () => {
    await assert.rejects(() => fetchClaims(), /ENCIRCLE_CLAIMS_URL manquant/);
  });
});

// ─── RÉPONSES D'ERREUR ────────────────────────────────────────────────────────

test("un jeton refusé (401) remonte le code, pas une liste vide", async () => {
  const enc = await fauxEncircle(() => ({ status: 401, body: { error: "unauthorized" } }));
  try {
    await avecEnv({ token: "mauvais", url: enc.url }, async () => {
      await assert.rejects(() => fetchClaims(), /401/);
    });
  } finally { await enc.fermer(); }
});

test("une panne côté Encircle (500) remonte aussi", async () => {
  const enc = await fauxEncircle(() => ({ status: 500, body: {} }));
  try {
    await avecEnv({ token: "x", url: enc.url }, async () => {
      await assert.rejects(() => fetchClaims(), /500/);
    });
  } finally { await enc.fermer(); }
});

// ─── FORMES DE RÉPONSE ────────────────────────────────────────────────────────

for (const [nom, corps] of [
  ["un tableau nu", [{ id: "e1" }]],
  ["{ claims: [] }", { claims: [{ id: "e1" }] }],
  ["{ data: [] }", { data: [{ id: "e1" }] }],
  ["{ results: [] }", { results: [{ id: "e1" }] }],
]) {
  test(`la liste est trouvée quand la réponse est ${nom}`, async () => {
    const enc = await fauxEncircle(() => ({ body: corps }));
    try {
      const liste = await avecEnv({ token: "x", url: enc.url }, () => fetchClaims());
      assert.deepEqual(liste, [{ id: "e1" }]);
    } finally { await enc.fermer(); }
  });
}

test("une enveloppe inconnue nomme les clés reçues au lieu de deviner", async () => {
  const enc = await fauxEncircle(() => ({ body: { items: [], next_page: null } }));
  try {
    await avecEnv({ token: "x", url: enc.url }, async () => {
      await assert.rejects(() => fetchClaims(), /items, next_page/);
    });
  } finally { await enc.fermer(); }
});

// ─── NORMALISATION ────────────────────────────────────────────────────────────

test("une réclamation plausible est réduite aux trois champs utiles", () => {
  const c = normalizeClaim({
    id: "enc-42", name: "SDC Le Callière", created_at: "2026-03-26T10:00:00.000Z",
    status: "open", address: { city: "Montréal" },
  });
  assert.deepEqual(c, {
    externalId: "enc-42", client: "SDC Le Callière", createdAt: "2026-03-26T10:00:00.000Z",
  });
});

test("les noms de champs alternatifs sont acceptés", () => {
  const c = normalizeClaim({ claim_id: "enc-7", insured_name: "Résidences Bonaventure", date_of_loss: "2026-02-14" });
  assert.equal(c.externalId, "enc-7");
  assert.equal(c.client, "Résidences Bonaventure");
  assert.equal(c.createdAt, "2026-02-14");
});

test("un champ vide ne masque pas un champ suivant qui, lui, est rempli", () => {
  const c = normalizeClaim({ id: "enc-8", name: "   ", customer_name: "Copropriété du Fleuve" });
  assert.equal(c.client, "Copropriété du Fleuve");
});

test("un client absent n'est pas inventé : il reste indéfini", () => {
  const c = normalizeClaim({ id: "enc-9" });
  assert.equal(c.client, undefined);
  assert.equal(c.createdAt, undefined);
});

test("sans identifiant reconnu, l'erreur nomme les clés reçues", () => {
  assert.throws(
    () => normalizeClaim({ reference_number: "X", nom: "Y" }),
    /reference_number, nom/
  );
});
