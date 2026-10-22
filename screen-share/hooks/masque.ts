// Masquage du texte affiché : tout ce qui identifie une personne ou un chiffre d'affaires devient une barre grise.

const barre = (longueur: number) => '▇'.repeat(Math.max(3, Math.min(10, longueur)))

const MAJ = 'A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ'
const MIN = 'a-zàâäçéèêëîïôöùûüÿæœ'
// Un mot à majuscule initiale (Camille, Jean-Marc), ou tout en capitales pour un nom de famille (DURAND).
const CAPITALE = `[${MAJ}][${MIN}]+(?:-[${MAJ}][${MIN}]+)?`
const NOM_FAMILLE = `(?:${CAPITALE}|[${MAJ}]{2,}(?:-[${MAJ}]{2,})?)`
const PARTICULE = `(?:(?:de|du|des|da|di|van|von|le|la|d')\\s*)`
const SUITE_DE_NOMS = new RegExp(`\\b${CAPITALE}(?:\\s+${PARTICULE}?${NOM_FAMILLE}){1,2}\\b`, 'gu')
const CIVILITE = new RegExp(
  `\\b(M\\.|Mme|Mlle|Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Pr\\.?|Me|Madame|Monsieur|Mademoiselle|Docteur|Maître)\\s+(${NOM_FAMILLE})`,
  'gu',
)

// Mots qui commencent une phrase ou un titre sans être des noms : on les retire d'une suite.
const DEBUTS = new Set(
  (
    'Le La Les Un Une Des Ce Cet Cette Ces Mon Ma Mes Ton Ta Tes Son Sa Ses Notre Nos Votre Vos Leur Leurs ' +
    'Il Elle Ils Elles On Je Tu Nous Vous Et Ou Mais Donc Car Puis Pour Dans Sur Sous Avec Sans Par En Au Aux Du De ' +
    'Si Quand Comme Alors Ensuite Enfin Voici Voilà Oui Non Merci Bonjour Salut Cher Chère Avant Après Depuis Entre ' +
    'Lundi Mardi Mercredi Jeudi Vendredi Samedi Dimanche Janvier Février Mars Avril Mai Juin Juillet Août Septembre ' +
    'Octobre Novembre Décembre The A An This That These Those In On At For With From To Of If When Then And Or But ' +
    'Note Mod Mods Étape Tâche Fichier Dossier Section Chapitre Version Option Erreur Résultat Synthèse Handoff'
  ).split(' '),
)

// Produits, outils et lieux qui s'écrivent avec des majuscules : jamais pris pour des personnes.
const TECHNIQUE = new RegExp(
  '^(Claude|Code|Anthropic|Opus|Sonnet|Haiku|Fable|Remote|Control|Desktop|Cowork|Google|Drive|Docs|Sheets|Slides|Gmail|' +
    'Calendar|Microsoft|Windows|Linux|Ubuntu|Debian|Apple|Mac|Docker|Unraid|GitHub|Git|Node|Python|Blender|Cycles|' +
    'Chrome|Firefox|Safari|Visual|Studio|Notion|Slack|Linear|Figma|Instagram|Facebook|Meta|Business|Suite|Business|' +
    'Frigate|Gladys|Beelink|Home|Assistant|Red|Hat|Open|Source|Cloud|Flare|Cloudflare|Tailscale|Proxmox|NativePHP|' +
    'Laravel|React|Three|Vue|Next|Nuxt|Paris|France|Lyon|Toulouse|Bordeaux|Marseille|Lille|Nantes|Europe|Union)$',
)

const MOTIFS: RegExp[] = [
  // e-mails
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // IBAN
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g,
  // numéros de carte
  /\b(?:\d{4}[\s-]?){3}\d{1,4}\b/g,
  // téléphones : français, puis internationaux
  /(?:\+33\s?|0033\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g,
  /\+\d{1,3}(?:[\s.-]?\d{2,4}){2,5}/g,
  // adresses IP
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // montants
  /(?:[$€£]\s?\d(?:[\d\s.,]*\d)?(?:\s?[kKmM]\b)?|\b\d(?:[\d.,]|\s(?=\d))*\s?(?:k€|K€|M€|€|\$|£|EUR|USD|euros?|dollars?)(?![\p{L}]))/gu,
  // adresses postales
  /\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|allée|impasse|place|route|quai|cours|square)\s+[^\n,;]{2,40}/giu,
]

const echapper = (mot: string) => mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const masquer = (texte: string, mots: readonly string[] = []): string => {
  if (!texte) return texte
  let out = texte
  for (const motif of MOTIFS) out = out.replace(motif, m => barre(m.length))
  // Le nom d'utilisateur dans les chemins personnels.
  out = out.replace(/(\/home\/|\/Users\/|C:\\Users\\)([^/\\\s]+)/g, (_, debut: string, nom: string) => debut + barre(nom.length))
  for (const mot of mots) {
    if (mot.trim().length < 2) continue
    out = out.replace(new RegExp(`(?<![\\p{L}\\d])${echapper(mot.trim())}(?![\\p{L}\\d])`, 'giu'), m => barre(m.length))
  }
  out = out.replace(CIVILITE, (_, titre: string, nom: string) => `${titre} ${barre(nom.length)}`)
  out = out.replace(SUITE_DE_NOMS, suite => {
    const parts = suite.split(/(\s+)/)
    // On écarte les mots de début de phrase en tête de suite.
    let i = 0
    while (i < parts.length && (DEBUTS.has(parts[i]!) || /^\s+$/.test(parts[i]!))) i++
    const reste = parts.slice(i)
    const noms = reste.filter(p => !/^\s+$/.test(p))
    if (noms.length < 2 || noms.some(n => TECHNIQUE.test(n))) return suite
    return parts.slice(0, i).join('') + reste.map(p => (/^\s+$/.test(p) || /^(de|du|des|da|di|van|von|le|la|d')$/.test(p) ? p : barre(p.length))).join('')
  })
  return out
}

// Toutes les chaînes d'une valeur (entrée ou sortie d'outil), structure inchangée.
export const masquerValeur = (v: unknown, mots: readonly string[]): unknown => {
  if (typeof v === 'string') return masquer(v, mots)
  if (Array.isArray(v)) return v.map(x => masquerValeur(x, mots))
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, masquerValeur(x, mots)]))
  }
  return v
}

const PROPS_TEXTE = ['text', 'label', 'source', 'alt', 'placeholder']

// Un arbre déjà dessiné (le panneau ou le bandeau d'un autre mod) : on masque ses textes.
export const masquerArbre = (n: unknown, mots: readonly string[]): unknown => {
  if (typeof n === 'string') return masquer(n, mots)
  if (Array.isArray(n)) return n.map(x => masquerArbre(x, mots))
  if (n && typeof n === 'object' && 'type' in n && 'props' in n) {
    const el = n as { type: string; props: Record<string, unknown> }
    if (el.type === 'engine') return n
    const props: Record<string, unknown> = { ...el.props }
    for (const k of PROPS_TEXTE) if (typeof props[k] === 'string') props[k] = masquer(props[k] as string, mots)
    if (el.type === 'Input' && typeof props.value === 'string') props.value = masquer(props.value, mots)
    if ('children' in props) props.children = masquerArbre(props.children, mots)
    return { ...el, props }
  }
  return n
}
