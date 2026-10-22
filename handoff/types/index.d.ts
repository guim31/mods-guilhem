// Ce que le chat a touché, relevé au fil des appels d'outils (agents compris).
export type Inventaire = {
  lus: string[]
  ecrits: string[]
  modifies: string[]
  skills: Record<string, number>
  outils: Record<string, number>
  liens: string[]
}
export type Passation = {
  texte: string | null
  fichier: string | null
  enCours: boolean
  erreur: string | null
}
// Fin de la dernière requête du fil principal, et ce qui a déjà été proposé.
export type Suivi = { lastAt: number | null; alerteSeuil: boolean; froidPropose: number | null }

declare module 'claude-code' {
  interface PluginState {
    handoff: { inventaire: Inventaire; passation: Passation; suivi: Suivi }
    // Lu seulement, quand le mod cache-clock tourne : ses relances /keepwarm gardent le cache chaud.
    'cache-clock': { horloge: { lastAt: number | null; ttlMs: number } }
  }
}
