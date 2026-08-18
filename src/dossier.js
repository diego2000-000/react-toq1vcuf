// ─── LE DOMAINE ───────────────────────────────────────────────────────────────
//
// Le déroulement d'un dossier après sinistre et les règles qui s'y appliquent.
// Aucune dépendance à React : ce fichier tourne aussi bien dans le navigateur
// que dans un script Node, ce qui permet de le tester et de l'utiliser pour
// l'import automatique des dossiers ouverts ailleurs (voir src/merge.js).

// ─── PHASES ───────────────────────────────────────────────────────────────────
export const PHASES = [
  {
    id: "urgence", label: "INTERVENTION D'URGENCE", color: "#E8431A", accent: "#FF6B3D", icon: "🚨",
    duration: "Indéterminée (séchage en cours)",
    tasks: [
      { id: "intervention_urgence", label: "Intervention d'urgence", deadline: "En cours ou complétée" },
      { id: "rapport_intervention", label: "Rapport d'intervention", deadline: "Dans les 24h suivant la fin de l'intervention" },
    ],
  },
  {
    id: "sechage", label: "SÉCHAGE RESTAURATIF", color: "#1A7A5E", accent: "#2EC99A", icon: "💨",
    duration: "Variable selon conditions",
    tasks: [
      { id: "suivi_equipement", label: "Suivi / Pick-up d'équipement", deadline: "Jusqu'à récupération complète", type: "equipment" },
    ],
  },
  {
    id: "fin_urgence", label: "FIN DE L'URGENCE", color: "#C0871A", accent: "#F5AE3A", icon: "📋",
    duration: "Clôture administrative",
    tasks: [
      { id: "estimation_urgence", label: "Estimation d'urgence", deadline: "Dans les 3 jours suivant la fin de l'urgence" },
      { id: "facture_urgence", label: "Facture d'urgence", deadline: "Dans les 3 jours suivant la fin de l'urgence" },
    ],
  },
  {
    id: "reconstruction", label: "PHASE DE RECONSTRUCTION", color: "#1A6E8E", accent: "#3AB8E0", icon: "🏗️",
    duration: "Estimation et mise en chantier",
    tasks: [
      { id: "estimation_reconstruction", label: "Estimé de reconstruction", deadline: "Dans les 7 jours suivant la fin du séchage" },
      { id: "approbation_estime", label: "Approbation de l'estimé", deadline: "Selon assureur / client" },
      { id: "mise_en_chantier", label: "Mise en chantier", deadline: "Délai calculé selon montant et occupation", type: "chantier" },
    ],
  },
  {
    id: "fin_travaux", label: "FIN DE TRAVAUX", color: "#6B3FA0", accent: "#A97FD4", icon: "✅",
    duration: "Clôture du chantier",
    tasks: [
      { id: "travaux_completes", label: "Travaux complétés", deadline: "À la fin du chantier" },
      { id: "facture_finale", label: "Facture finale envoyée", deadline: "Dans les 3 jours suivant la fin des travaux" },
    ],
  },
];

export const ALL_TASKS = PHASES.flatMap(p => p.tasks.map(t => t.id));

// ─── TEMPLATE & HELPERS ───────────────────────────────────────────────────────
export const newDossierTemplate = () => ({
  id: `${new Date().getFullYear().toString().slice(2)}${(new Date().getMonth()+1).toString().padStart(2,"0")}MO${Math.floor(Math.random()*900+100)}`,
  client: "Nouveau client",
  createdAt: new Date().toISOString(),
  finUrgence: "",
  tasks: Object.fromEntries(ALL_TASKS.map(id => [id, "pending"])),
  notes: Object.fromEntries(ALL_TASKS.map(id => [id, ""])),
  visites: [],
  chantier: { dateApprobation: "", tauxOccupation: "", montantEstime: "", dateDebutReelle: "" },
});

export const getProgress = (tasks) => {
  const vals = Object.values(tasks);
  const done = vals.filter(v => v === "done").length;
  return { done, total: vals.length, pct: Math.round((done / vals.length) * 100) };
};

export const getOverallStatus = (tasks) => {
  const vals = Object.values(tasks);
  if (vals.some(v => v === "overdue")) return "overdue";
  if (vals.every(v => v === "done")) return "done";
  if (vals.some(v => v === "inprogress" || v === "done")) return "inprogress";
  return "pending";
};

// ─── POSITION DANS LE DÉROULEMENT ─────────────────────────────────────────────
//
// La phase courante d'un dossier est la première dont toutes les tâches ne sont
// pas complétées. Un dossier entièrement terminé reste dans la dernière colonne
// — c'est là qu'on veut le voir, marqué « Complété ».

export function currentPhase(dossier) {
  const tasks = (dossier && dossier.tasks) || {};
  for (const phase of PHASES) {
    if (phase.tasks.some(t => tasks[t.id] !== "done")) return phase;
  }
  return PHASES[PHASES.length - 1];
}

export function phaseProgress(dossier, phase) {
  const tasks = (dossier && dossier.tasks) || {};
  const done = phase.tasks.filter(t => tasks[t.id] === "done").length;
  return { done, total: phase.tasks.length, pct: Math.round((done / phase.tasks.length) * 100) };
}

// Regroupe les dossiers par colonne, en conservant l'ordre reçu.
export function groupByPhase(dossiers) {
  const cols = new Map(PHASES.map(p => [p.id, []]));
  for (const d of dossiers) cols.get(currentPhase(d).id).push(d);
  return PHASES.map(phase => ({ phase, dossiers: cols.get(phase.id) }));
}

export function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86400000)) : null;
}
