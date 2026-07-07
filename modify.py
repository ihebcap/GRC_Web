import re

filepath = r"D:\_vibe\GRC_WEB\gocom-web\src\RapprochementBancaire.tsx"
with open(filepath, 'r', encoding='utf-8') as f:
    code = f.read()

replacements = [
    ('alert("Veuillez sélectionner un relevé bancaire.");', 'showToast("Veuillez sélectionner un relevé bancaire.", "warning");'),
    ('alert("Aucune correspondance parfaite trouvée (1=1 sur le montant).");', 'showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");'),
    ('alert(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`);', 'showToast(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`, "success");'),
    ('alert(`💡 L\'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`);', 'showToast(`💡 L\\'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`, "success");'),
    ('alert("Erreur lors de l\'auto-rapprochement.");', 'showToast("Erreur lors de l\'auto-rapprochement.", "error");'),
    ('alert("Erreur lors de la dissociation.");', 'showToast("Erreur lors de la dissociation.", "error");'),
    ('alert(error.response.data.message || "Déjà réservé par un autre utilisateur.");', 'showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");'),
    ('alert("Erreur lors de la réservation.");', 'showToast("Erreur lors de la réservation.", "error");'),
    ('alert("Erreur lors de la dissociation globale.");', 'showToast("Erreur lors de la dissociation globale.", "error");'),
    ('alert("Aucun rapprochement en cours à approuver.");', 'showToast("Aucun rapprochement en cours à approuver.", "warning");'),
    ('alert("Rapprochement validé avec succès !");', 'showToast("Rapprochement validé avec succès !", "success");'),
    ('alert(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\'\\n\')}`);', 'showToast(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\'\\n\')}`, "warning");'),
    ('alert(message);', 'showToast(message, "error");')
]

for old, new in replacements:
    code = code.replace(old, new)

# Update state variables
state_old = 'const [currentLettrageIndex, setCurrentLettrageIndex] = useState(0);'
state_new = 'const [currentLettrageIndex, setCurrentLettrageIndex] = useState(0);\n    const [pendingReservation, setPendingReservation] = useState<{grcId: number, ligneId: number} | null>(null);'
code = code.replace(state_old, state_new)

# applyManualLettrage updates
apply_manual_old = """    const applyManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
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
            
            await axios.post(`${API_BASE}/ReleveBancaire/reserve`, {
                ligneReleveId: ligneId,
                mvId: grcId,
                lettrage: nextLetter
            }, { headers: { Authorization: `Bearer ${token}` } });
            
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
    }, [getLettrageFromIndex, showToast]);"""

apply_manual_new = """    const executeManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
        const nextLetter = getLettrageFromIndex(currentLettrageIndexRef.current);
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const currentUserId = userStr ? JSON.parse(userStr).no : 0;
            
            await axios.post(`${API_BASE}/ReleveBancaire/reserve`, {
                ligneReleveId: ligneId,
                mvId: grcId,
                lettrage: nextLetter
            }, { headers: { Authorization: `Bearer ${token}` } });
            
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
    }, [getLettrageFromIndex, showToast]);

    const applyManualLettrage = React.useCallback((grcId: number, ligneId: number) => {
        const grc = reglementsGrcRef.current.find(r => r.mv_Id === grcId);
        const releve = lignesReleveRef.current.find(r => r.id === ligneId);

        if (grc?.montant !== releve?.credit) {
            setPendingReservation({ grcId, ligneId });
            return;
        }
        executeManualLettrage(grcId, ligneId);
    }, [executeManualLettrage]);"""

# Oh wait, the old one was replaced with `alert` to `showToast` in memory but the text above has `showToast`! 
# Let me use the original one which has `alert`.
apply_manual_old = apply_manual_old.replace('showToast(', 'alert(').replace(', "error")', '')

code = code.replace(apply_manual_old, apply_manual_new)

# If it didn't replace, try with `alert` in the old block since I did the `alert` replacements before?
# Ah wait, I did `code.replace` for `alert` *before* this. So the `apply_manual_old` *should* have `showToast`.
# So it will match if it has `showToast`.

# Manual Actions footer update
manual_actions_old = '''                        <button
                            className="btn btn-primary"
                            onClick={() => applyManualLettrage(selectedGrcId!, selectedReleveLigneId!)}
                            disabled={!selectedGrcId || !selectedReleveLigneId}
                        >
                            Associer (manuel)
                        </button>'''

manual_actions_new = '''                        {pendingReservation ? (
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
                        )}'''

code = code.replace(manual_actions_old, manual_actions_new)

# Empty State update
empty_state_old = '''<div className="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>'''

empty_state_new = '''<div className="table-container">
                        {selectedBanqueId && releves.length === 0 ? (
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
                                    <th style={{width: '40px'}}>Sel.</th>'''

code = code.replace(empty_state_old, empty_state_new, 1)

table_close_old = '''</ReleveTableBody>
                        </table>
                    </div>'''

table_close_new = '''</ReleveTableBody>
                        </table>
                        )}
                    </div>'''

code = code.replace(table_close_old, table_close_new, 1)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(code)

print("Update complete")
