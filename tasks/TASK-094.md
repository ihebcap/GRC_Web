# TASK-094 — Blocage ressenti après fermeture du modal Historique des modifications

- **Priorité** : 🟠 Majeur
- **Domaine** : Performance / Correction (Front)
- **Statut** : TODO
- **Dépend de** : TASK-091 (piste probable, à confirmer — voir Contexte)

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
4. Si l'hypothèse est infirmée : investiguer spécifiquement le cycle de vie du modal (montage/
   démontage React, éventuel re-render de `tableBodyMemo` déclenché par le changement de
   `historyReglement`, coût de `banquesMap` passé en prop) et corriger la cause réelle trouvée.
5. Documenter précisément le scénario de reproduction (poste, volume de règlements affichés, nombre
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

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Scénario de reproduction documenté (poste, volume de données, étapes exactes)
- [ ] Cause racine identifiée et justifiée par une observation réelle (Performance/Network DevTools),
      pas par déduction seule
- [ ] Si cause = TASK-091 : lien explicite documenté, pas de code dupliqué
- [ ] Si cause distincte : correction appliquée et non-blocage revérifié sur le même scénario de
      reproduction qu'avant correction
- [ ] Build front OK (0 erreur)
- [ ] Aucune dette technique silencieuse
- [ ] Cohérent avec l'architecture
