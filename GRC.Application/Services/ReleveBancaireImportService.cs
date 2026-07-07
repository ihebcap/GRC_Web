using System;
using System.Collections.Generic;
using System.IO;
using ExcelDataReader;
using System.Data;
using GRC.Domain.Entities;

namespace GRC.Application.Services
{
    public class ReleveBancaireImportService
    {
        public ReleveImportResult ParserFichierExcel(Stream fileStream, string titre, int? banqueId, string userId)
        {
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

            var importResult = new ReleveImportResult();
            importResult.Entete = new ReleveBancaireEntete
            {
                Titre = titre,
                BanqueId = banqueId ?? 0,
                DateImport = DateTime.Now,
                ImportePar_UserId = userId,
                Lignes = new List<ReleveBancaireLigne>()
            };

            using (var reader = ExcelReaderFactory.CreateReader(fileStream))
            {
                var result = reader.AsDataSet(new ExcelDataSetConfiguration()
                {
                    ConfigureDataTable = (_) => new ExcelDataTableConfiguration()
                    {
                        UseHeaderRow = true
                    }
                });

                if (result.Tables.Count > 0)
                {
                    var table = result.Tables[0];
                    
                    // We assume basic columns might be: Date, Libelle, Reference, Debit, Credit
                    // Need to gracefully handle variations or standard expected columns.
                    // For now, let's look for standard terms in columns.
                    int colDateOp = -1, colDateVal = -1, colLibelle = -1, colRef = -1, colCode = -1, colDebit = -1, colCredit = -1;
                    
                    for (int i = 0; i < table.Columns.Count; i++)
                    {
                        var colName = table.Columns[i].ColumnName?.ToLower() ?? "";
                        if (colName.Contains("date") && !colName.Contains("valeur")) colDateOp = i;
                        else if (colName.Contains("valeur")) colDateVal = i;
                        else if (colName.Contains("libell") || colName.Contains("opéra") || colName.Contains("opera")) colLibelle = i;
                        else if (colName.Contains("ref") || colName.Contains("réf")) colRef = i;
                        else if (colName.Contains("code")) colCode = i;
                        else if (colName.Contains("debit") || colName.Contains("débit") || colName.Contains("retrait")) colDebit = i;
                        else if (colName.Contains("credit") || colName.Contains("crédit") || colName.Contains("versement")) colCredit = i;
                    }

                    // Fallback to indices if columns have weird names
                    if (colDateOp == -1) colDateOp = 0;
                    if (colLibelle == -1) colLibelle = 1;
                    if (colDebit == -1) colDebit = 2;
                    if (colCredit == -1) colCredit = 3;

                    int rowIndex = 1; // Start at 1 for headers
                    foreach (DataRow row in table.Rows)
                    {
                        rowIndex++;
                        try
                        {
                            DateTime ParseDate(object val)
                            {
                                if (val == null || val == DBNull.Value) throw new FormatException("Date manquante ou vide.");
                                if (val is DateTime dt) return dt;
                                if (val is double d) return DateTime.FromOADate(d);
                                
                                var strVal = val.ToString();
                                if (string.IsNullOrWhiteSpace(strVal)) throw new FormatException("Date manquante ou vide.");
                                
                                if (DateTime.TryParse(strVal, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out DateTime resInv))
                                    return resInv;
                                if (DateTime.TryParse(strVal, new System.Globalization.CultureInfo("fr-FR"), System.Globalization.DateTimeStyles.None, out DateTime resFr))
                                    return resFr;
                                    
                                throw new FormatException($"Format de date non reconnu : {strVal}");
                            }

                            decimal ParseDecimal(object val)
                            {
                                if (val == null || val == DBNull.Value) return 0;
                                if (val is double dVal) return (decimal)dVal;
                                if (val is decimal decVal) return decVal;
                                if (val is int iVal) return (decimal)iVal;
                                
                                var strVal = val.ToString()?.Trim();
                                if (string.IsNullOrWhiteSpace(strVal)) return 0;
                                
                                if (decimal.TryParse(strVal, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out decimal resInv))
                                    return resInv;
                                    
                                if (decimal.TryParse(strVal, System.Globalization.NumberStyles.Any, new System.Globalization.CultureInfo("fr-FR"), out decimal resFr))
                                    return resFr;
                                    
                                return 0;
                            }

                            DateTime dateOp;
                            try { dateOp = ParseDate(row[colDateOp]); } catch (Exception ex) { throw new Exception("Date d'opération invalide: " + ex.Message); }

                            var libelle = colLibelle >= 0 && colLibelle < table.Columns.Count ? row[colLibelle]?.ToString() : "";
                            
                            DateTime dateVal = dateOp;
                            if (colDateVal >= 0 && colDateVal < table.Columns.Count)
                            {
                                try { dateVal = ParseDate(row[colDateVal]); } catch { }
                            }
                            
                            var reference = colRef >= 0 && colRef < table.Columns.Count ? row[colRef]?.ToString() : "";
                            var code = colCode >= 0 && colCode < table.Columns.Count ? row[colCode]?.ToString() : "";
                            
                            decimal debit = 0, credit = 0;
                            if (colDebit >= 0 && colDebit < table.Columns.Count) debit = ParseDecimal(row[colDebit]);
                            if (colCredit >= 0 && colCredit < table.Columns.Count) credit = ParseDecimal(row[colCredit]);

                            if (debit == 0 && credit == 0) continue;

                            importResult.Entete.Lignes.Add(new ReleveBancaireLigne
                            {
                                DateOperation = dateOp,
                                DateValeur = dateVal,
                                Libelle = libelle ?? "",
                                Reference = reference ?? "",
                                Code = code ?? "",
                                Debit = debit,
                                Credit = credit,
                                MontantReel = credit > 0 ? credit : debit
                            });
                        }
                        catch (Exception ex)
                        {
                            importResult.LignesRejetees.Add(new LigneRejetee 
                            { 
                                NumeroLigne = rowIndex, 
                                Raison = ex.Message 
                            });
                        }
                    }
                }
            }

            return importResult;
        }
    }

    public class ReleveImportResult
    {
        public ReleveBancaireEntete Entete { get; set; } = new ReleveBancaireEntete();
        public List<LigneRejetee> LignesRejetees { get; set; } = new List<LigneRejetee>();
    }

    public class LigneRejetee
    {
        public int NumeroLigne { get; set; }
        public string Raison { get; set; } = string.Empty;
    }
}
