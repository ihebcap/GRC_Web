

export const DEFAULT_COLUMNS = ['no', 'client', 'caisseCode', 'caisseIntitule', 'mode', 'date', 'montant', 'pointe', 'comptabilise'];

export const getTypeReglementLabel = (typeNo?: number) => {
  if (typeNo === undefined || typeNo === null) return '';
  switch (typeNo) {
    case 0: return 'Espèce';
    case 1: return 'Chèque';
    case 2: return 'Traite';
    case 3: return 'Virement';
    case 4: return 'Carte Bancaire';
    default: return 'Autre';
  }
};

export const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
};

export const formatMoney = (amount: number) => {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(amount || 0);
};

export const getAvailableColumns = (user: any) => [
  { key: 'no', label: 'N°' },
  { key: 'client', label: 'Client' },
  { key: 'date', label: 'Date' },
  { key: 'montant', label: 'Montant Devise' },
  { key: 'solde', label: 'Solde' },
  { key: 'caisseCode', label: 'Code Caisse' },
  { key: 'caisseIntitule', label: 'Intitulé Caisse' },
  { key: 'banque', label: 'Banque' },
  { key: 'banqueClient', label: 'Banque Client' },
  { key: 'mode', label: 'Mode Rég.' },
  { key: 'typeReglement', label: 'Type Rég.' },
  { key: 'pointe', label: 'Pointé' },
  { key: 'comptabilise', label: 'Comptabilisé' },
  { key: 'remis', label: 'Remis' },
  { key: 'impaye', label: 'Impaye' },
  { key: 'annule', label: 'Annulé' },
  { key: 'piece', label: 'Pièce' },
  { key: 'extrait', label: 'Extrait' },
  { key: 'numero', label: 'Numéro' },
  { key: 'reference', label: 'Référence' },
  { key: 'libelle', label: 'Libellé' },
  { key: 'info1', label: user?.info1Label || 'Info 1' },
  { key: 'info2', label: user?.info2Label || 'Info 2' },
  { key: 'info3', label: user?.info3Label || 'Info 3' },
  { key: 'info4', label: user?.info4Label || 'Info 4' },
];

export const renderSharedCell = (key: string, reg: any, caissesMap: Record<number, any>, modesMap: Record<number, any>, banquesMap: Record<number, any> = {}) => {
  switch (key) {
    case 'no': return <span style={{color: 'var(--text-secondary)'}}>#{reg.no || reg.mv_Id}</span>;
    case 'client': return <span style={{fontWeight: 500}}>{reg.clientIntitule || 'N/A'}</span>;
    case 'caisseCode': return caissesMap[reg.caisseNo] ? caissesMap[reg.caisseNo].code : reg.caisseNo;
    case 'caisseIntitule': return caissesMap[reg.caisseNo] ? caissesMap[reg.caisseNo].intitule : '';
    case 'banque': return banquesMap[reg.banqueNo] ? banquesMap[reg.banqueNo].code : (reg.banqueNo || '-');
    case 'banqueClient': return reg.banqueTier || reg.ribClient || '-';
    case 'mode': return modesMap[reg.modeReglementNo] ? `${modesMap[reg.modeReglementNo].code} - ${modesMap[reg.modeReglementNo].intitule}` : reg.modeReglementNo;
    case 'typeReglement': return getTypeReglementLabel(modesMap[reg.modeReglementNo]?.typeNo);
    case 'date': return formatDate(reg.date);
    case 'montant': return <span style={{fontWeight: 600}}>{formatMoney(reg.montantDeviseSociete || reg.montant)}</span>;
    case 'pointe': return reg.isPointe ? <span className="badge badge-success">OUI</span> : <span className="text-secondary">-</span>;
    case 'comptabilise': return reg.isComptabilise > 0 ? <span className="badge badge-success">OUI</span> : <span className="text-secondary">-</span>;
    case 'remis': return reg.isRemis > 0 ? <span className="badge badge-success">OUI</span> : <span className="text-secondary">-</span>;
    case 'impaye': return reg.isImpaye > 0 ? <span className="badge badge-danger">OUI</span> : <span className="text-secondary">-</span>;
    case 'annule': return reg.isAnnule ? <span className="badge badge-warning">OUI</span> : <span className="text-secondary">-</span>;
    case 'piece': return reg.pieceNumero || '-';
    case 'extrait': return reg.extraitNum || '-';
    case 'reference': return reg.reference || '-';
    case 'numero': return reg.numero || '-';
    case 'libelle': return reg.libelle || '-';
    case 'solde': return <span style={{fontWeight: 600, color: reg.soldeDeviseSociete > 0 ? 'var(--danger)' : 'var(--success)'}}>{formatMoney(reg.soldeDeviseSociete || 0)}</span>;
    case 'info1': return reg.info1 || '-';
    case 'info2': return reg.info2 || '-';
    case 'info3': return reg.info3 || '-';
    case 'info4': return reg.info4 || '-';
    case 'lettrage': return <span className="lettrage-cell">{reg.lettrage || ''}</span>;
    default: return null;
  }
};
