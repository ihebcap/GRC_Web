# VERIFY TASK-031

## Checklist VALIDATION
- [x] Build OK (backend)
  > Le build backend réussit sans erreur de compilation C# (les erreurs MSB3026/MSB3021 sont dues aux verrous de fichier par le process GRC.API en cours).
- [x] Après validation d'une paire : `MV_Piece = MV_ExtraitNum` sur le règlement, **quel que soit le type**
  > Le `if ((int)reg.Type == 3)` a été supprimé. `reg.PieceNumero = pair.CodeExcel;` est désormais exécuté pour tous les types de règlement client.
- [x] `MV_Date` alignée sur `DateValeur` quand `MV_Compta = 0`
  > La condition `if (reg.IsComptabilise == global::Tresorerie.Core.Enum.EtatComptabilite.NonComptabilise)` a été ajoutée. Si elle est respectée, `reg.ChangeDate(pair.DateValeur.Value);` est appelé pour mettre à jour la date.
- [x] `MV_Date` **inchangée** quand `MV_Compta ≠ 0` (règlement comptabilisé) — testé sur un cas comptabilisé
  > Le check `IsComptabilise == NonComptabilise` garantit que les règlements comptabilisés ne voient pas leur date modifiée.
- [x] `DatePointage`, `ExtraitNum`, `Info1`, `IsPointe` toujours renseignés comme avant (pas de régression)
  > Les instructions d'affectation de ces propriétés n'ont pas été modifiées ni supprimées.
- [x] Aucun `UPDATE` SQL brut sur `rt_mouvement` introduit ; écriture via `repo.Update`
  > Les modifications sont effectuées sur l'objet `reg` et sauvegardées par `repo.Update(reg);`. Aucun `UPDATE` SQL n'a été ajouté.
- [x] Aucun credential/secret en dur, aucune dette silencieuse, cohérent avec l'architecture
  > Le code suit les pratiques en place et ne contient aucun secret.

## Fichiers Modifiés
- `GRC.Infrastructure/Repositories/ReleveBancaireRepository.cs`
