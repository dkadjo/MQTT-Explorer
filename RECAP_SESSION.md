# Récap de session — Plugin Export CSV pour MQTT Explorer

> Document généré le 3 juillet 2026.
> À destination de tout développeur ou IA reprenant ce projet.

---

## Contexte

Fork local de [thomasnordquist/MQTT-Explorer](https://github.com/thomasnordquist/MQTT-Explorer).
Application desktop Electron + TypeScript + React + Redux + Webpack.
Objectif : ajouter un bouton **Export CSV** dans la sidebar qui exporte l'historique
des messages MQTT (topic, payload, timestamp, qos, retain) en fichier CSV.

---

## Architecture du projet

```
MQTT-explorer/
├── src/        Electron main process (electron.ts, server.ts)
├── app/        React renderer — UI, Redux store, composants
├── backend/    Modèle de données MQTT (TreeNode, RingBuffer, Edge…)
└── events/     Bus d'événements IPC partagé entre toutes les couches
```

Le renderer Electron charge `http://localhost:8080` (webpack-dev-server) en dev,
ou `app/build/index.html` en production.

---

## Ce qui a été fait — US par US

### US1 — Cadrage technique ✅

**Constat :** pas de système de plugin natif → fork obligatoire.

**Piège identifié et documenté :**
`app/src/components/Sidebar/TopicPanel/TopicPanel.tsx` existe mais n'est importé
par aucun composant. Il est orphelin — ne jamais l'utiliser comme point d'entrée.

**Vrai point d'entrée UI :**
`app/src/components/Sidebar/DetailsTab.tsx`
chargé via : `Sidebar.tsx → ContentView.tsx → DetailsTab.tsx`

**Stratégie de distribution retenue :**
- Fork publié sur GitHub avec binaires GitHub Releases (voie principale)
- PR soumise au repo officiel en parallèle (repo inactif depuis 2019, v0.3.5)

---

### US2 — Format de sortie CSV ✅

**Modèle de données exploré :** `backend/src/Model/TreeNode.ts`

Chaque `TreeNode` expose :
- `path()` → topic complet (ex: `home/salon/temperature`)
- `messageHistory` → `RingBuffer<Message>` (20 000 messages max, 100 Mo)
- `edgeArray` → tableau des noeuds enfants (pour le parcours récursif)

Chaque `Message` expose :
- `payload: Base64Message | null` → décodé via `.toUnicodeString()`
- `received: Date` → horodatage de réception
- `qos: 0 | 1 | 2`
- `retain: boolean`

**Format retenu : Mode B — historique complet**
1 ligne par message (via `messageHistory.toArray()`), pas 1 ligne par topic.

**5 colonnes :**
```
topic, payload, timestamp, qos, retain
```

**Gestion des cas limites :**
| Cas | Comportement |
|---|---|
| Payload vide / null | Cellule vide |
| Virgule dans le payload | Encadré de guillemets doubles |
| Guillemet dans le payload | Doublé — norme RFC 4180 |
| Retour à la ligne dans le payload | Encadré de guillemets doubles |
| Payload binaire | `toUnicodeString()` tenté — pas de fallback hex (hors scope) |

---

### Corrections TypeScript bloquantes ✅

**Problème :** lors de l'extraction de `Edge` dans son propre fichier,
des stubs vides avaient été insérés dans 3 fichiers, causant 18 erreurs TypeScript.

**Fichiers corrigés :**

| Fichier | Correction |
|---|---|
| `backend/src/Model/TreeNode.ts` | Suppression du stub + `import { Edge } from './Edge'` |
| `backend/src/Model/index.ts` | Suppression du stub + `export { Edge } from './Edge'` |
| `backend/src/Model/TreeNodeFactory.ts` | Suppression du stub + doublon de classe supprimé |

**Règle à retenir :** ne jamais créer de stub local pour débloquer le compilateur.
La source de vérité est `backend/src/Model/Edge.ts`.

---

### US3 — Bouton Export CSV dans l'UI ✅ TESTÉ ET VALIDÉ EN CONDITIONS RÉELLES

**Fichier modifié :** `app/src/components/Sidebar/DetailsTab.tsx`

**Ce qui a été ajouté :**
- Bouton `📄⬇` dans la zone `topicActions` (à côté de Copier / Supprimer)
- Import du service : `import { exportNodeToCsv, ExportScope } from '../../services/CsvExportService'`
- State : `useState<boolean>(exporting)` + `useState<ExportScope>(scope)`
- Clic gauche → déclenche `exportNodeToCsv(node, scope)`
- Clic droit → bascule entre `'recursive'` (📄⬇) et `'node'` (📄)
- Pendant l'export : bouton affiche `⏳` et est désactivé

**Test réalisé :**
- Connexion au broker public `test.mosquitto.org:1883`
- Sélection d'un topic dans l'arbre
- Clic sur le bouton → fichier CSV téléchargé automatiquement ✅
- Vérification du contenu : colonnes `topic, payload, timestamp, qos, retain` présentes ✅
- Clic droit → bascule de périmètre fonctionnelle ✅

---

### US4 — Logique de transformation MQTT → CSV ✅ TESTÉ ET VALIDÉ EN CONDITIONS RÉELLES

**Fichier créé :** `app/src/services/CsvExportService.ts`

```typescript
export type ExportScope = 'recursive' | 'node'

export function exportNodeToCsv(
  node: TreeNode<any>,
  scope: ExportScope = 'recursive'
): { exported: number }
```

**Fonctionnement interne :**
1. `collectRows(node, scope)` — visite récursivement `edgeArray`, lit `messageHistory.toArray()` sur chaque noeud
2. `rowsToCsv(rows)` — sérialise en CSV avec `escapeCsvField()` (RFC 4180)
3. `triggerDownload(csv, filename)` — Blob + `<a>` éphémère
4. Nom du fichier : `mqtt_<topic>_<date>.csv`

---

## Fichiers modifiés / créés — récapitulatif

| Fichier | Action | Statut |
|---|---|---|
| `backend/src/Model/Edge.ts` | Source de vérité Edge — non modifié | ✅ |
| `backend/src/Model/TreeNode.ts` | Import Edge corrigé | ✅ |
| `backend/src/Model/index.ts` | Re-export Edge corrigé | ✅ |
| `backend/src/Model/TreeNodeFactory.ts` | Stub + doublon supprimés | ✅ |
| `app/src/components/Sidebar/DetailsTab.tsx` | Bouton Export CSV ajouté | ✅ |
| `app/src/services/CsvExportService.ts` | Créé — logique complète | ✅ |
| `app/src/components/Sidebar/TopicPanel/TopicPanel.tsx` | Modifié mais ORPHELIN | ⚠️ Ne pas utiliser |

---

## Ce qui reste à faire

### Priorité haute
- [ ] Remplacer le clic droit (peu découvrable) par un `<Select>` MUI visible pour choisir le périmètre
- [ ] Ajouter un `<Snackbar>` MUI de feedback après export — `exportNodeToCsv` retourne déjà `{ exported: number }`

### Priorité moyenne
- [ ] Décision à prendre avec les parties prenantes : ajouter **export tous les topics** ou **filtre par plage temporelle** ?
- [ ] Fallback hex pour payloads binaires : `Base64Message.toHex()` est disponible dans le modèle
- [ ] Dialog natif Electron pour choisir le chemin de sauvegarde : `dialog.showSaveDialog` dans `src/electron.ts` via IPC

### Priorité basse
- [ ] Supprimer `TopicPanel.tsx` (orphelin, source de confusion)
- [ ] Tests unitaires de `CsvExportService.ts` : `collectRows`, `rowsToCsv`, cas limites

---

## Comment lancer l'application

```bash
cd MQTT-explorer/

# 1. Vérifier la compilation — doit retourner 0 erreur
npx tsc --noEmit

# 2. Vider le cache webpack si besoin
rm -rf app/node_modules/.cache

# 3. Lancer en développement (webpack + Electron en parallèle)
npx npm-run-all --parallel dev:app dev:electron
```

Attendre que webpack affiche `compiled successfully` avant qu'Electron s'ouvre.

**Broker de test public :** `test.mosquitto.org` — port `1883` — sans identifiants.

---

## Règles critiques à respecter

1. **Ne jamais créer de stub vide pour `Edge`** dans un autre fichier.
   Source de vérité : `backend/src/Model/Edge.ts` → re-exporté depuis `backend/src/Model/index.ts`.

2. **Ne jamais modifier `TopicPanel.tsx`** en pensant que ça s'affichera.
   Le vrai composant sidebar actif est `DetailsTab.tsx`.

3. **En cas de doute sur le bundle webpack** (modifications ignorées) :
   ```bash
   rm -rf app/node_modules/.cache
   ```
   Puis relancer webpack.

4. **Le cache webpack** peut faire croire à une compilation réussie sans prendre
   en compte les nouveaux fichiers. Toujours vérifier avec :
   ```bash
   grep -rl "Export CSV" app/build/
   ```

5. **`TopicPanel.tsx` est orphelin** — il n'est importé nulle part dans le projet.
   Ne pas y mettre de code.
