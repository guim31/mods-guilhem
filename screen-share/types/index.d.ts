// mots : noms et termes à masquer en plus des motifs reconnus (ajoutés par /screenshare ajouter).
export type Reglage = { actif: boolean; mots: string[] }

declare module 'claude-code' {
  interface PluginState {
    'screen-share': { reglage: Reglage }
  }
}
