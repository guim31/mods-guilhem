# mods-guilhem

Dix mods pour Claude Code (modules de hooks), écrits en français.

| Mod | Ce qu'il fait |
| --- | --- |
| `apparence` | Distingue le travail intermédiaire de la synthèse finale ; `/apparence` change de style |
| `switchboard` | `/mods` : liste les mods et plugins chargés, pour couper ou rallumer chacun |
| `brain-dump` | Repère les longs textes dictés, pose quelques questions puis les réécrit en prompt structuré |
| `helper-desk` | Barre de progression des tâches au-dessus de la saisie et panneau des sous-agents |
| `cache-clock` | Compte à rebours avant que le cache du chat refroidisse ; `/keepwarm` le garde chaud |
| `handoff` | Rédige un prompt de passation et ouvre un nouveau chat avec ; `/handoff` |
| `reflect` | Repère les règles durables que tu donnes et propose de les enregistrer |
| `chat-inventory` | Panneau « Dans ce chat » : objectif, tâches, connecteurs, skills, fichiers, liens |
| `screen-share` | `/screenshare` : masque noms, e-mails, téléphones, montants à l'affichage |
| `replay-theater` | `/replay` rejoue les modifications de fichiers et permet de revenir en arrière |

## Installation

À l'invite d'une session Claude Code dans un terminal :

```
/plugin install <mod> --marketplace guim31/mods-guilhem
```

Réponds `y` pour ajouter le marketplace, puis choisis la portée (user en premier).

Depuis un shell :

```bash
claude plugin install <mod> --marketplace guim31/mods-guilhem
```

Dans l'app de bureau, où `/plugin` ne fonctionne pas : clique sur + à côté de la zone de saisie, puis Plugins, Add marketplace avec `guim31/mods-guilhem`, puis Add plugin.

Tous les mods d'un coup (par exemple dans le script de préparation d'un environnement cloud claude.ai/code) :

```bash
claude plugin marketplace add guim31/mods-guilhem
for mod in apparence switchboard brain-dump helper-desk cache-clock handoff reflect chat-inventory screen-share replay-theater; do
  claude plugin install "$mod@mods-guilhem" --scope user
done
```
