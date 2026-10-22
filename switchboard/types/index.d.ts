// Un module de hooks vu au chargement (plugin.register) : ce qu'il écoute et ce qu'il appelle.
export type Vu = { name: string; provenance: string; tier: string; events: string[]; calls: string[] }
// Une ligne du tableau : un plugin installé ou un mod chargé depuis un dossier.
export type Ligne = { cle: string; name: string; source: string; actif: boolean; installe: boolean; estMod: boolean }
// Mods refusés au chargement (ceux chargés depuis un dossier), mods dont les panneaux sont masqués.
export type Reglages = { refuses: string[]; masques: string[]; enAttente: boolean }

declare module 'claude-code' {
  interface PluginState {
    switchboard: { vus: Vu[]; lignes: Ligne[]; reglages: Reglages }
  }
}
