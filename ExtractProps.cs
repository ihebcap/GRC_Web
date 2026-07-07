using System;
using System.Reflection;
class Program {
    static void Main() {
        var asm = Assembly.LoadFrom("D:\_vibe\GRC_WEB\libs\Tresorerie.Core.dll");
        var type = asm.GetType("Tresorerie.Core.Models.ReglementClient");
        foreach(var prop in type.GetProperties()) {
            Console.WriteLine("public " + prop.PropertyType.FullName + " " + prop.Name + " { get; set; }");
        }
    }
}
