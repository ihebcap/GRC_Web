const fs = require('fs');
const path = require('path');
const filepath = path.join('D:\\_vibe\\GRC_WEB\\gocom-web\\src\\RapprochementBancaire.tsx');
let code = fs.readFileSync(filepath, 'utf-8');

const replacements = [
    { old: \`alert("Veuillez sélectionner un relevé bancaire.");\`, newStr: \`showToast("Veuillez sélectionner un relevé bancaire.", "warning");\` },
    { old: \`alert("Aucune correspondance parfaite trouvée (1=1 sur le montant).");\`, newStr: \`showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");\` },
    { old: \`alert(\\\`💡 \${validProps.length} correspondances trouvées et réservées. \${conflits} conflits ignorés.\\\`);\`, newStr: \`showToast(\\\`💡 \${validProps.length} correspondances trouvées et réservées. \${conflits} conflits ignorés.\\\`, "success");\` },
    { old: \`alert(\\\`💡 L'algorithme a trouvé \${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».\\\`);\`, newStr: \`showToast(\\\`💡 L'algorithme a trouvé \${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».\\\`, "success");\` },
    { old: \`alert("Erreur lors de l'auto-rapprochement.");\`, newStr: \`showToast("Erreur lors de l'auto-rapprochement.", "error");\` },
    { old: \`alert("Erreur lors de la dissociation.");\`, newStr: \`showToast("Erreur lors de la dissociation.", "error");\` },
    { old: \`alert(error.response.data.message || "Déjà réservé par un autre utilisateur.");\`, newStr: \`showToast(error.response.data.message || "Déjà réservé par un autre utilisateur.", "error");\` },
    { old: \`alert("Erreur lors de la réservation.");\`, newStr: \`showToast("Erreur lors de la réservation.", "error");\` },
    { old: \`alert("Erreur lors de la dissociation globale.");\`, newStr: \`showToast("Erreur lors de la dissociation globale.", "error");\` },
    { old: \`alert("Aucun rapprochement en cours à approuver.");\`, newStr: \`showToast("Aucun rapprochement en cours à approuver.", "warning");\` },
    { old: \`alert("Rapprochement validé avec succès !");\`, newStr: \`showToast("Rapprochement validé avec succès !", "success");\` },
    { old: \`alert(\\\`Validation terminée avec des erreurs.\\\\nSuccès: \${data.successCount}, Échecs: \${data.errorCount}.\\\\n\\\\nErreurs:\\\\n\${data.errors.join('\\\\n')}\\\`);\`, newStr: \`showToast(\\\`Validation terminée avec des erreurs.\\\\nSuccès: \${data.successCount}, Échecs: \${data.errorCount}.\\\\n\\\\nErreurs:\\\\n\${data.errors.join('\\\\n')}\\\`, "warning");\` },
    { old: \`alert(message);\`, newStr: \`showToast(message, "error");\` }
];

for (const { old, newStr } of replacements) {
    code = code.split(old).join(newStr);
}

fs.writeFileSync(filepath, code);
console.log("Updated alerts");
