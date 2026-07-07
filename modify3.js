const fs = require('fs');
const path = require('path');
const filepath = path.join('D:\\_vibe\\GRC_WEB\\gocom-web\\src\\RapprochementBancaire.tsx');
let code = fs.readFileSync(filepath, 'utf-8');

const replacements = [
    ['alert("Veuillez sélectionner un relevé bancaire.");', 'showToast("Veuillez sélectionner un relevé bancaire.", "warning");'],
    ['alert("Aucune correspondance parfaite trouvée (1=1 sur le montant).");', 'showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");'],
    ['alert(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`);', 'showToast(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`, "success");'],
    ["alert(`💡 L'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`);", 'showToast(`💡 L\\'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`, "success");'],
    ['alert("Erreur lors de l\\'auto-rapprochement.");', 'showToast("Erreur lors de l\\'auto-rapprochement.", "error");'],
    ['alert("Erreur lors de la dissociation.");', 'showToast("Erreur lors de la dissociation.", "error");'],
    ['alert(error.response.data.message || "Déjà réservé par un autre utilisateur.");', 'showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");'],
    ['alert("Erreur lors de la réservation.");', 'showToast("Erreur lors de la réservation.", "error");'],
    ['alert("Erreur lors de la dissociation globale.");', 'showToast("Erreur lors de la dissociation globale.", "error");'],
    ['alert("Aucun rapprochement en cours à approuver.");', 'showToast("Aucun rapprochement en cours à approuver.", "warning");'],
    ['alert("Rapprochement validé avec succès !");', 'showToast("Rapprochement validé avec succès !", "success");'],
    ['alert(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\\'\\\\n\\')}`);', 'showToast(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\\'\\\\n\\')}`, "warning");'],
    ['alert(message);', 'showToast(message, "error");']
];

for (const [old, newStr] of replacements) {
    code = code.split(old).join(newStr);
}

// Add the banner
const gridSplitOld = `                </div>

                {/* GRILLE GAUCHE : GRC (Maintenant en bas) */}`;
const gridSplitNew = `                </div>

                {pendingReservation && (
                    <div style={{ padding: '12px 16px', background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: '8px', color: '#664d03', display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0' }}>
                        <div>
                            <strong>Attention :</strong> Les montants sélectionnés sont différents. Voulez-vous vraiment forcer le rapprochement ?
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-success" onClick={() => executeManualLettrage(pendingReservation.grcId, pendingReservation.ligneId)}>Forcer le rapprochement</button>
                            <button className="btn btn-ghost-danger" onClick={() => { setPendingReservation(null); setSelectedGrcId(null); setSelectedReleveLigneId(null); }}>Annuler</button>
                        </div>
                    </div>
                )}

                {/* GRILLE GAUCHE : GRC (Maintenant en bas) */}`;

code = code.replace(gridSplitOld, gridSplitNew);

fs.writeFileSync(filepath, code);
console.log("Updated alerts and banner");
