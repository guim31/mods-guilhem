export type Statut = 'pending' | 'in_progress' | 'completed'
export type Etape = { id?: string; content: string; status: Statut }
export type Inventaire = {
  objectif: string | null
  taches: Etape[]
  connecteurs: Record<string, number>
  skills: Record<string, number>
  outils: Record<string, number>
  lus: string[]
  crees: string[]
  modifies: string[]
  liens: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'chat-inventory': { inventaire: Inventaire }
  }
}
