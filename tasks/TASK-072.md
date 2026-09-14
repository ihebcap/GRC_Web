# TASK-072 — Intitulé du mode de règlement Espèce (et Chèque) mal encodé en base (mojibake)

- **Priorité** : 🟡 UX / qualité de donnée (constat architecte 2026-09-14, en creusant le signalement client de TASK-071)
- **Domaine** : Donnée GRC (`P_MODEREGLEMENT.MR_Intitule`) — **pas de code applicatif en cause**
- **Dépend de** : rien. Indépendante de TASK-071 (root cause différente), trouvée pendant la même investigation.

## Contexte

Pendant l'investigation du signalement client « le filtre Espèce ne marche pas » (TASK-071), l'API prod du client a été interrogée en direct (lecture seule) :

```
GET /api/reference/modes  →
{ "id": 1, "code": "ESPECE",  "intitule": "EspÃ¨ce", "typeNo": 0 }
{ "id": 2, "code": "CHEQUE",  "intitule": "ChÃ¨que",  "typeNo": 3 }
```

`Ã¨` décodé = `Ã¨` — mojibake classique : les octets UTF-8 du caractère `è` (`0xC3 0xA8`) ont été réinterprétés comme deux caractères Latin-1/Windows-1252 distincts (`Ã` + `¨`) puis ré-encodés en UTF-8. L'intitulé réel en base est donc corrompu **au repos**, pas seulement mal affiché à la volée : `RT_CAISSE.CA_Intitule` (ex. `"Caisse Siège"`) ressort correctement accentué sur le même endpoint/connexion, donc la connexion SQL/l'API ne sont **pas** en cause de façon générale — c'est spécifiquement la valeur stockée dans `P_MODEREGLEMENT.MR_Intitule` (au moins pour les lignes Espèce et Chèque) qui est corrompue, vraisemblablement suite à un import/ressaisie historique via un canal mal encodé (hors périmètre GRC_WEB).

**Sans impact sur le filtrage** (vérifié) : le `code` (`"ESPECE"`, `"CHEQUE"`) reste propre et sert de base à la sélection/recherche dans le filtre Excel-like (`ExcelFilter.tsx`) ; seul le libellé affiché (`${code} - ${intitule}`) est visuellement abîmé (`"ESPECE - EspÃ¨ce"`). Ne pas confondre avec TASK-071 (bug de logique de filtre, désormais isolé et documenté séparément).

## Objectif

Décision PO à obtenir avant toute action :

1. **Confirmer l'étendue** : la corruption touche-t-elle uniquement Espèce/Chèque (2 lignes vues) ou d'autres modes/autres tables du même import ? (à établir par une requête de lecture large sur `P_MODEREGLEMENT` et tables voisines, pas de correctif tant que l'étendue n'est pas connue).
2. **Arbitrer le correctif** : ceci nécessiterait un `UPDATE` sur `P_MODEREGLEMENT`, une table métier GRC. La règle du projet interdit un `UPDATE` SQL brut sur une table métier GRC pilotée par DLL sans validation explicite — **ne pas corriger en base sans feu vert PO**, et vérifier au préalable si la DLL Trésorerie expose un moyen de renommer un mode de règlement plutôt qu'un `UPDATE` direct (cohérence avec la contrainte "pas de bypass DLL métier" déjà appliquée ailleurs dans ce projet, ex. TASK-047/036).

## Fichiers concernés

- Aucun fichier de code identifié comme cause. À l'issue de l'étape 1 (étendue), si un correctif applicatif s'avère malgré tout pertinent (ex. normalisation d'affichage front en repli), le réévaluer alors — **ne pas l'anticiper ici**.

## Étapes d'implémentation

1. Requête de lecture (pas d'écriture) sur `P_MODEREGLEMENT` pour lister tous les `MR_Intitule` contenant un pattern de mojibake connu (ex. `Ã` suivi d'un caractère de contrôle/diacritique) — évaluer l'étendue réelle avant d'aller plus loin.
2. Vérifier si d'autres colonnes texte accentuées de la même table (ou de tables alimentées par le même import historique) présentent le même défaut, pour ne pas traiter le symptôme mode par mode.
3. Présenter les résultats au PO avec un chiffrage de l'étendue, avant toute proposition de correctif (SQL de remédiation via DLL si possible, sinon `UPDATE` ciblé avec validation PO explicite comme déjà fait pour TASK-036).

## Contraintes

- **Aucun `UPDATE` SQL brut sur `P_MODEREGLEMENT` sans validation PO explicite** (règle projet, `tasks/TODO.md:51`).
- Ne pas bypasser la DLL Trésorerie si elle expose une API de gestion des modes de règlement — vérifier avant de proposer un SQL direct.
- Ne pas élargir le périmètre à un correctif applicatif (front) tant que l'étendue et la décision de remédiation en base ne sont pas actées par le PO.

## Risques / dépendances

- Peut concerner d'autres libellés que ceux vus ici (Espèce/Chèque) — étendue réelle inconnue tant que l'étape 1 n'est pas faite.
- Toute correction en base sur une table métier GRC pilotée par DLL comporte un risque de désynchronisation avec l'ERP source si elle n'est pas faite via le canal DLL — à traiter avec la même prudence que TASK-036/047.

## Checklist VALIDATION (à remplir dans VERIFY/)

- [ ] Étendue de la corruption établie et chiffrée (nombre de lignes/tables concernées)
- [ ] Décision PO obtenue sur le mécanisme de correction (DLL vs `UPDATE` validé) avant toute écriture
- [ ] Si correctif appliqué : relecture de `/api/reference/modes` (et équivalents) confirmant un intitulé correctement accentué
- [ ] Aucun `UPDATE` exécuté sans validation PO tracée dans ce fichier ou le VERIFY correspondant
