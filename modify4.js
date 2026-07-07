const fs = require('fs');
const path = require('path');
const filepath = path.join('D:\\_vibe\\GRC_WEB\\gocom-web\\src\\RapprochementBancaire.tsx');
let code = fs.readFileSync(filepath, 'utf-8');

const replacements = [
    ['alert("Veuillez sélectionner un relevé bancaire.");', 'showToast("Veuillez sélectionner un relevé bancaire.", "warning");'],
    ['alert("Aucune correspondance parfaite trouvée (1=1 sur le montant).");', 'showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");'],
    ['alert(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`);', 'showToast(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`, "success");'],
    ["alert(`💡 L'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`);", "showToast(`💡 L'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`, 'success');"],
    ['alert("Erreur lors de l\\'auto-rapprochement.");', "showToast(\"Erreur lors de l'auto-rapprochement.\", \"error\");"],
    ['alert("Erreur lors de la dissociation.");', 'showToast("Erreur lors de la dissociation.", "error");'],
    ['alert(error.response.data.message || "Déjà réservé par un autre utilisateur.");', 'showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");'],
    ['alert("Erreur lors de la réservation.");', 'showToast("Erreur lors de la réservation.", "error");'],
    ['alert("Erreur lors de la dissociation globale.");', 'showToast("Erreur lors de la dissociation globale.", "error");'],
    ['alert("Aucun rapprochement en cours à approuver.");', 'showToast("Aucun rapprochement en cours à approuver.", "warning");'],
    ['alert("Rapprochement validé avec succès !");', 'showToast("Rapprochement validé avec succès !", "success");'],
    ['alert(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join(\\'\\\\n\\')}`);', "showToast(`Validation terminée avec des erreurs.\\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\\n\\nErreurs:\\n${data.errors.join('\\n')}`, 'warning');"],
    ['alert(message);', 'showToast(message, "error");']
];

for (const [old, newStr] of replacements) {
    code = code.split(old).join(newStr);
}

fs.writeFileSync(filepath, code);
console.log("Updated alerts");
