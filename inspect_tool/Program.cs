using System; using System.IO; using System.Linq; using System.Collections.Generic; using Mono.Cecil; using Mono.Cecil.Cil;
class Program {
    static void DumpMethodSig(TypeDefinition t, string methodName){
        if (t == null) { Console.WriteLine($"[type not found] .{methodName}"); return; }
        var ms = t.Methods.Where(m=>m.Name==methodName).ToList();
        if(ms.Count==0){ Console.WriteLine($"[not found] {t.Name}.{methodName}"); return; }
        foreach(var m in ms){
            Console.WriteLine($"\n{t.FullName}.{methodName} ({m.Parameters.Count} params) -> {m.ReturnType.FullName}  [static={m.IsStatic}]");
            int i=0;
            foreach(var p in m.Parameters) Console.WriteLine($"  [{i++}] {p.ParameterType.FullName} {p.Name}" + (p.HasDefault && p.Constant != null ? $" = {p.Constant}" : (p.IsOptional ? " (optional)" : "")));
        }
    }
    static void DumpBodyFull(TypeDefinition t, MethodDefinition m){
        Console.WriteLine($"\n---- FULL BODY {t.FullName}.{m.Name} ----");
        if(!m.HasBody){ Console.WriteLine("[no body]"); return; }
        Console.WriteLine("-- locals --");
        int li=0;
        foreach(var v in m.Body.Variables) Console.WriteLine($"  V_{li++} : {v.VariableType.FullName}");
        Console.WriteLine("-- IL --");
        foreach(var instr in m.Body.Instructions) Console.WriteLine(instr.ToString());
    }
    static void DumpProps(TypeDefinition t, string filter=null){
        if (t==null) { Console.WriteLine("[type null]"); return; }
        Console.WriteLine($"\n-- props of {t.FullName} --");
        foreach(var p in t.Properties.Where(p=>filter==null || p.Name.Contains(filter, StringComparison.OrdinalIgnoreCase)))
            Console.WriteLine($"  {p.PropertyType.FullName} {p.Name}  get={p.GetMethod!=null} set={p.SetMethod!=null}");
    }
    static void DumpFields(TypeDefinition t, string filter=null){
        if (t==null) { Console.WriteLine("[type null]"); return; }
        Console.WriteLine($"\n-- fields of {t.FullName} --");
        foreach(var f in t.Fields.Where(f=>filter==null || f.Name.Contains(filter, StringComparison.OrdinalIgnoreCase)))
            Console.WriteLine($"  {f.FieldType.FullName} {f.Name} static={f.IsStatic} const={f.Constant}");
    }
    static TypeDefinition FindType(AssemblyDefinition asm, string typeName){
        return asm.MainModule.GetTypes().FirstOrDefault(x=>x.Name==typeName);
    }
    static void Main() {
        var dir=@"D:\_vibe\GRC_WEB\libs\Tresorerie\";
        var r=new DefaultAssemblyResolver(); r.AddSearchDirectory(dir);
        var rp = new ReaderParameters{AssemblyResolver=r};

        var core = AssemblyDefinition.ReadAssembly(dir+"Tresorerie.Core.dll", rp);
        var uic = AssemblyDefinition.ReadAssembly(dir+"Tresorerie.UICommun.dll", rp);

        Console.WriteLine("\n=== FiltreTiers enum values ===");
        var ftType = FindType(core, "FiltreTiers");
        if (ftType != null) {
            foreach(var f in ftType.Fields.Where(f=>f.IsStatic))
                Console.WriteLine($"  {f.Name} = {f.Constant}");
        }

        AssemblyDefinition authCore = null;
        try { authCore = AssemblyDefinition.ReadAssembly(dir+"Tresorerie.Authorization.Core.dll", rp); } catch(Exception ex){ Console.WriteLine("no auth core: "+ex.Message); }

        Console.WriteLine("=== CaisseManager.ReglementCreate ===");
        var caisseMgr = FindType(core, "CaisseManager");
        DumpMethodSig(caisseMgr, "ReglementCreate");
        DumpMethodSig(caisseMgr, "ReglementCreateInterne");

        var createIntM = caisseMgr?.Methods.FirstOrDefault(m=>m.Name=="ReglementCreateInterne");
        if (createIntM != null) DumpBodyFull(caisseMgr, createIntM);

        void DumpHelperType(string typeName) {
            Console.WriteLine($"\n=== {typeName} ===");
            var t = uic.MainModule.GetTypes().FirstOrDefault(x=>x.Name==typeName) ?? core.MainModule.GetTypes().FirstOrDefault(x=>x.Name==typeName);
            if (t == null) { Console.WriteLine($"[{typeName} not found in Core nor UICommun]"); return; }
            Console.WriteLine($"-- {t.FullName} -- base={t.BaseType?.FullName}");
            foreach(var ctor in t.Methods.Where(m=>m.IsConstructor))
                Console.WriteLine($"  ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
            foreach(var m in t.Methods.Where(m=>!m.IsConstructor))
                Console.WriteLine($"  {(m.IsStatic?"static ":"")}{m.ReturnType.FullName} {m.Name}({string.Join(", ", m.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
        }
        DumpHelperType("TiersErpHelper");
        DumpHelperType("DeviseViewHelper");
        DumpHelperType("BanqueViewHelper");

        Console.WriteLine("\n=== Societe.GetCaisse ===");
        var societeType = FindType(core, "Societe");
        DumpMethodSig(societeType, "GetCaisse");
        DumpMethodSig(societeType, "GetCaisses");

        Console.WriteLine("\n=== Caisse.HasModeReglement / GetMode ===");
        var caisseType = FindType(core, "Caisse");
        DumpMethodSig(caisseType, "HasModeReglement");
        DumpMethodSig(caisseType, "GetMode");
        DumpProps(caisseType, null);

        Console.WriteLine("\n=== ModeReglement props (Type field for Maroc plafond block) ===");
        var modeRegType = FindType(core, "ModeReglement");
        DumpProps(modeRegType, null);

        Console.WriteLine("\n=== IAuthorizationRepository.HasEntityActionRestriction ===");
        if (authCore != null) {
            var authRepoType = authCore.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="IAuthorizationRepository");
            DumpMethodSig(authRepoType, "HasEntityActionRestriction");

            Console.WriteLine("\n=== ReglementImporter / EcheanceImporterSolde classes ===");
            foreach(var name in new[]{"ReglementImporter","EcheanceImporterSolde"}) {
                var t = authCore.MainModule.GetTypes().FirstOrDefault(x=>x.Name==name);
                if (t==null) { Console.WriteLine($"[{name} not found in Authorization.Core]"); continue; }
                Console.WriteLine($"\n-- {t.FullName} --");
                DumpFields(t);
                DumpProps(t);
                foreach(var ctor in t.Methods.Where(m=>m.IsConstructor))
                    Console.WriteLine($"  ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.Name+" "+p.Name))})");
            }
        }

        Console.WriteLine("\n=== Search for 'Verify' methods across Core + UICommun ===");
        foreach(var asm in new[]{core, uic}) {
            foreach(var t in asm.MainModule.GetTypes()) {
                foreach(var m in t.Methods.Where(m=>m.Name=="Verify")) {
                    Console.WriteLine($"  {t.FullName}.Verify ({string.Join(", ", m.Parameters.Select(p=>p.ParameterType.FullName))}) static={m.IsStatic}");
                }
            }
        }

        Console.WriteLine("\n=== ReglementTiersImport model fields (Core + UICommun) ===");
        var rti = FindType(core, "ReglementTiersImport") ?? uic.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementTiersImport");
        DumpProps(rti);

        Console.WriteLine("\n=== ReglementTiersImportMap (CsvHelper column mapping) ===");
        var map = uic.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementTiersImportMap") ?? core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementTiersImportMap");
        if (map != null) {
            Console.WriteLine($"-- {map.FullName} -- base={map.BaseType?.FullName}");
            var ctorBody = map.Methods.FirstOrDefault(m=>m.IsConstructor && m.HasBody);
            if (ctorBody != null) DumpBodyFull(map, ctorBody);
        } else Console.WriteLine("[not found]");

        Console.WriteLine("\n=== IReglementClientImportService / ReglementClientImportService.ImporterReglements body ===");
        var svcIface = uic.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="IReglementClientImportService");
        var svcImpl = uic.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementClientImportService");
        DumpMethodSig(svcIface, "ImporterReglements");
        if (svcImpl != null) {
            var m = svcImpl.Methods.FirstOrDefault(mm=>mm.Name=="ImporterReglements" && mm.Parameters.Count==1);
            if (m != null) DumpBodyFull(svcImpl, m);

            Console.WriteLine("\n=== ReglementClientImportService ctor (fields/deps) ===");
            foreach(var ctor in svcImpl.Methods.Where(mm=>mm.IsConstructor))
                Console.WriteLine($"  ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
            DumpFields(svcImpl);

            Console.WriteLine("\n=== ReglementClientImportService.Verify body (validation + résolution codes) ===");
            var verifyM = svcImpl.Methods.FirstOrDefault(mm=>mm.Name=="Verify");
            if (verifyM != null) DumpBodyFull(svcImpl, verifyM);

            Console.WriteLine("\n=== VerifMode body ===");
            var verifMode = svcImpl.Methods.FirstOrDefault(mm=>mm.Name=="VerifMode");
            if (verifMode != null) DumpBodyFull(svcImpl, verifMode);

            Console.WriteLine("\n=== ConvertToBoolean body ===");
            var convBool = svcImpl.Methods.FirstOrDefault(mm=>mm.Name=="ConvertToBoolean");
            if (convBool != null) DumpBodyFull(svcImpl, convBool);

            Console.WriteLine("\n=== DisplayClass10_0 (devise predicate lambda) body ===");
            var displayClass = uic.MainModule.GetTypes().FirstOrDefault(x=>x.FullName.Contains("ReglementClientImportService/<>c__DisplayClass10_0"));
            if (displayClass != null) {
                foreach(var mm in displayClass.Methods.Where(x=>!x.IsConstructor))
                    DumpBodyFull(displayClass, mm);
            } else Console.WriteLine("[not found]");
        }

        Console.WriteLine("\n=== Legislation enum ===");
        var legisEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="Legislation");
        if (legisEnum!=null) foreach(var f in legisEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");

        Console.WriteLine("\n=== ReglementType enum ===");
        var rtEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementType");
        if (rtEnum!=null) foreach(var f in rtEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");

        Console.WriteLine("\n=== ReglementNature enum ===");
        var rnEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ReglementNature");
        if (rnEnum!=null) foreach(var f in rnEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");

        Console.WriteLine("\n=== FiltreTiers enum ===");
        var ftEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="FiltreTiers");
        if (ftEnum!=null) foreach(var f in ftEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");

        Console.WriteLine("\n=== AuthorizationEntity enum (for HasEntityActionRestriction) ===");
        if (authCore != null) {
            var aeEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="AuthorizationEntity");
            if (aeEnum!=null) foreach(var f in aeEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");
        }

        Console.WriteLine("\n=== ProfilType enum ===");
        var ptEnum = core.MainModule.GetTypes().FirstOrDefault(x=>x.Name=="ProfilType");
        if (ptEnum!=null) foreach(var f in ptEnum.Fields.Where(f=>f.IsStatic)) Console.WriteLine($"  {f.Name} = {f.Constant}");

        Console.WriteLine("\n=== Societe.GetMode / GetSocieteDevises / LegislationType ===");
        DumpMethodSig(societeType, "GetMode");
        DumpMethodSig(societeType, "GetSocieteDevises");
        DumpProps(societeType, "Legislation");

        Console.WriteLine("\n=== SocieteModeReglement / SocieteDevise / Devise props ===");
        DumpProps(FindType(core, "SocieteModeReglement"));
        DumpProps(FindType(core, "SocieteDevise"));
        DumpProps(FindType(core, "Devise"));

        Console.WriteLine("\n=== IErpClient props ===");
        DumpProps(FindType(core, "IErpClient"));

        Console.WriteLine("\n=== BanqueTiersManager ctor + Get/Create ===");
        var btm = FindType(core, "BanqueTiersManager");
        if (btm != null) {
            foreach(var ctor in btm.Methods.Where(m=>m.IsConstructor))
                Console.WriteLine($"  ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
            DumpMethodSig(btm, "Get");
            DumpMethodSig(btm, "Create");
        } else Console.WriteLine("[BanqueTiersManager not found]");

        Console.WriteLine("\n=== Tresorerie.IoC.Authorization module bindings ===");
        try {
            var authIoc = AssemblyDefinition.ReadAssembly(dir+"Tresorerie.IoC.Authorization.dll", rp);
            foreach(var t in authIoc.MainModule.GetTypes().Where(t=>t.IsClass && !t.IsAbstract)) {
                var loadMethod = t.Methods.FirstOrDefault(m=>m.Name=="Load" && m.HasBody);
                if (loadMethod == null) continue;
                Console.WriteLine($"-- module {t.FullName} --");
                foreach(var instr in loadMethod.Body.Instructions)
                    if (instr.Operand is MethodReference mr2 && (mr2.Name=="Bind" || mr2.Name=="To" || mr2.Name.StartsWith("To")))
                        Console.WriteLine("  " + instr.ToString());
            }
        } catch(Exception ex) { Console.WriteLine("[error] " + ex.Message); }

        Console.WriteLine("\n=== Echeance model fields/props (date facture source) ===");
        var echType = FindType(core, "Echeance");
        DumpProps(echType, null);
        DumpFields(echType, null);

        Console.WriteLine("\n=== ModeReglement — is No/Type hardcoded (static/const) or DB-backed entity? ===");
        if (modeRegType != null) {
            DumpFields(modeRegType, null);
            foreach(var ctor in modeRegType.Methods.Where(m=>m.IsConstructor))
                Console.WriteLine($"  ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
        }

        Console.WriteLine("\n=== ReglementClientImportService.Verify — search for 'Type' comparisons (Maroc plafond block) ===");
        if (svcImpl != null) {
            var verifyM2 = svcImpl.Methods.FirstOrDefault(mm=>mm.Name=="Verify");
            if (verifyM2 != null && verifyM2.HasBody) {
                foreach(var instr in verifyM2.Body.Instructions)
                    if (instr.Operand is Mono.Cecil.MethodReference mrx && (mrx.Name.Contains("Type") || mrx.Name.Contains("Legislation") || mrx.Name.Contains("Plafond") || mrx.Name.Contains("Certif")))
                        Console.WriteLine("  " + instr.ToString());
            }
        }

        Console.WriteLine("\n=== SocieteManager.CaisseManager / IGroupeService.SocieteManager ===");
        var smType = FindType(core, "SocieteManager");
        DumpProps(smType, "CaisseManager");
        var caisseMgrCtors = caisseMgr.Methods.Where(m=>m.IsConstructor);
        foreach(var ctor in caisseMgrCtors)
            Console.WriteLine($"  CaisseManager ctor({string.Join(", ", ctor.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");

        Console.WriteLine("\n=== VerifySoldeManager methods ===");
        var vsmType = FindType(core, "VerifySoldeManager");
        if (vsmType != null) {
            foreach(var m in vsmType.Methods) Console.WriteLine($"  {m.ReturnType.FullName} {m.Name}({string.Join(", ", m.Parameters.Select(p=>p.ParameterType.FullName+" "+p.Name))})");
        }

        Console.WriteLine("\n======================================================================");
        Console.WriteLine("=== EXHAUSTIVE IL SCAN OF ALL DLLs IN libs/Tresorerie/ FOR SoldeDevise ===");
        Console.WriteLine("======================================================================\n");

        int totalDlls = 0, totalTypes = 0, totalMethods = 0;
        int referencesFound = 0;

        string searchDir = @"D:\_vibe\GRC_WEB\libs\Tresorerie";
        foreach (var dllPath in Directory.GetFiles(searchDir, "*.dll"))
        {
            totalDlls++;
            string dllName = Path.GetFileName(dllPath);
            AssemblyDefinition asmDef = null;
            try { asmDef = AssemblyDefinition.ReadAssembly(dllPath, rp); } catch(Exception ex) { Console.WriteLine($"Error reading {dllName}: {ex.Message}"); continue; }

            int dllTypes = 0, dllMethods = 0;
            foreach (var typeDef in asmDef.MainModule.GetTypes())
            {
                totalTypes++; dllTypes++;
                foreach (var methodDef in typeDef.Methods)
                {
                    totalMethods++; dllMethods++;
                    if (!methodDef.HasBody) continue;

                    foreach (var instr in methodDef.Body.Instructions)
                    {
                        // 1. String literals containing SoldeDevise or EC_SoldeDevise
                        if (instr.Operand is string strValue)
                        {
                            if (strValue.IndexOf("SoldeDevise", StringComparison.OrdinalIgnoreCase) >= 0 ||
                                strValue.IndexOf("EC_SoldeDevise", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                referencesFound++;
                                Console.WriteLine($"[STRING LITERAL] {dllName} -> {typeDef.FullName}.{methodDef.Name}:");
                                Console.WriteLine($"   Value: \"{strValue.Replace("\r", "").Replace("\n", " ")}\"\n");
                            }
                        }

                        // 2. Property / Field references
                        if (instr.Operand is FieldReference fieldRef && fieldRef.Name.IndexOf("SoldeDevise", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            referencesFound++;
                            Console.WriteLine($"[FIELD REF] {dllName} -> {typeDef.FullName}.{methodDef.Name} references field {fieldRef.DeclaringType.FullName}.{fieldRef.Name}\n");
                        }
                        if (instr.Operand is MethodReference methodRef && methodRef.Name.IndexOf("SoldeDevise", StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            referencesFound++;
                            Console.WriteLine($"[METHOD REF] {dllName} -> {typeDef.FullName}.{methodDef.Name} calls {methodRef.DeclaringType.FullName}.{methodRef.Name}\n");
                        }
                    }
                }
            }
            Console.WriteLine($"Scanned {dllName}: {dllTypes} types, {dllMethods} methods.");
        }

        Console.WriteLine($"\n=== SCAN SUMMARY ===");
        Console.WriteLine($"DLLs Scanned: {totalDlls}");
        Console.WriteLine($"Types Scanned: {totalTypes}");
        Console.WriteLine($"Methods Scanned: {totalMethods}");
        Console.WriteLine($"Total SoldeDevise / EC_SoldeDevise References Found: {referencesFound}");
    }
}
