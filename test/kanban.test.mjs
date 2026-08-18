import { test } from "node:test";
import assert from "node:assert/strict";
import { PHASES, newDossierTemplate, currentPhase, phaseProgress, groupByPhase } from "../src/dossier.js";

const withTasks = (etats) => {
  const d = newDossierTemplate();
  Object.assign(d.tasks, etats);
  return d;
};

test("un dossier neuf est en intervention d'urgence", () => {
  assert.equal(currentPhase(newDossierTemplate()).id, "urgence");
});

test("le dossier avance dès que la phase précédente est complétée", () => {
  const d = withTasks({ intervention_urgence: "done", rapport_intervention: "done" });
  assert.equal(currentPhase(d).id, "sechage");
});

test("une tâche en cours ne fait pas avancer la colonne", () => {
  const d = withTasks({ intervention_urgence: "done", rapport_intervention: "inprogress" });
  assert.equal(currentPhase(d).id, "urgence");
});

test("une phase sautée ne masque pas la précédente restée ouverte", () => {
  // la reconstruction est entamée mais la facture d'urgence traîne encore
  const d = withTasks({
    intervention_urgence: "done", rapport_intervention: "done", suivi_equipement: "done",
    estimation_urgence: "done", facture_urgence: "pending",
    estimation_reconstruction: "done",
  });
  assert.equal(currentPhase(d).id, "fin_urgence");
});

test("un dossier entièrement complété reste dans la dernière colonne", () => {
  const d = newDossierTemplate();
  for (const k of Object.keys(d.tasks)) d.tasks[k] = "done";
  assert.equal(currentPhase(d).id, PHASES.at(-1).id);
});

test("l'avancement se compte par phase", () => {
  const d = withTasks({ intervention_urgence: "done" });
  const urgence = PHASES[0];
  assert.deepEqual(phaseProgress(d, urgence), { done: 1, total: 2, pct: 50 });
});

test("chaque dossier apparaît dans exactement une colonne", () => {
  const dossiers = [
    newDossierTemplate(),
    withTasks({ intervention_urgence: "done", rapport_intervention: "done" }),
    withTasks({ intervention_urgence: "done", rapport_intervention: "done", suivi_equipement: "done" }),
  ];
  const cols = groupByPhase(dossiers);
  assert.equal(cols.length, PHASES.length);
  assert.equal(cols.reduce((n, c) => n + c.dossiers.length, 0), dossiers.length);
  assert.deepEqual(cols.map(c => c.dossiers.length), [1, 1, 1, 0, 0]);
});
