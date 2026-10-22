export type Mode = 'distinct' | 'compact' | 'off'

declare module 'claude-code' {
  interface PluginState {
    apparence: { finals: string[]; mode: Mode }
    // Lu seulement : le mode partage d'écran du mod screen-share.
    'screen-share': { reglage: { actif: boolean; mots: string[] } }
  }
}
