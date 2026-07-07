const fs = require('fs');
const path = require('path');

const filePath = path.join('D:\\_vibe\\GRC_WEB\\gocom-web\\src\\RapprochementBancaire.tsx');
let code = fs.readFileSync(filePath, 'utf-8');

// 1. Props
code = code.replace(
    '    user: any;',
    `    user: any;\n    showToast: (msg: string, type?: 'success'|'error'|'warning') => void;\n    onNavigateToImport?: () => void;`
);

// 2. Destructure
code = code.replace(
    'export default function RapprochementBancaire({ caissesMap, modesMap, availableColumns, user }: Props) {',
    'export default function RapprochementBancaire({ caissesMap, modesMap, availableColumns, user, showToast, onNavigateToImport }: Props) {'
);

// 3. getLettrageColor
const colorFunc = `const getLettrageColor = (lettrage: string | null) => {
    if (!lettrage) return undefined;
    const colors = ['#fca5a5', '#fdba74', '#fcd34d', '#fef08a', '#d9f99d', '#bbf7d0', '#86efac', '#6ee7b7', '#5eead4', '#7dd3fc', '#93c5fd', '#c4b5fd', '#d8b4fe', '#f9a8d4', '#fda4af'];
    let hash = 0;
    for (let i = 0; i < lettrage.length; i++) hash = lettrage.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length] + '40';
};\n\n`;

code = code.replace(
    'const GrcTableRow = React.memo(',
    colorFunc + 'const GrcTableRow = React.memo('
);

// 4. Update GrcTableRow style
code = code.replace(
    "style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : {}}",
    "style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : row.lettrage ? { backgroundColor: getLettrageColor(row.lettrage) } : {}}"
);
// And in ReleveTableRow
code = code.replace(
    "style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : {}}",
    "style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : row.lettrage ? { backgroundColor: getLettrageColor(row.lettrage) } : {}}"
);

// 5. Replace alerts with showToast
code = code.replace(/alert\("Veuillez sélectionner un relevé bancaire\."\);/g, 'showToast("Veuillez sélectionner un relevé bancaire.", "warning");');
code = code.replace(/alert\("Aucune correspondance parfaite trouvée \(1=1 sur le montant\)\."\);/g, 'showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");');
code = code.replace(/alert\(`💡 \$\{validProps\.length\} correspondances trouvées et réservées\. \$\{conflits\} conflits ignorés\.`\);/g, 'showToast(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`, "success");');
code = code.replace(/alert\(`💡 L'algorithme a trouvé \$\{validProps\.length\} correspondance\(s\) parfaite\(s\)\. Vérifiez les paires rapprochées puis cliquez sur « Approuver »\.`\);/g, 'showToast(`💡 L\\'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`, "success");');
code = code.replace(/alert\("Erreur lors de l'auto-rapprochement\."\);/g, 'showToast("Erreur lors de l\'auto-rapprochement.", "error");');
code = code.replace(/alert\("Erreur lors de la dissociation\."\);/g, 'showToast("Erreur lors de la dissociation.", "error");');
code = code.replace(/alert\(error\.response\.data\.message \|\| "Déjà réservé par un autre utilisateur\."\);/g, 'showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");');
code = code.replace(/alert\("Erreur lors de la réservation\."\);/g, 'showToast("Erreur lors de la réservation.", "error");');
code = code.replace(/alert\("Erreur lors de la dissociation globale\."\);/g, 'showToast("Erreur lors de la dissociation globale.", "error");');
code = code.replace(/alert\("Aucun rapprochement en cours à approuver\."\);/g, 'showToast("Aucun rapprochement en cours à approuver.", "warning");');
code = code.replace(/alert\("Rapprochement validé avec succès !"\);/g, 'showToast("Rapprochement validé avec succès !", "success");');
code = code.replace(/alert\(`Validation terminée avec des erreurs\.\\nSuccès: \$\{data\.successCount\}, Échecs: \$\{data\.errorCount\}\.\\n\\nErreurs:\\n\$\{data\.errors\.join\('\\n'\)\}`\);/g, 'showToast(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\'\\n\')}`, "warning");');
code = code.replace(/alert\(message\);/g, 'showToast(message, "error");');
code = code.replace(/alert\(error\.response\?\.data\?\.message \|\| "Erreur lors de la validation\."\);/g, 'showToast(error.response?.data?.message || "Erreur lors de la validation.", "error");');

// 6. pendingReservation logic
code = code.replace(
    "const [currentLettrageIndex, setCurrentLettrageIndex] = useState(0);",
    "const [currentLettrageIndex, setCurrentLettrageIndex] = useState(0);\n    const [pendingReservation, setPendingReservation] = useState<{grcId: number, ligneId: number} | null>(null);"
);

