export type Regle = { texte: string; application: string; titre: string; portee: 'globale' | 'projet'; cible?: string }

declare module 'claude-code' {
  interface PluginState {
    reflect: { enAttente: Regle[]; retenues: Regle[] }
  }
}
