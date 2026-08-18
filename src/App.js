import { useState, useEffect, useCallback, useRef } from "react";
import { PHASES, ALL_TASKS, newDossierTemplate, getProgress, getOverallStatus } from "./dossier";
import { loadDossiers, saveLocal, makePayload, publishSnapshot, stashView, popView } from "./storage";

const FontImport = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,600;0,700;1,400&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0c0c0c; }
    ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 2px; }
    select { appearance: none; -webkit-appearance: none; }
    input:focus, select:focus, textarea:focus { outline: none; }
    textarea { resize: none; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    @keyframes slideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.25s ease forwards; }
    .slide-in { animation: slideIn 0.2s ease forwards; }
  `}</style>
);


const STATUS = {
  pending:    { bg: "#151515", border: "#2a2a2a", text: "#666",    label: "En attente",  dot: "#555"    },
  inprogress: { bg: "#141a0e", border: "#3d6a1a", text: "#8fcc44", label: "En cours",    dot: "#8fcc44" },
  done:       { bg: "#0d1710", border: "#175e30", text: "#3ad876", label: "Complété",    dot: "#3ad876" },
  overdue:    { bg: "#180d0d", border: "#6e1a1a", text: "#cc4444", label: "En retard",   dot: "#cc4444" },
};

// Equipment-specific status labels
const EQUIP_STATUS = {
  pending:    { ...STATUS.pending,    label: "En attente"            },
  inprogress: { ...STATUS.inprogress, label: "Séchage en cours"      },
  done:       { ...STATUS.done,       label: "Équipement récupéré ✓" },
  overdue:    { ...STATUS.overdue,    label: "En retard"             },
};

const DEADLINES = [
  { taskId: "rapport_intervention",     label: "Rapport d'intervention",  hoursAfter: 24,  color: "#FF6B3D" },
  { taskId: "estimation_urgence",       label: "Estimation d'urgence",    hoursAfter: 72,  color: "#F5AE3A" },
  { taskId: "facture_urgence",          label: "Facture d'urgence",       hoursAfter: 72,  color: "#F5AE3A" },
  { taskId: "estimation_reconstruction",label: "Estimé reconstruction",   hoursAfter: 168, color: "#3AB8E0" },
];

function formatDelta(ms) {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600000);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  if (d === 0) return `${h}h`;
  if (rh === 0) return `${d}j`;
  return `${d}j ${rh}h`;
}

function formatDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-CA", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" });
}


// ─── STORAGE ──────────────────────────────────────────────────────────────────
const SEED = [
  {
    id: "2603MO027", client: "SDC Le Callière", createdAt: "2026-03-26T10:00:00.000Z",
    finUrgence: "2026-03-28T16:00",
    tasks: { intervention_urgence: "done", rapport_intervention: "pending", suivi_equipement: "inprogress", estimation_urgence: "inprogress", facture_urgence: "pending", estimation_reconstruction: "pending", approbation_estime: "pending", mise_en_chantier: "pending", travaux_completes: "pending", facture_finale: "pending" },
    notes: { intervention_urgence: "", rapport_intervention: "Pompage 3h, pose de 6 déshumidificateurs.", suivi_equipement: "", estimation_urgence: "", facture_urgence: "", estimation_reconstruction: "", approbation_estime: "", mise_en_chantier: "", travaux_completes: "", facture_finale: "" },
    visites: [{ id: "v1", date: "2026-03-30T09:00:00.000Z", note: "Séchage en cours, déshumidificateurs opérationnels. Prochaine visite dans 2 jours." }],
    chantier: { dateApprobation: "", tauxOccupation: "", montantEstime: "", dateDebutReelle: "" },
  },
  {
    id: "2602MO014", client: "Résidences Bonaventure", createdAt: "2026-02-14T08:30:00.000Z",
    finUrgence: "2026-02-16T10:00",
    tasks: Object.fromEntries(ALL_TASKS.map(id => [id, "done"])),
    notes: Object.fromEntries(ALL_TASKS.map(id => [id, ""])),
    visites: [
      { id: "v1", date: "2026-02-18T10:00:00.000Z", note: "Séchage incomplet, équipement laissé en place." },
      { id: "v2", date: "2026-02-21T14:00:00.000Z", note: "Séchage complété. Équipement récupéré." },
    ],
    chantier: { dateApprobation: "2026-02-24", tauxOccupation: "inoccupe", montantEstime: "4500", dateDebutReelle: "2026-03-10" },
  },
  {
    id: "2603MO031", client: "Copropriété du Fleuve", createdAt: "2026-03-28T14:00:00.000Z",
    finUrgence: "",
    tasks: Object.fromEntries(ALL_TASKS.map(id => [id, "pending"])),
    notes: Object.fromEntries(ALL_TASKS.map(id => [id, ""])),
    visites: [],
    chantier: { dateApprobation: "", tauxOccupation: "", montantEstime: "", dateDebutReelle: "" },
  },
];

// ─── SYNCHRONISATION ──────────────────────────────────────────────────────────
// Chaque modification part dans localStorage sur-le-champ. La publication dans
// la page — la seule couche partagée entre appareils — est groupée : elle
// recharge toutes les vues ouvertes, on ne la déclenche donc pas à chaque
// frappe, ni pendant qu'un champ est en train d'être rempli.

const SYNC_DELAY_MS   = 6000;  // silence requis avant de publier
const SYNC_BUSY_MS    = 3000;  // on repasse plus tard si un champ est actif
const SYNC_BACKOFF_MS = 30000; // publication trop fréquente : on ralentit

const SYNC_LABEL = {
  synced:   { text: "Synchronisé",        color: "#3ad876", dot: "#175e30" },
  pending:  { text: "Modifications",      color: "#8fcc44", dot: "#3d6a1a" },
  saving:   { text: "Publication…",       color: "#3AB8E0", dot: "#1A6E8E" },
  local:    { text: "Cet appareil seul",  color: "#666",    dot: "#2a2a2a" },
  readonly: { text: "Lecture seule",      color: "#666",    dot: "#2a2a2a" },
  error:    { text: "Échec — réessayer",  color: "#cc4444", dot: "#6e1a1a" },
};

const isFieldActive = () => {
  const el = document.activeElement;
  return !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

function SyncChip({ state, onSave }) {
  const s = SYNC_LABEL[state] || SYNC_LABEL.local;
  const actionable = state === "pending" || state === "error";
  return (
    <div style={{ position: "fixed", right: 14, bottom: 14, zIndex: 50 }}>
      <button
        onClick={actionable ? onSave : undefined}
        disabled={!actionable}
        title={actionable ? "Publier maintenant" : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 7,
          background: "#111", border: `1px solid ${s.dot}`, borderRadius: 999,
          padding: "6px 12px", fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 10, letterSpacing: "0.08em", color: s.color,
          cursor: actionable ? "pointer" : "default", transition: "all 0.15s" }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color,
          animation: state === "saving" ? "pulse 1.2s ease-in-out infinite" : "none" }} />
        {s.text.toUpperCase()}
      </button>
    </div>
  );
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
function StatusBadge({ status, small, equip }) {
  const map = equip ? EQUIP_STATUS : STATUS;
  const s = map[status] || STATUS[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: s.bg,
      border: `1px solid ${s.border}`, borderRadius: 4, padding: small ? "2px 7px" : "3px 9px",
      fontSize: small ? 10 : 11, color: s.text, fontFamily: "'IBM Plex Mono', monospace",
      fontWeight: 600, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot, flexShrink: 0,
        animation: status === "inprogress" ? "pulse 2s ease-in-out infinite" : "none" }} />
      {s.label}
    </span>
  );
}

function ProgressBar({ pct, color = "#3AB8E0", height = 3 }) {
  return (
    <div style={{ height, background: "#1e1e1e", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.5s ease" }} />
    </div>
  );
}

// ─── DEADLINE TIMELINE ────────────────────────────────────────────────────────
function DeadlineTimeline({ finUrgence, tasks, onFinUrgenceChange }) {
  const base = finUrgence ? new Date(finUrgence) : null;
  const now = new Date();
  return (
    <div style={{ marginBottom: 22, background: "#0f0f0f", border: "1px solid #1c1c1c", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "11px 16px", borderBottom: "1px solid #1a1a1a", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, letterSpacing: "0.15em", color: "#555", fontWeight: 700 }}>⏱ ÉCHÉANCES</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a" }}>Fin d'urgence :</span>
          <input type="datetime-local" value={finUrgence || ""} onChange={e => onFinUrgenceChange(e.target.value)}
            style={{ background: "#161616", border: "1px solid #2a2a2a", borderRadius: 4,
              color: finUrgence ? "#b09878" : "#444", fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 11, padding: "4px 8px", colorScheme: "dark" }} />
        </div>
      </div>
      <div style={{ padding: "12px 16px 14px", position: "relative" }}>
        {!base ? (
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#2e2e2e", textAlign: "center", padding: "10px 0" }}>
            — Saisir la date de fin d'urgence pour activer —
          </div>
        ) : (
          <>
            <div style={{ position: "absolute", left: 23, top: 20, bottom: 20, width: 1, background: "#1e1e1e" }} />
            {DEADLINES.map(({ taskId, label, hoursAfter, color }) => {
              const deadline = new Date(base.getTime() + hoursAfter * 3600000);
              const isDone = tasks[taskId] === "done";
              const delta = deadline - now;
              const isLate = delta < 0 && !isDone;
              const isSoon = delta > 0 && delta < 8 * 3600000 && !isDone;
              const dLabel = hoursAfter < 24 ? `J+${hoursAfter}h` : `J+${hoursAfter / 24}`;
              const dotBorder = isDone ? "#3ad876" : isLate ? "#cc4444" : isSoon ? "#F5AE3A" : "#333";
              const rowBg = isLate ? "rgba(90,15,15,0.18)" : isSoon ? "rgba(90,60,10,0.12)" : "transparent";
              const statusText = isDone ? "✓ Complété" : isLate ? `EN RETARD · +${formatDelta(delta)}` : delta > 0 ? `dans ${formatDelta(delta)}` : "";
              const statusColor = isDone ? "#3ad876" : isLate ? "#cc4444" : isSoon ? "#F5AE3A" : "#444";
              return (
                <div key={taskId} style={{ display: "flex", alignItems: "flex-start", gap: 14,
                  padding: "7px 8px", borderRadius: 6, background: rowBg, marginBottom: 2, position: "relative", zIndex: 1 }}>
                  <div style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, marginTop: 2,
                    background: "#111", border: `2px solid ${dotBorder}`,
                    animation: isLate ? "pulse 1.4s ease-in-out infinite" : "none" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                        color: isLate ? "#e0d8c8" : "#666", fontWeight: isLate ? 600 : 400 }}>{label}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color, opacity: 0.6 }}>{dLabel}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 1, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#383838" }}>
                        {deadline.toLocaleDateString("fr-CA", { day: "2-digit", month: "short" })} à {deadline.toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {statusText && <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: statusColor, fontWeight: 600 }}>{statusText}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ─── EQUIPMENT SUIVI CARD ─────────────────────────────────────────────────────
function EquipmentSuiviCard({ value, onChange, visites, onVisitesChange }) {
  const [newNote, setNewNote] = useState("");
  const [adding, setAdding] = useState(false);
  const s = EQUIP_STATUS[value] || EQUIP_STATUS.pending;
  const isRecovered = value === "done";

  const addVisite = () => {
    if (!newNote.trim()) return;
    const v = { id: `v${Date.now()}`, date: new Date().toISOString(), note: newNote.trim() };
    onVisitesChange([...(visites || []), v]);
    setNewNote("");
    setAdding(false);
    if (value === "pending") onChange("suivi_equipement", "inprogress");
  };

  const removeVisite = (id) => onVisitesChange((visites || []).filter(v => v.id !== id));

  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "14px 16px", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: "#e8e8e0", marginBottom: 4 }}>
            Suivi / Pick-up d'équipement
          </div>
          <div style={{ fontSize: 11, color: "#555", fontFamily: "'IBM Plex Mono', monospace" }}>
            ⏱ Jusqu'à récupération complète
          </div>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <select value={value} onChange={e => onChange("suivi_equipement", e.target.value)}
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text,
              borderRadius: 4, padding: "4px 24px 4px 8px", fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", minWidth: 170 }}>
            <option value="pending">En attente</option>
            <option value="inprogress">Séchage en cours</option>
            <option value="done">Équipement récupéré ✓</option>
            <option value="overdue">En retard</option>
          </select>
          <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)",
            color: s.text, fontSize: 9, pointerEvents: "none" }}>▾</span>
        </div>
      </div>

      {/* Visites log */}
      {((visites && visites.length > 0) || !isRecovered) && (
        <div style={{ borderTop: "1px solid #1a1a1a", padding: "12px 16px 14px" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10,
            letterSpacing: "0.1em", color: "#2EC99A", marginBottom: 10, fontWeight: 700 }}>
            JOURNAL DES VISITES
          </div>

          {/* Existing visits */}
          {(visites || []).map((v, i) => (
            <div key={v.id} className="slide-in"
              style={{ display: "flex", gap: 12, marginBottom: 8, position: "relative" }}>
              {/* Timeline dot + line */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#0e1a14",
                  border: "2px solid #1A7A5E", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#2EC99A", fontWeight: 700 }}>
                  {i + 1}
                </div>
                {i < (visites.length - 1) && <div style={{ width: 1, flex: 1, background: "#1a2e24", marginTop: 3 }} />}
              </div>
              <div style={{ flex: 1, background: "#0d1710", border: "1px solid #1a2e20",
                borderRadius: 6, padding: "8px 10px", marginBottom: i < visites.length - 1 ? 4 : 0 }}>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#2a6040", marginBottom: 4 }}>
                  {formatDateShort(v.date)}
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#8ab898", lineHeight: 1.5 }}>
                  {v.note}
                </div>
              </div>
              <button onClick={() => removeVisite(v.id)}
                style={{ background: "none", border: "none", color: "#2a2a2a", cursor: "pointer",
                  fontSize: 14, padding: "2px", alignSelf: "flex-start", lineHeight: 1, flexShrink: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = "#cc4444"}
                onMouseLeave={e => e.currentTarget.style.color = "#2a2a2a"}>×</button>
            </div>
          ))}

          {/* Add visit form */}
          {!isRecovered && (
            adding ? (
              <div className="slide-in" style={{ marginTop: 6 }}>
                <textarea autoFocus value={newNote} onChange={e => setNewNote(e.target.value)}
                  placeholder="Note de visite (état du séchage, observations…)"
                  rows={2}
                  style={{ width: "100%", background: "#0e0e0e", border: "1px solid #1a3a28",
                    borderRadius: 6, padding: "8px 10px", color: "#8ab898",
                    fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.5,
                    marginBottom: 8 }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={addVisite}
                    style={{ background: "#0d1f16", border: "1px solid #1A7A5E", borderRadius: 4,
                      color: "#2EC99A", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                      padding: "5px 14px", cursor: "pointer" }}>
                    Enregistrer
                  </button>
                  <button onClick={() => { setAdding(false); setNewNote(""); }}
                    style={{ background: "none", border: "1px solid #222", borderRadius: 4,
                      color: "#444", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                      padding: "5px 14px", cursor: "pointer" }}>
                    Annuler
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)}
                style={{ marginTop: (visites && visites.length > 0) ? 8 : 0,
                  background: "none", border: "1px dashed #1a3a28", borderRadius: 6,
                  color: "#2a5a40", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                  padding: "7px 14px", cursor: "pointer", width: "100%", transition: "all 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "#2EC99A"; e.currentTarget.style.color = "#2EC99A"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a3a28"; e.currentTarget.style.color = "#2a5a40"; }}>
                + Ajouter une visite
              </button>
            )
          )}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ height: 3, background: "#1e1e1e" }}>
        <div style={{ height: "100%", borderRadius: 0, transition: "width 0.4s ease",
          width: isRecovered ? "100%" : value === "inprogress" ? "50%" : value === "overdue" ? "100%" : "0%",
          background: value === "overdue" ? "#cc4444" : isRecovered ? "#3ad876" : "#2EC99A" }} />
      </div>
    </div>
  );
}

// ─── MISE EN CHANTIER CARD ────────────────────────────────────────────────────
const OCCUPATION = [
  { value: "",        label: "— Sélectionner —",        weeks: 0,  note: "" },
  { value: "inoccupe",label: "Inoccupé",                 weeks: 0,  note: "Aucun délai additionnel" },
  { value: "partiel", label: "Partiellement occupé",     weeks: 1,  note: "+1 semaine — coordination requise selon les zones" },
  { value: "occupe",  label: "Occupé",                   weeks: 2,  note: "+2 semaines — délai additionnel à prévoir avec le client" },
];

function getBaseWeeks(montant) {
  const m = parseFloat(montant);
  if (isNaN(m) || montant === "") return null;
  if (m <= 2000)  return { weeks: 1, label: "0 – 2 000 $" };
  if (m <= 7000)  return { weeks: 2, label: "2 000 – 7 000 $" };
  if (m <= 15000) return { weeks: 3, label: "7 000 – 15 000 $" };
  return { weeks: 3, label: "15 000 $+" };
}

function MiseEnChantierCard({ value, onChange, chantier, onChantierChange }) {
  const s = STATUS[value] || STATUS.pending;
  const update = (key, val) => onChantierChange({ ...chantier, [key]: val });

  const handleApprobation = (val) => {
    update("dateApprobation", val);
    if (val && value === "pending") onChange("mise_en_chantier", "inprogress");
  };

  const montant = chantier.montantEstime || "";
  const baseInfo = getBaseWeeks(montant);
  const occupInfo = OCCUPATION.find(o => o.value === chantier.tauxOccupation) || OCCUPATION[0];
  const totalWeeks = baseInfo ? baseInfo.weeks + occupInfo.weeks : null;

  const dateDebutPrevue = (chantier.dateApprobation && totalWeeks !== null)
    ? new Date(new Date(chantier.dateApprobation).getTime() + totalWeeks * 7 * 24 * 3600000)
    : null;
  const now = new Date();

  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 10 }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: "#e8e8e0", marginBottom: 4 }}>
            Mise en chantier
          </div>
          <div style={{ fontSize: 11, color: "#555", fontFamily: "'IBM Plex Mono', monospace" }}>
            ⏱ Délai calculé selon montant et occupation
          </div>
        </div>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <select value={value} onChange={e => onChange("mise_en_chantier", e.target.value)}
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text,
              borderRadius: 4, padding: "4px 24px 4px 8px", fontSize: 11,
              fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", minWidth: 150 }}>
            <option value="pending">En attente</option>
            <option value="inprogress">Planifié</option>
            <option value="done">Travaux complétés</option>
            <option value="overdue">En retard</option>
          </select>
          <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", color: s.text, fontSize: 9, pointerEvents: "none" }}>▾</span>
        </div>
      </div>

      <div style={{ borderTop: "1px solid #1a1a1a", padding: "14px 16px 16px" }}>

        {/* Row 1 : montant + taux occupation */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a", letterSpacing: "0.08em", marginBottom: 5 }}>
              MONTANT DE L'ESTIMÉ ($)
            </div>
            <input type="number" min="0" placeholder="ex. 4500"
              value={montant} onChange={e => update("montantEstime", e.target.value)}
              style={{ background: "#0e0e0e", border: `1px solid ${montant ? "#1a3a5e" : "#222"}`,
                borderRadius: 4, color: montant ? "#7ab8e0" : "#444",
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
                padding: "6px 10px", width: "100%" }} />
            {baseInfo && (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a5e7a", marginTop: 4 }}>
                {baseInfo.label} → base {baseInfo.weeks} sem.
              </div>
            )}
          </div>
          <div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a", letterSpacing: "0.08em", marginBottom: 5 }}>
              TAUX D'OCCUPATION
            </div>
            <div style={{ position: "relative" }}>
              <select value={chantier.tauxOccupation || ""} onChange={e => update("tauxOccupation", e.target.value)}
                style={{ background: "#0e0e0e", border: `1px solid ${chantier.tauxOccupation ? "#1a3a5e" : "#222"}`,
                  borderRadius: 4, color: chantier.tauxOccupation ? "#7ab8e0" : "#444",
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
                  padding: "6px 24px 6px 10px", width: "100%", cursor: "pointer" }}>
                {OCCUPATION.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", color: "#3a3a3a", fontSize: 9, pointerEvents: "none" }}>▾</span>
            </div>
            {occupInfo.note && (
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a5e7a", marginTop: 4 }}>
                {occupInfo.note}
              </div>
            )}
          </div>
        </div>

        {/* Delay summary box */}
        {(baseInfo || occupInfo.weeks > 0) && baseInfo && (
          <div className="slide-in" style={{ marginBottom: 14, padding: "10px 14px",
            background: "#0c1520", border: "1px solid #1a2a3e", borderRadius: 6,
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a5a7a" }}>
              DÉLAI TOTAL
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: "#3AB8E0" }}>
                {totalWeeks} semaine{totalWeeks > 1 ? "s" : ""}
              </span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#2a4a6a" }}>
                = {baseInfo.weeks} sem. (estimé)
                {occupInfo.weeks > 0 ? ` + ${occupInfo.weeks} sem. (occupation)` : ""}
              </span>
            </div>
          </div>
        )}

        {/* Date approbation */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a", letterSpacing: "0.08em", marginBottom: 5 }}>
            DATE D'APPROBATION DE L'ESTIMÉ
          </div>
          <input type="date" value={chantier.dateApprobation || ""} onChange={e => handleApprobation(e.target.value)}
            style={{ background: "#0e0e0e", border: `1px solid ${chantier.dateApprobation ? "#1a3a5e" : "#222"}`,
              borderRadius: 4, color: chantier.dateApprobation ? "#7ab8e0" : "#444",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              padding: "6px 10px", width: "100%", colorScheme: "dark" }} />
        </div>

        {/* Calculated start date */}
        {dateDebutPrevue && (
          <div className="slide-in" style={{ marginBottom: 14, padding: "10px 12px",
            background: "#0c1a14", border: "1px solid #1a3a28", borderRadius: 6 }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#2a6040", marginBottom: 4, letterSpacing: "0.08em" }}>
              DATE DE DÉBUT PRÉVUE ({totalWeeks} SEM.)
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14, fontWeight: 700, color: "#2EC99A" }}>
                {dateDebutPrevue.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </span>
              {dateDebutPrevue < now && value !== "done" && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#cc4444", fontWeight: 600, animation: "pulse 1.4s ease-in-out infinite" }}>
                  EN RETARD
                </span>
              )}
              {dateDebutPrevue > now && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#555" }}>
                  dans {formatDelta(dateDebutPrevue - now)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Actual start date */}
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a", letterSpacing: "0.08em", marginBottom: 5 }}>
            DATE RÉELLE DE DÉBUT DES TRAVAUX
          </div>
          <input type="date" value={chantier.dateDebutReelle || ""} onChange={e => {
              update("dateDebutReelle", e.target.value);
              if (e.target.value) onChange("mise_en_chantier", "inprogress");
            }}
            style={{ background: "#0e0e0e", border: `1px solid ${chantier.dateDebutReelle ? "#175e30" : "#222"}`,
              borderRadius: 4, color: chantier.dateDebutReelle ? "#3ad876" : "#444",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              padding: "6px 10px", width: "100%", colorScheme: "dark" }} />
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: "#1e1e1e" }}>
        <div style={{ height: "100%", transition: "width 0.4s ease",
          width: value === "done" ? "100%" : value === "inprogress" ? "60%" : value === "overdue" ? "100%" : "0%",
          background: value === "overdue" ? "#cc4444" : value === "done" ? "#3ad876" : "#3AB8E0" }} />
      </div>
    </div>
  );
}

// ─── TASK CARD (standard) ─────────────────────────────────────────────────────
function TaskCard({ task, phaseAccent, value, onChange, note, onNoteChange }) {
  const s = STATUS[value];
  const [showNote, setShowNote] = useState(!!note);
  const hasNote = note && note.trim().length > 0;
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: "14px 16px", marginBottom: 10, transition: "all 0.2s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 600, color: "#e8e8e0", marginBottom: 5 }}>{task.label}</div>
          <div style={{ fontSize: 11, color: "#555", fontFamily: "'IBM Plex Mono', monospace" }}>⏱ {task.deadline}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button onClick={() => setShowNote(v => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "3px 5px",
              fontSize: 14, color: hasNote ? "#F5AE3A" : "#444", transition: "color 0.15s", lineHeight: 1 }}
            onMouseEnter={e => e.currentTarget.style.color = hasNote ? "#F5AE3A" : "#777"}
            onMouseLeave={e => e.currentTarget.style.color = hasNote ? "#F5AE3A" : "#444"}>✎</button>
          <div style={{ position: "relative" }}>
            <select value={value} onChange={e => onChange(task.id, e.target.value)}
              style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text,
                borderRadius: 4, padding: "4px 24px 4px 8px", fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer", minWidth: 110 }}>
              <option value="pending">En attente</option>
              <option value="inprogress">En cours</option>
              <option value="done">Complété</option>
              <option value="overdue">En retard</option>
            </select>
            <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", color: s.text, fontSize: 9, pointerEvents: "none" }}>▾</span>
          </div>
        </div>
      </div>
      {showNote && (
        <div style={{ marginTop: 10 }}>
          <textarea autoFocus value={note} onChange={e => onNoteChange(task.id, e.target.value)}
            placeholder="Ajouter une note…" rows={3}
            style={{ width: "100%", background: "#0e0e0e", border: `1px solid ${hasNote ? "#2e2a1a" : "#1e1e1e"}`,
              borderRadius: 6, padding: "9px 11px", color: "#a09880",
              fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, lineHeight: 1.6 }} />
        </div>
      )}
      <div style={{ marginTop: 10, height: 3, background: "#1e1e1e", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 2, transition: "width 0.4s ease",
          width: value === "done" ? "100%" : value === "inprogress" ? "50%" : value === "overdue" ? "100%" : "0%",
          background: value === "overdue" ? "#cc4444" : value === "done" ? "#3ad876" : phaseAccent }} />
      </div>
    </div>
  );
}

// ─── PHASE BLOCK ──────────────────────────────────────────────────────────────
function PhaseBlock({ phase, index, tasks, notes, visites, chantier, onTaskChange, onNoteChange, onVisitesChange, onChantierChange }) {
  const [open, setOpen] = useState(true);
  const phaseDone = phase.tasks.filter(t => tasks[t.id] === "done").length;

  return (
    <div style={{ marginBottom: 14, borderRadius: 10, overflow: "hidden", border: "1px solid #1e1e1e", background: "#111" }}>
      <div onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 18px",
          background: "#141414", borderBottom: open ? "1px solid #1e1e1e" : "none",
          cursor: "pointer", userSelect: "none" }}>
        <div style={{ width: 4, height: 44, background: phase.color, borderRadius: 2, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span>{phase.icon}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11,
              letterSpacing: "0.12em", color: phase.accent, fontWeight: 700 }}>
              PHASE {index + 1} — {phase.label}
            </span>
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#444" }}>
            {phase.duration} · {phaseDone}/{phase.tasks.length} complété{phaseDone !== 1 ? "s" : ""}
          </div>
        </div>
        <span style={{ color: "#333", fontSize: 12, transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
      </div>
      {open && (
        <div style={{ padding: "14px 16px" }}>
          {phase.tasks.map(task =>
            task.type === "equipment"
              ? <EquipmentSuiviCard key={task.id}
                  value={tasks[task.id] || "pending"}
                  onChange={onTaskChange}
                  visites={visites}
                  onVisitesChange={onVisitesChange} />
              : task.type === "chantier"
              ? <MiseEnChantierCard key={task.id}
                  value={tasks[task.id] || "pending"}
                  onChange={onTaskChange}
                  chantier={chantier || {}}
                  onChantierChange={onChantierChange} />
              : <TaskCard key={task.id} task={task} phaseAccent={phase.accent}
                  value={tasks[task.id] || "pending"} onChange={onTaskChange}
                  note={notes?.[task.id] || ""} onNoteChange={onNoteChange} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── DOSSIER CARD (home) ──────────────────────────────────────────────────────
function DossierCard({ dossier, onClick }) {
  const { done, total, pct } = getProgress(dossier.tasks);
  const status = getOverallStatus(dossier.tasks);
  const noteCount = Object.values(dossier.notes || {}).filter(n => n && n.trim()).length;
  const visitCount = (dossier.visites || []).length;
  const date = new Date(dossier.createdAt).toLocaleDateString("fr-CA", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="fade-in" onClick={onClick}
      style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: 10,
        padding: "18px 20px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s",
        position: "relative", overflow: "hidden" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#2e2e2e"; e.currentTarget.style.background = "#141414"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e1e"; e.currentTarget.style.background = "#111"; }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: "linear-gradient(90deg, #E8431A 0%, #1A7A5E 33%, #C0871A 66%, #1A6E8E 100%)",
        opacity: pct / 100 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 17, fontWeight: 700, color: "#e0d8c8", letterSpacing: "0.04em", marginBottom: 4 }}>{dossier.id}</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#666" }}>{dossier.client}</div>
        </div>
        <StatusBadge status={status} small />
      </div>
      <ProgressBar pct={pct} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#444" }}>
        <span>
          {done}/{total} tâches
          {visitCount > 0 ? ` · 💨 ${visitCount} visite${visitCount > 1 ? "s" : ""}` : ""}
          {noteCount > 0 ? ` · ✎ ${noteCount}` : ""}
        </span>
        <span>{date}</span>
      </div>
    </div>
  );
}

// ─── DETAIL VIEW ──────────────────────────────────────────────────────────────
function DossierDetail({ dossier, onBack, onUpdate }) {
  const [localId, setLocalId] = useState(dossier.id);
  const [localClient, setLocalClient] = useState(dossier.client);
  const { done, total, pct } = getProgress(dossier.tasks);

  const handleTaskChange   = (tid, v) => onUpdate({ ...dossier, tasks: { ...dossier.tasks, [tid]: v } });
  const handleNoteChange   = (tid, v) => onUpdate({ ...dossier, notes: { ...(dossier.notes || {}), [tid]: v } });
  const handleFinUrgence   = (v)      => onUpdate({ ...dossier, finUrgence: v });
  const handleVisites      = (v)      => onUpdate({ ...dossier, visites: v });
  const handleChantier     = (v)      => onUpdate({ ...dossier, chantier: v });

  return (
    <div className="fade-in">
      <button onClick={onBack}
        style={{ background: "none", border: "none", color: "#555", fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11, cursor: "pointer", padding: "0 0 20px 0", display: "flex", alignItems: "center", gap: 6 }}
        onMouseEnter={e => e.currentTarget.style.color = "#888"}
        onMouseLeave={e => e.currentTarget.style.color = "#555"}>
        ← Tous les dossiers
      </button>

      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.2em", color: "#333", marginBottom: 8 }}>DKI REFEXIO — SUIVI DE DOSSIER</div>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-end", marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "#3a3a3a", marginBottom: 3 }}>N° DOSSIER</div>
            <input value={localId} onChange={e => setLocalId(e.target.value)}
              onBlur={() => onUpdate({ ...dossier, id: localId })}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid #2a2a2a",
                color: "#e0d8c8", fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, width: 200, padding: "2px 0" }} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#3a3a3a", marginBottom: 3 }}>CLIENT</div>
            <input value={localClient} onChange={e => setLocalClient(e.target.value)}
              onBlur={() => onUpdate({ ...dossier, client: localClient })}
              style={{ background: "transparent", border: "none", borderBottom: "1px solid #2a2a2a",
                color: "#777", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, width: 240, padding: "2px 0" }} />
          </div>
          <StatusBadge status={getOverallStatus(dossier.tasks)} />
        </div>
        <div style={{ marginBottom: 4 }}>
          <ProgressBar pct={pct} color={pct === 100 ? "#3ad876" : "#3AB8E0"} height={4} />
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#444" }}>
          {done}/{total} tâches · {pct}% complété
        </div>
      </div>

      <DeadlineTimeline finUrgence={dossier.finUrgence || ""} tasks={dossier.tasks} onFinUrgenceChange={handleFinUrgence} />

      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        {Object.entries(STATUS).map(([key, val]) => (
          <div key={key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: val.text, fontFamily: "'IBM Plex Mono', monospace" }}>
            <div style={{ width: 6, height: 6, borderRadius: 2, background: val.text, opacity: 0.8 }} />
            {val.label}
          </div>
        ))}
      </div>

      {PHASES.map((phase, i) => (
        <PhaseBlock key={phase.id} phase={phase} index={i}
          tasks={dossier.tasks} notes={dossier.notes || {}}
          visites={dossier.visites || []}
          chantier={dossier.chantier || {}}
          onTaskChange={handleTaskChange} onNoteChange={handleNoteChange}
          onVisitesChange={handleVisites} onChantierChange={handleChantier} />
      ))}

      <div style={{ marginTop: 20, padding: "12px 16px", background: "#0e0e0e", borderRadius: 8, border: "1px solid #181818" }}>
        <div style={{ fontSize: 10, color: "#383838", lineHeight: 1.8, fontFamily: "'IBM Plex Mono', monospace" }}>
          ⚠ Les délais débutent à la confirmation de fin d'urgence.<br />
          Rapport : J+24h · Estimation + Facture urgence : J+3 · Estimé reconstruction : J+7
        </div>
      </div>
    </div>
  );
}

// ─── HOME VIEW ────────────────────────────────────────────────────────────────
function HomeView({ dossiers, onOpen, onNew }) {
  const total = dossiers.length;
  const completed = dossiers.filter(d => getOverallStatus(d.tasks) === "done").length;
  const overdue = dossiers.filter(d => getOverallStatus(d.tasks) === "overdue").length;

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.22em", color: "#333", marginBottom: 6 }}>DKI REFEXIO</div>
        <h1 style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: "#e0d8c8", letterSpacing: "0.03em", marginBottom: 2 }}>DOSSIERS ACTIFS</h1>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#3a3a3a" }}>Suivi des interventions en cours</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 24 }}>
        {[
          { label: "TOTAL",     value: total,             color: "#555"    },
          { label: "EN COURS",  value: total - completed, color: "#3AB8E0" },
          { label: "EN RETARD", value: overdue,           color: overdue > 0 ? "#cc4444" : "#333" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#111", border: "1px solid #1a1a1a", borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#3a3a3a", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 24, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {dossiers.length === 0
          ? <div style={{ textAlign: "center", padding: "40px 0", fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#333" }}>Aucun dossier.</div>
          : dossiers.map(d => <DossierCard key={d.id} dossier={d} onClick={() => onOpen(d.id)} />)
        }
      </div>
      <button onClick={onNew}
        style={{ width: "100%", padding: "13px", background: "transparent",
          border: "1px dashed #252525", borderRadius: 10, color: "#3a3a3a",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, cursor: "pointer",
          transition: "all 0.15s", letterSpacing: "0.08em" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "#3a3a3a"; e.currentTarget.style.color = "#666"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "#252525"; e.currentTarget.style.color = "#3a3a3a"; }}>
        + NOUVEAU DOSSIER
      </button>
    </div>
  );
}

// ─── PIN ──────────────────────────────────────────────────────────────────────
const APP_PIN = "2601"; // ← Changer le PIN ici

function PinScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const tryPin = (val) => {
    if (val.length < 4) return;
    if (val === APP_PIN) {
      sessionStorage.setItem("dki-auth", "1");
      onUnlock();
    } else {
      setShake(true);
      setError(true);
      setPin("");
      setTimeout(() => { setShake(false); setError(false); }, 600);
    }
  };

  const press = (digit) => {
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) tryPin(next);
  };

  const del = () => setPin(p => p.slice(0, -1));

  const KEYS = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c0c", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace", padding: 24 }}>
      <FontImport />

      <div style={{ marginBottom: 32, textAlign: "center" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.25em", color: "#333", marginBottom: 10 }}>DKI REFEXIO</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#e0d8c8", letterSpacing: "0.04em", marginBottom: 4 }}>
          ACCÈS SÉCURISÉ
        </div>
        <div style={{ fontSize: 11, color: "#3a3a3a" }}>Entrez votre PIN pour continuer</div>
      </div>

      {/* PIN dots */}
      <div style={{
        display: "flex", gap: 14, marginBottom: 32,
        animation: shake ? "shake 0.5s ease" : "none",
      }}>
        <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }`}</style>
        {[0,1,2,3].map(i => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: "50%",
            background: i < pin.length ? (error ? "#cc4444" : "#e0d8c8") : "transparent",
            border: `2px solid ${i < pin.length ? (error ? "#cc4444" : "#e0d8c8") : "#2a2a2a"}`,
            transition: "all 0.15s",
          }} />
        ))}
      </div>

      {/* Numpad */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: 220 }}>
        {KEYS.map((k, i) => (
          <button key={i} onClick={() => k === "⌫" ? del() : k !== "" ? press(k) : null}
            disabled={k === ""}
            style={{
              height: 58, borderRadius: 8, border: "1px solid #1e1e1e",
              background: k === "" ? "transparent" : "#111",
              color: k === "⌫" ? "#555" : "#e0d8c8",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: k === "⌫" ? 18 : 20, fontWeight: 600,
              cursor: k === "" ? "default" : "pointer",
              transition: "all 0.1s",
              opacity: k === "" ? 0 : 1,
            }}
            onMouseEnter={e => { if(k) e.currentTarget.style.background = "#1a1a1a"; }}
            onMouseLeave={e => { if(k) e.currentTarget.style.background = "#111"; }}
          >{k}</button>
        ))}
      </div>

      {error && (
        <div style={{ marginTop: 20, fontSize: 11, color: "#cc4444", letterSpacing: "0.05em" }}>
          PIN incorrect — réessayez
        </div>
      )}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem("dki-auth") === "1");
  const [dossiers, setDossiers] = useState(null);
  const [activeDossierId, setActiveDossierId] = useState(null);
  const [syncState, setSyncState] = useState("synced");

  const dossiersRef = useRef(null);
  const timerRef = useRef(null);
  const publishRef = useRef(null);
  const restoredRef = useRef(false);

  useEffect(() => { if (unlocked) loadDossiers(SEED).then(setDossiers); }, [unlocked]);

  // Publier recharge la vue : on revient là où on était.
  useEffect(() => {
    if (!dossiers || restoredRef.current) return;
    restoredRef.current = true;
    const view = popView();
    if (!view) return;
    if (view.dossierId && dossiers.some(d => d.id === view.dossierId)) setActiveDossierId(view.dossierId);
    if (view.scrollY) requestAnimationFrame(() => window.scrollTo(0, view.scrollY));
  }, [dossiers]);

  const publishNow = useCallback(async () => {
    clearTimeout(timerRef.current);
    const current = dossiersRef.current;
    if (!current) return;
    setSyncState("saving");
    stashView({ dossierId: activeDossierId, scrollY: window.scrollY });
    const res = await publishSnapshot(makePayload(current));
    if (res.status === "published" || res.status === "conflict") setSyncState("synced");
    else if (res.status === "unavailable") setSyncState("local");
    else if (res.status === "readonly") setSyncState("readonly");
    else if (res.status === "retry") { setSyncState("pending"); timerRef.current = setTimeout(() => publishRef.current(), SYNC_BACKOFF_MS); }
    else setSyncState("error");
  }, [activeDossierId]);
  publishRef.current = publishNow;

  // Écriture locale immédiate, publication différée.
  useEffect(() => {
    if (dossiers === null) return;
    const first = dossiersRef.current === null;
    dossiersRef.current = dossiers;
    if (first) return;

    saveLocal(makePayload(dossiers));
    setSyncState(prev => (prev === "readonly" || prev === "local" ? prev : "pending"));

    const tick = () => {
      if (isFieldActive()) { timerRef.current = setTimeout(tick, SYNC_BUSY_MS); return; }
      publishRef.current();
    };
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(tick, SYNC_DELAY_MS);
    return () => clearTimeout(timerRef.current);
  }, [dossiers]);

  const handleUpdate = useCallback((updated) =>
    setDossiers(prev => prev.map(d => d.id === updated.id ? updated : d)), []);

  const handleNew = useCallback(() => {
    const d = newDossierTemplate();
    setDossiers(prev => [d, ...prev]);
    setActiveDossierId(d.id);
  }, []);

  if (!unlocked) return <PinScreen onUnlock={() => setUnlocked(true)} />;

  const activeDossier = dossiers?.find(d => d.id === activeDossierId);

  if (!dossiers) return (
    <div style={{ minHeight: "100vh", background: "#0c0c0c", display: "flex",
      alignItems: "center", justifyContent: "center", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#333" }}>
      <FontImport />Chargement…
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c0c", padding: "32px 20px" }}>
      <FontImport />
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {activeDossier
          ? <DossierDetail dossier={activeDossier} onBack={() => setActiveDossierId(null)} onUpdate={handleUpdate} />
          : <HomeView dossiers={dossiers} onOpen={setActiveDossierId} onNew={handleNew} />}
      </div>
      <SyncChip state={syncState} onSave={publishNow} />
    </div>
  );
}