// extract executeManualLettrage and applyManualLettrage
const applyManualOld = `const applyManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
        const grc = reglementsGrcRef.current.find(r => r.mv_Id === grcId);
        const releve = lignesReleveRef.current.find(r => r.id === ligneId);

        if (grc?.montant !== releve?.credit) {
            const confirmer = window.confirm("Les montants sont différents. Voulez-vous vraiment forcer le rapprochement ?");
            if (!confirmer) {
                setSelectedGrcId(null);
                setSelectedReleveLigneId(null);
                return;
            }
        }

        const nextLetter = getLettrageFromIndex(currentLettrageIndexRef.current);
        
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const currentUserId = userStr ? JSON.parse(userStr).no : 0;
            
            await axios.post(\`\${API_BASE}/ReleveBancaire/reserve\`, {
                ligneReleveId: ligneId,
                mvId: grcId,
                lettrage: nextLetter
            }, { headers: { Authorization: \`Bearer \${token}\` } });
            
            setReglementsGrc(prev => prev.map(r => r.mv_Id === grcId ? { ...r, lettrage: nextLetter, reservePar_UserId: currentUserId } : r));
            setLignesReleve(prev => prev.map(l => l.id === ligneId ? { ...l, lettrage: nextLetter, reservePar_UserId: currentUserId } : l));
            setCurrentLettrageIndex(c => c + 1);
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        } catch (error: any) {
            if (error.response?.status === 409) {
                showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");
            } else {
                showToast("Erreur lors de la réservation.", "error");
            }
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        }
    }, [getLettrageFromIndex]);`;

const applyManualNew = `const executeManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
        const nextLetter = getLettrageFromIndex(currentLettrageIndexRef.current);
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const currentUserId = userStr ? JSON.parse(userStr).no : 0;
            
            await axios.post(\`\${API_BASE}/ReleveBancaire/reserve\`, {
                ligneReleveId: ligneId,
                mvId: grcId,
                lettrage: nextLetter
            }, { headers: { Authorization: \`Bearer \${token}\` } });
            
            setReglementsGrc(prev => prev.map(r => r.mv_Id === grcId ? { ...r, lettrage: nextLetter, reservePar_UserId: currentUserId } : r));
            setLignesReleve(prev => prev.map(l => l.id === ligneId ? { ...l, lettrage: nextLetter, reservePar_UserId: currentUserId } : l));
            setCurrentLettrageIndex(c => c + 1);
            setPendingReservation(null);
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        } catch (error: any) {
            if (error.response?.status === 409) {
                showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");
            } else {
                showToast("Erreur lors de la réservation.", "error");
            }
            setPendingReservation(null);
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        }
    }, [getLettrageFromIndex]);

    const applyManualLettrage = React.useCallback((grcId: number, ligneId: number) => {
        const grc = reglementsGrcRef.current.find(r => r.mv_Id === grcId);
        const releve = lignesReleveRef.current.find(r => r.id === ligneId);

        if (grc?.montant !== releve?.credit) {
            setPendingReservation({ grcId, ligneId });
            return;
        }
        executeManualLettrage(grcId, ligneId);
    }, [executeManualLettrage]);`;

code = code.replace(applyManualOld, applyManualNew);

// Manual Actions footer update
const manualActionsOld = `<button
                            className="btn btn-primary"
                            onClick={() => applyManualLettrage(selectedGrcId!, selectedReleveLigneId!)}
                            disabled={!selectedGrcId || !selectedReleveLigneId}
                        >
                            Associer (manuel)
                        </button>`;

const manualActionsNew = `{pendingReservation ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#fff3cd', padding: '8px 12px', borderRadius: '6px', border: '1px solid #ffe69c' }}>
                                <span style={{ fontSize: '0.875rem', color: '#664d03', fontWeight: 500 }}>Les montants diffèrent. Forcer l'association ?</span>
                                <button className="btn btn-success" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => executeManualLettrage(pendingReservation.grcId, pendingReservation.ligneId)}>Oui</button>
                                <button className="btn btn-ghost-danger" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => setPendingReservation(null)}>Non</button>
                            </div>
                        ) : (
                            <button
                                className="btn btn-primary"
                                onClick={() => applyManualLettrage(selectedGrcId!, selectedReleveLigneId!)}
                                disabled={!selectedGrcId || !selectedReleveLigneId}
                            >
                                Associer (manuel)
                            </button>
                        )}`;

code = code.replace(manualActionsOld, manualActionsNew);

// Empty State update
const emptyStateOld = `<table>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>`;
                                    
const emptyStateNew = `{selectedBanqueId && releves.length === 0 ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <p style={{ fontSize: '1.125rem', marginBottom: '8px' }}>Aucun relevé importé pour cette banque.</p>
                                {onNavigateToImport && (
                                    <button className="btn btn-primary" onClick={onNavigateToImport} style={{ marginTop: '16px' }}>
                                        Aller à l'import de relevé
                                    </button>
                                )}
                            </div>
                        ) : (
                            <table>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>`;

// Wait, there are two table tags, one for Relevé, one for GRC. We only want to modify the Relevé one.
// Let's replace the one in the grid-header 'Relevé Bancaire' context.
code = code.replace(
    '<div className="table-container">\n                        <table>\n                            <thead>\n                                <tr>\n                                    <th style={{width: \'40px\'}}>Sel.</th>',
    `<div className="table-container">\n                        ${emptyStateNew}`
);

// We need to close the ternary for the empty state
const tableCloseOld = `</ReleveTableBody>\n                        </table>\n                    </div>`;
const tableCloseNew = `</ReleveTableBody>\n                        </table>\n                        )}\n                    </div>`;
code = code.replace(tableCloseOld, tableCloseNew);

fs.writeFileSync(filePath, code);
console.log('Update complete');
