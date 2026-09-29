# TASK-094 — Blocage ressenti après fermeture du modal Historique des modifications

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance / Correction (Front)
- **Statut** : DONE (APPROVE — 2026-09-29, clôturée par renvoi vers TASK-091)
- **Dépend de** : TASK-091 (cause confirmée par diagnostic réel — voir `VERIFY/TASK-094_verify.md` archivé)

## Contexte

Remontée PO (2026-09-29, en cours de session) : « lorsque l'écran historique se lance après si je
le ferme je sens qu'il est bloqué ». Le PO a fourni le log serveur du jour
(`D:\_vibe\GRC_WEB\grc-20260929.log`) comme piste.

**Lecture du log effectuée** : le fichier ne couvre que deux évènements ce jour-là — une réservation
de ligne de relevé à 10:46:15 (`ReleveBancaireController`, sans rapport avec l'historique de
règlement) et un redémarrage complet de l'application entre 10:50:56 et 10:54:01
(`Application is shutting down...` puis ré-init Trésorerie/licence/kernel). **Aucune ligne du log ne
correspond à un appel `GET /api/reglements/{no}/historique`, ni à un incident applicatif au moment du
signalement** — soit l'incident s'est produit hors de la fenêtre couverte par ce fichier, soit il ne
produit aucune trace serveur (cohérent avec une cause purement front).

**Revue du code du modal (2026-09-29)** : [HistoriqueReglementModal.tsx](../gocom-web/src/HistoriqueReglementModal.tsx)
et son point d'intégration [App.tsx:1457-1464](../gocom-web/src/App.tsx#L1457-L1464) ne montrent
rien d'anormal à la fermeture — `onClose={() => setHistoryReglement(null)}` est un simple callback
synchrone, sans effet de bord, sans re-fetch déclenché, `isMounted` bien géré dans le `useEffect` du
modal pour éviter un `setState` après démontage. **Aucune cause de blocage identifiée dans ce fichier
pris isolément.**

**Hypothèse principale, non confirmée** : le blocage ressenti n'est probablement pas causé par le
modal lui-même, mais par la lenteur déjà documentée en TASK-091 sur `GET /api/reglements` (payload
7 Mo observé). Si ce fetch est encore en cours (ou vient de se terminer et le navigateur traite un
gros JSON) au moment où l'utilisateur ferme le modal, le thread JS principal peut rester occupé et
donner une sensation de gel de l'interface, sans rapport causal direct avec l'ouverture/fermeture du
modal historique. **Cette hypothèse doit être vérifiée par reproduction, pas supposée acquise.**

**2e et 3e passages de revue architecte (2026-09-29) — deux pistes techniques supplémentaires
examinées et leur statut :**

- **`tableBodyMemo` est protégé, cette piste est écartée.** `historyReglement` est un state du
  composant racine `App` (`App.tsx:328`) — son changement (ouverture ET fermeture du modal) force un
  re-render de tout `App`. Mais le tableau de dépendances du `useMemo` qui produit `tableBodyMemo`
  (`App.tsx:864`) **n'inclut ni `historyReglement` ni `editingReglement`** : React réutilise donc la
  référence mémoïsée du corps de tableau sans le recalculer à l'ouverture/fermeture du modal. Pas de
  reflow coûteux du tableau de règlements identifié par ce mécanisme.
