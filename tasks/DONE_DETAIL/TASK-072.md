# TASK-072 — Intitulé du mode de règlement Espèce (et Chèque) mal encodé en base (mojibake)

- **Priorité** : 🟡 UX / qualité de donnée (constat architecte 2026-09-14, en creusant le signalement client de TASK-071)
- **Domaine** : Backend (`GRC.API/Program.cs`) + Front (`gocom-web`)
- **Statut** : APPROVE (2026-09-14)
- **Dépend de** : rien. Indépendante de TASK-071 (root cause différente).

## Contexte

Pendant l'investigation du signalement client « le filtre Espèce ne marche pas » (TASK-071), l'API prod du client a été interrogée en direct (lecture seule) :

```
GET /api/reference/modes  →
{ "id": 1, "code": "ESPECE",  "intitule": "EspÃ¨ce", "typeNo": 0 }
{ "id": 2, "code": "CHEQUE",  "intitule": "ChÃ¨que",  "typeNo": 3 }
```

`Ã¨` décodé = `è` — mojibake classique : les octets UTF-8 du caractère `è` (`0xC3 0xA8`) ont été réinterprétés comme deux caractères Latin-1/Windows-1252 distincts (`Ã` + `¨`) puis ré-encodés en UTF-8. L'intitulé réel en base client au repos est altéré.

## Décision et Résolution

- **Arbitrage PO (2026-09-14)** : Option de normalisation applicative retenue afin d'éviter tout `UPDATE` SQL direct sur table métier GRC.
- **Backend (`GRC.API/Program.cs`)** :
  - Ajout du helper `StringEncodingHelper.NormalizeMojibake` pour ré-encoder/décoder les chaînes affectées par le pattern UTF-8/Latin-1.
  - Normalisation systématique de `intitule` sur l'endpoint `GET /api/reference/modes`.
- **Frontend (`gocom-web`)** :
  - Ajout du helper `fixMojibake` dans `src/utils.tsx`.
  - Normalisation des modes dans `App.tsx` (`modesMap`) et dans `ApercuComptabilisation.tsx`.

## Checklist VALIDATION

- [x] Étendue de la corruption établie et chiffrée (foyer ciblé sur les libellés de modes de règlement `P_MODEREGLEMENT.MR_Intitule`)
- [x] Décision PO obtenue sur le mécanisme de correction (normalisation applicative transparente retenue)
- [x] Relecture et normalisation de `/api/reference/modes` et affichages front
- [x] Aucun `UPDATE` exécuté en base brute sans validation PO (règle projet respectée)
- [x] Builds backend et frontend validés avec 0 erreur
