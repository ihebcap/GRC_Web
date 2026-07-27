# TASK-043 — Build déterministe : conflit `Serilog.dll` 4.2 (API) vs 2.10 (`libs\Tresorerie`)

- **Priorité** : 🔴 Bloquant (déploiement) — l'API **crash au démarrage** de façon aléatoire selon le poste de build
- **Domaine** : Build / Déploiement (`GRC.API.csproj`)
- **Dépend de** : TASK-041 (a introduit `Serilog.AspNetCore` 9.0.0 → `Serilog.dll` 4.2) — corrige un défaut de packaging révélé par celle-ci
- **Origine** : régression constatée en prod après TASK-041 :
  `System.IO.FileNotFoundException: Could not load file or assembly 'Serilog, Version=4.2.0.0 …'` au démarrage.

## Contexte / diagnostic
Deux `Serilog.dll` **homonymes** visent la **racine** de la sortie de build :
- **NuGet** : `Serilog.AspNetCore` 9.0.0 → `Serilog.dll` **4.2.0.0** (exigé par le code TASK-041, inscrit dans `GRC.API.deps.json` : `Serilog/4.2.0`).
- **Hérité** : les `<Reference Include="Tresorerie.*">` + le glob `<None Include="..\libs\Tresorerie\*.dll">` apportent `Serilog.dll` **2.10.0.0** (dépendance interne des DLL Trésorerie, chargées par le kernel Ninject).

Les deux fichiers portent le même nom simple `Serilog` → **le gagnant à la racine dépend de l'ordre de copie MSBuild = non déterministe** :
- poste dev « architecte » : racine = 4.2 (OK par chance) ;
- poste worker / serveur : racine = **2.10** → masque la 4.2 → `FileNotFoundException` au démarrage.

Conséquence : **chaque `dotnet publish` peut recasser** (autre poste, CI, nettoyage de `bin`). Un simple remplacement manuel du fichier n'est qu'un contournement.

État attendu de la sortie (à garantir par le build) :
- **racine** : `Serilog.dll` = **4.2.0.0** (+ set moderne `Serilog.AspNetCore` 9, `Serilog.Extensions.Hosting` 9, `Serilog.Extensions.Logging` 9, `Serilog.Settings.Configuration` 9, `Serilog.Formatting.Compact` 3, `Serilog.Sinks.File` 6, `Serilog.Sinks.Console` 6, `Serilog.Sinks.Debug` 3) ;
- **`libs\Tresorerie\`** : `Serilog.dll` = **2.10.0.0** (inchangé — chargé par le kernel Ninject depuis ce sous-dossier).

## Objectif
Rendre le packaging **déterministe** : la racine porte **toujours** `Serilog.dll` 4.2, sur n'importe quel poste, sans écraser le 2.10 du sous-dossier `libs\Tresorerie\`. Aucun changement de comportement runtime, aucune modification de code C#.

## Fichier concerné
- `GRC.API/GRC.API.csproj` : ne retirer de la copie-locale **racine** que les `Serilog*` provenant de `libs\Tresorerie`. Le glob `None` existant continue de livrer ces DLL dans `libs\Tresorerie\` (sous-dossier) pour le kernel.

## Étape d'implémentation (proposition)
```xml
<Target Name="RetirerSerilogHeriteDeLaRacine" AfterTargets="ResolveAssemblyReferences">
  <!-- Les DLL Trésorerie référencent un Serilog 2.10 homonyme du Serilog 4.2 (NuGet) exigé par
       Serilog.AspNetCore. Sans ça, les deux se disputent la racine de sortie (copie non
       déterministe) : l'ancien peut masquer le 4.2 → FileNotFoundException au démarrage.
       On retire de la copie-locale RACINE les Serilog issus de libs\Tresorerie ; ils restent
       livrés dans libs\Tresorerie\ (glob None) pour le chargement du kernel Ninject. -->
  <ItemGroup>
    <ReferenceCopyLocalPaths Remove="@(ReferenceCopyLocalPaths)"
        Condition="'%(Extension)' == '.dll'
                   and $([System.String]::Copy('%(FileName)').StartsWith('Serilog'))
                   and $([System.String]::Copy('%(FullPath)').Contains('libs\Tresorerie'))" />
  </ItemGroup>
</Target>
```
> Vérifier que la condition retire **uniquement** les Serilog dont le chemin source est `libs\Tresorerie` (et **pas** ceux du cache NuGet `~/.nuget/packages/serilog/4.2.0/...`), sinon la racine se retrouverait sans aucun Serilog → toujours cassé.

## Contraintes
- **Aucune modification de code C#**, aucun changement de comportement métier ni de la journalisation TASK-041.
- Ne pas supprimer le `Serilog.dll` 2.10 de `libs\Tresorerie\` (le kernel Trésorerie s'appuie dessus).
- Ne pas rétrograder / figer la version NuGet Serilog (doit rester ≥ 4.2 pour `Serilog.AspNetCore` 9).
- Solution **dans le build** (déterministe), pas un script de copie post-déploiement manuel.

## Recette / VALIDATION (à remplir dans VERIFY/)
- [ ] `dotnet build -c Release` : 0 erreur.
- [ ] `dotnet publish -c Release --no-self-contained -o <dossier_propre>` sur un **dossier vide** →
      **racine** `Serilog.dll` = **4.2.0.0** (contrôle `FileVersionInfo`), set moderne complet présent.
- [ ] `libs\Tresorerie\Serilog.dll` = **2.10.0.0** (inchangé) dans la sortie.
- [ ] Test de non-régression déterminisme : **2 publish successifs** (avec `bin`/`obj` nettoyés entre les deux) → racine = 4.2 **les deux fois**.
- [ ] Démarrage de l'API depuis la sortie `publish` : **plus de** `FileNotFoundException Serilog 4.2` ; init Trésorerie et endpoints OK.
- [ ] Journalisation TASK-041 toujours fonctionnelle (fichier `logs/grc-AAAAMMJJ.log` créé, 3 zones tracées).

## Risques
- Condition MSBuild trop large → retire aussi le Serilog 4.2 NuGet de la racine (racine vide → toujours cassé). **Contrôler par le critère de recette « racine = 4.2 ».**
- Coexistence runtime 4.2 (racine) / 2.10 (`libs\Tresorerie`) : validée au démarrage par TASK-041 (init Trésorerie chargée avec 4.2 à la racine + 2.10 en sous-dossier). Si le kernel Ninject exige spécifiquement des API Serilog 2.10, ouvrir une isolation par `AssemblyLoadContext` dédié (hors périmètre, à escalader si observé).