- **Piste secondaire non éliminée, à vérifier en second lieu si TASK-091 ne suffit pas à expliquer le
  symptôme** : `HistoriqueReglementModal.tsx:97` utilise `backdropFilter: 'blur(2px)'` sur l'overlay
  plein écran (`position: fixed`, couvre tout le viewport) — un filtre CSS connu pour son coût de
  rendu GPU/CPU, en particulier à la fermeture où le navigateur peut recomposer le calque en dessous.
  **Ce pattern est cependant partagé à l'identique par `ModifierReglementModal.tsx:191`**, modal sur
  lequel le PO n'a signalé aucun blocage — ce qui affaiblit cette piste comme cause principale (si
  c'était le `blur`, le modal Modifier serait probablement affecté aussi), sans l'éliminer totalement
  (le PO n'a peut-être simplement pas encore refermé ce second modal dans des conditions comparables).
  À vérifier en dernier recours si la reproduction infirme le lien avec TASK-091.
- Pas de polling ni de `setInterval` trouvé dans `App.tsx` qui expliquerait une charge de fond
  continue indépendante de l'ouverture du modal.

## Objectif

Déterminer la cause réelle du blocage ressenti à la fermeture du modal historique, et la corriger.

## Fichiers concernés

- `gocom-web/src/HistoriqueReglementModal.tsx`
- `gocom-web/src/App.tsx` (montage/démontage du modal, état global de la page à ce moment)
- Dépendance probable : `GRC.API/Controllers/ReglementController.cs` / `ReglementService.cs`
  (si l'hypothèse TASK-091 est confirmée comme cause)

## Étapes d'implémentation

1. Reproduire en conditions réelles avec DevTools ouvert (onglet Performance + onglet Réseau) :
   ouvrir l'historique d'un règlement, le fermer, observer s'il y a un long task JS, un re-render en
   cascade, ou une requête réseau encore active au moment de la fermeture.
2. Vérifier en particulier si le fetch `GET /api/reglements` (celui de TASK-091) est en cours ou
   vient de se terminer à ce moment précis — corréler avec la timeline réseau.
3. Si l'hypothèse TASK-091 est confirmée (le blocage disparaît une fois TASK-091 corrigée) :
   documenter ce lien dans le VERIFY de TASK-094 et clore cette tâche par renvoi vers TASK-091,
   sans dupliquer la correction.
4. Si l'hypothèse TASK-091 est infirmée : tester spécifiquement la piste `backdropFilter: blur(2px)`
   (`HistoriqueReglementModal.tsx:97`) en la retirant temporairement pour voir si le blocage
   disparaît — en gardant à l'esprit que `ModifierReglementModal.tsx:191` partage exactement le même
   pattern sans blocage signalé, donc ne pas s'arrêter à cette piste sans l'avoir confirmée par test
   A/B réel plutôt que par déduction.
5. Le re-render de `tableBodyMemo` à l'ouverture/fermeture du modal est déjà écarté par lecture de
   code (`useMemo` dont les dépendances n'incluent pas `historyReglement`, cf. Contexte) — ne pas
   reperdre de temps sur cette piste sauf si l'observation DevTools contredit cette lecture.
6. Documenter précisément le scénario de reproduction (poste, volume de règlements affichés, nombre
   d'items dans l'historique) pour que la correction soit vérifiable.

## Contraintes

- Ne pas corriger « à l'aveugle » sans reproduction confirmée — cf. discipline de preuve
  (`CLAUDE.md` § Discipline de preuve), cette tâche est RISK HIGH du point de vue UX (perception de
  blocage = perte de confiance utilisateur).
- Si la cause est confirmée comme étant TASK-091, ne pas dupliquer la correction dans les deux
  tâches : une seule tâche porte le code, l'autre référence son VERIFY.

## Risques / dépendances

- Chevauchement fort avec TASK-091 : traiter TASK-091 en premier peut résoudre TASK-094
  automatiquement. Ne pas paralléliser les deux sans coordination pour éviter un correctif en double.

## Checklist VALIDATION (remplie dans `VERIFY/TASK-094_verify.md`, archivé)

- [x] Scénario de reproduction documenté (poste, volume de données, étapes exactes)
- [x] Cause racine identifiée et justifiée par une observation réelle (Performance/Network DevTools),
      pas par déduction seule
- [x] Si cause = TASK-091 : lien explicite documenté, pas de code dupliqué
- [x] Si piste `backdropFilter` retenue : test A/B réel documenté (avec/sans blur : 64.50 ms vs
      54.40 ms, écart ~10 ms non bloquant), et explication de pourquoi `ModifierReglementModal.tsx`
      n'est pas affecté par le même pattern
- [x] Si cause distincte : n/a (cause = TASK-091 confirmée)
- [x] Build front OK (0 erreur — `npm run build`, horodaté 2026-09-29 09:52 UTC)
- [x] Aucune dette technique silencieuse
- [x] Cohérent avec l'architecture
