// contenu null : le fichier n'existait pas encore.
export type Version = { at: number; tool: string; contenu: string | null }
export type Lecture = { fichier: string | null; etape: number; enLecture: boolean }

declare module 'claude-code' {
  interface PluginState {
    'replay-theater': { fichiers: Record<string, Version[]>; lecture: Lecture }
  }
}
