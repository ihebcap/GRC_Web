import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Loader2, CheckSquare, RefreshCw, Filter, ChevronRight, ChevronDown, CheckCircle2, AlertCircle } from 'lucide-react';

import { API_BASE } from './api';

interface User {
  no: number;
  login: string;
  nom: string;
  prenom: string;
  societeId: number;
  societeName: string;
  caisses: number[];
}

interface Ecriture {
  compteGeneral: string;
  contrePartieCompteG: string | null;
  tiersNumero: string | null;
  codeJournal: string;
  libelle: string;
  sens: number;              // 0 = Débit, 1 = Crédit
  montantDebit: number;
  montantCredit: number;
  date: string;
  echeance: string;
  numeroPiece: string | null;
}

interface Apercu {
  id: number;
  client: string;
  date: string;
  montant: number;
  piece: string;
  ecritures: Ecriture[];
}

interface ApercuComptabilisationProps {
  user: User;
  showToast: (message: string, type?: 'success'|'error'|'warning') => void;
  caissesMap: Record<string, string>;
  modesMap: Record<string, string>;
}

const CheckboxDropdown = ({ 
  options, 
  selectedValues, 
  onChange, 
  placeholder 
}: { 
  options: {value: string, label: string}[], 
  selectedValues: string[], 
  onChange: (vals: string[]) => void,
  placeholder: string
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleAll = () => {
    if (selectedValues.length === options.length) onChange([]);
    else onChange(options.map(o => o.value));
  };

  const toggleOne = (val: string) => {
    if (selectedValues.includes(val)) onChange(selectedValues.filter(v => v !== val));
    else onChange([...selectedValues, val]);
  };

  return (
    <div ref={containerRef} style={{position: 'relative', width: '220px'}}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{
          border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.375rem 0.625rem',
          backgroundColor: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontSize: '0.8125rem'
        }}>
        <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
          {selectedValues.length === 0 ? placeholder : 
           selectedValues.length === options.length ? 'Tous sélectionnés' : 
           selectedValues.length === 1 ? options.find(o => o.value === selectedValues[0])?.label :
           `${selectedValues.length} sélectionnés`}
        </span>
        <ChevronDown size={16} style={{color: 'var(--text-tertiary)'}} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: '100%',
          backgroundColor: 'white', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)', zIndex: 9999, maxHeight: '250px', overflowY: 'auto'
        }}>
          <div 
            onClick={toggleAll}
            style={{padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, backgroundColor: '#f9fafb'}}
          >
            <input type="checkbox" checked={selectedValues.length === options.length && options.length > 0} readOnly style={{cursor: 'pointer'}} />
            (TOUT SÉLECTIONNER)
          </div>
          {options.map(opt => (
            <div 
              key={opt.value} 
              onClick={() => toggleOne(opt.value)}
              style={{padding: '0.5rem 0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem'}}
              className="dropdown-item-hover"
            >
              <input type="checkbox" checked={selectedValues.includes(opt.value)} readOnly style={{cursor: 'pointer'}} />
              {opt.label}
            </div>
          ))}
          {options.length === 0 && <div style={{padding: '0.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'gray'}}>Aucun élément</div>}
        </div>
      )}
    </div>
  );
};

export default function ApercuComptabilisation({ user, showToast, caissesMap }: ApercuComptabilisationProps) {
  const [caisses, setCaisses] = useState<string[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [dynamicModes, setDynamicModes] = useState<{value: string, label: string}[]>([]);
  
  const [dateDebut, setDateDebut] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateFin, setDateFin] = useState(() => new Date().toISOString().split('T')[0]);
  const [rapproche, setRapproche] = useState<'all' | 'oui' | 'non'>('all');

  const [loading, setLoading] = useState(false);
  const [apercus, setApercus] = useState<Apercu[]>([]);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch dynamic modes when caisses change
  useEffect(() => {
    const fetchModes = async () => {
      try {
        const caissesStr = caisses.length ? caisses.join(',') : user.caisses.join(',');
        const res = await axios.get(`${API_BASE}/reference/modes?caisses=${caissesStr}`);
        const newModes = res.data.map((m: any) => ({ value: m.id.toString(), label: `${m.code} - ${m.intitule}` }));
        setDynamicModes(newModes);
        // Filter out selected modes that are no longer available
        const availableModeIds = newModes.map((m: any) => m.value);
        setModes(prev => prev.filter(v => availableModeIds.includes(v)));
      } catch (err) {
        console.error("Erreur chargement modes", err);
      }
    };
    fetchModes();
  }, [caisses, user.caisses]);

  const formatMoney = (val: number | null | undefined) => {
    if (val == null) return '';
    return new Intl.NumberFormat('fr-FR', { style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
  };

  const handleSimuler = async () => {
    setLoading(true);
    setApercus([]);
    setExpandedRows({});
    try {
      const res = await axios.get(`${API_BASE}/reglements`, {
        params: {
          societeId: user.societeId,
          caisses: user.caisses.join(','),
          caisseNos: caisses.length ? caisses.join(',') : undefined,
          modeNos: modes.length ? modes.join(',') : undefined,
          pointe: rapproche === 'all' ? undefined : (rapproche === 'oui'),
          dateDebut,
          dateFin,
          page: 1,
          pageSize: 10000
        }
      });
      const allReglements = res.data.items || [];
      const nonComptabilises = allReglements.filter((r: any) => r.isComptabilise === 0);
      
      if (nonComptabilises.length === 0) {
        showToast('Aucun règlement à comptabiliser pour ces critères.', 'warning');
        setLoading(false);
        return;
      }

      const ids = nonComptabilises.map((r: any) => r.no);
      const resPreview = await axios.post(`${API_BASE}/reglements/apercu-comptabilisation`, ids);
      
      const apercusData = resPreview.data.map((ap: any) => {
         const reg = nonComptabilises.find((r: any) => r.no === ap.id);
         return {
           id: ap.id,
           client: reg?.clientIntitule || '',
           date: reg?.date || '',
           montant: reg?.montant || 0,
           piece: reg?.pieceNumero || '',
           ecritures: ap.ecritures || []
         };
      });

      setApercus(apercusData);
      showToast(`Simulation générée pour ${apercusData.length} règlements`, 'success');
      
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la simulation', 'error');
    } finally {
      setLoading(false);
    }
  };

  const toggleRow = (id: number) => {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const totalDebit = apercus.reduce((acc, curr) => acc + curr.ecritures.reduce((s, e) => s + e.montantDebit, 0), 0);
  const totalCredit = apercus.reduce((acc, curr) => acc + curr.ecritures.reduce((s, e) => s + e.montantCredit, 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const hasErrors = apercus.some(a => a.ecritures.some(e => !e.compteGeneral));

  const handleValider = async () => {
    if (apercus.length === 0) return;
    setIsSubmitting(true);
    try {
      const ids = apercus.map(a => a.id);
      const res = await axios.post(`${API_BASE}/reglements/comptabiliser`, ids);
      if (res.data.success) {
        showToast(`Comptabilisation réussie pour ${res.data.successCount} règlements !`, 'success');
        if (res.data.errorCount > 0) {
          console.error(res.data.errors);
          showToast(`${res.data.errorCount} erreurs rencontrées`, 'warning');
        }
        setApercus([]);
      }
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la comptabilisation', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const caisseOptions = useMemo(() => {
    return Object.entries(caissesMap).map(([id, obj]: [string, any]) => ({ value: id, label: obj ? `${obj.code} - ${obj.intitule}` : id }));
  }, [caissesMap]);

  return (
    <div style={{display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%'}}>
      {/* Top bar Filters */}
      <div className="card animate-fade-in" style={{padding: '1rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', position: 'relative', zIndex: 50}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
          <Filter size={18} style={{color: 'var(--text-tertiary)'}} />
          <span style={{fontWeight: 600, fontSize: '0.8125rem'}}>Filtres de simulation :</span>
        </div>
        
        <CheckboxDropdown
          options={caisseOptions}
          selectedValues={caisses}
          onChange={setCaisses}
          placeholder="Toutes les caisses"
        />
        
        <CheckboxDropdown
          options={dynamicModes}
          selectedValues={modes}
          onChange={setModes}
          placeholder="Tous les modes"
        />
        
        <input type="date" className="form-input" value={dateDebut} onChange={e => setDateDebut(e.target.value)} style={{width: '120px'}} />
        <span style={{color: 'var(--text-tertiary)', fontSize: '0.8125rem'}}>à</span>
        <input type="date" className="form-input" value={dateFin} onChange={e => setDateFin(e.target.value)} style={{width: '120px'}} />

        <div style={{display: 'flex', alignItems: 'center', gap: '0.375rem'}}>
          <span style={{fontSize: '0.8125rem', color: 'var(--text-secondary)'}}>Rapproché :</span>
          <select className="form-input" value={rapproche} onChange={e => setRapproche(e.target.value as 'all' | 'oui' | 'non')} style={{width: '90px', fontSize: '0.8125rem'}}>
            <option value="all">Tous</option>
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        </div>

        <div style={{display: 'flex', gap: '0.5rem', marginLeft: 'auto'}}>
          <button onClick={handleSimuler} className="btn btn-primary" disabled={loading} style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Générer l'Aperçu
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="card table-container animate-fade-in" style={{flex: 1, minHeight: 0, paddingBottom: apercus.length > 0 ? '5rem' : '0'}}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{width: '40px'}}></th>
              <th>Date</th>
              <th>Client</th>
              <th>Pièce</th>
              <th style={{textAlign: 'right'}}>Montant Règl.</th>
              <th style={{textAlign: 'center'}}>Statut Balance</th>
            </tr>
          </thead>
          <tbody>
            {apercus.map(ap => {
              const rowDebit = ap.ecritures.reduce((s, e) => s + e.montantDebit, 0);
              const rowCredit = ap.ecritures.reduce((s, e) => s + e.montantCredit, 0);
              const isRowBalanced = Math.abs(rowDebit - rowCredit) < 0.01;
              const hasRowError = ap.ecritures.some(e => !e.compteGeneral);

              return (
                <React.Fragment key={ap.id}>
                  <tr style={{cursor: 'pointer', backgroundColor: hasRowError ? '#fee2e2' : 'transparent'}} onClick={() => toggleRow(ap.id)}>
                    <td style={{textAlign: 'center', color: 'var(--text-tertiary)'}}>
                      {expandedRows[ap.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    </td>
                    <td>{new Date(ap.date).toLocaleDateString('fr-FR')}</td>
                    <td style={{fontWeight: 500}}>{ap.client}</td>
                    <td>{ap.piece}</td>
                    <td style={{textAlign: 'right', fontWeight: 600}}>{formatMoney(ap.montant)}</td>
                    <td style={{textAlign: 'center'}}>
                      {hasRowError ? (
                        <span style={{color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600}}><AlertCircle size={14}/> Erreur Compte</span>
                      ) : isRowBalanced ? (
                        <span style={{color: 'var(--success-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600}}><CheckCircle2 size={14}/> Équilibré</span>
                      ) : (
                        <span style={{color: '#ea580c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600}}><AlertCircle size={14}/> Déséquilibré</span>
                      )}
                    </td>
                  </tr>
                  
                  {expandedRows[ap.id] && (
                    <tr style={{backgroundColor: 'var(--bg-secondary)'}}>
                      <td></td>
                      <td colSpan={5} style={{padding: '1rem'}}>
                        <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem'}}>
                          <thead>
                            <tr style={{borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)'}}>
                              <th style={{padding: '0.5rem', textAlign: 'left'}}>Journal</th>
                              <th style={{padding: '0.5rem', textAlign: 'left'}}>Compte</th>
                              <th style={{padding: '0.5rem', textAlign: 'left'}}>Contrepartie</th>
                              <th style={{padding: '0.5rem', textAlign: 'left'}}>Tiers</th>
                              <th style={{padding: '0.5rem', textAlign: 'left'}}>Libellé</th>
                              <th style={{padding: '0.5rem', textAlign: 'center'}}>Sens</th>
                              <th style={{padding: '0.5rem', textAlign: 'right'}}>Débit</th>
                              <th style={{padding: '0.5rem', textAlign: 'right'}}>Crédit</th>
                              <th style={{padding: '0.5rem', textAlign: 'center'}}>Échéance</th>
                              <th style={{padding: '0.5rem', textAlign: 'left'}} title="Indicatif — recalculé à la comptabilisation réelle">Pièce*</th>
                            </tr>
                          </thead>
                          <tbody>
                            {ap.ecritures.map((e, idx) => (
                              <tr key={idx} style={{borderBottom: '1px solid rgba(0,0,0,0.05)'}}>
                                <td style={{padding: '0.5rem'}}>{e.codeJournal}</td>
                                <td style={{padding: '0.5rem', fontWeight: 600, color: !e.compteGeneral ? '#dc2626' : 'inherit'}}>{e.compteGeneral || 'MANQUANT'}</td>
                                <td style={{padding: '0.5rem'}}>{e.contrePartieCompteG}</td>
                                <td style={{padding: '0.5rem'}}>{e.tiersNumero}</td>
                                <td style={{padding: '0.5rem'}}>{e.libelle}</td>
                                <td style={{padding: '0.5rem', textAlign: 'center'}}>{e.sens === 1 ? 'C' : 'D'}</td>
                                <td style={{padding: '0.5rem', textAlign: 'right'}}>{e.montantDebit ? formatMoney(e.montantDebit) : ''}</td>
                                <td style={{padding: '0.5rem', textAlign: 'right'}}>{e.montantCredit ? formatMoney(e.montantCredit) : ''}</td>
                                <td style={{padding: '0.5rem', textAlign: 'center'}}>{e.echeance ? new Date(e.echeance).toLocaleDateString('fr-FR') : ''}</td>
                                <td style={{padding: '0.5rem', color: 'var(--text-tertiary)'}}>{e.numeroPiece}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {apercus.length === 0 && !loading && (
              <tr>
                <td colSpan={6} style={{textAlign: 'center', padding: '3rem', color: 'var(--text-tertiary)'}}>
                  Aucun aperçu généré. Modifiez les filtres et cliquez sur "Générer l'Aperçu".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Validation Bottom Bar */}
      {apercus.length > 0 && (
        <div className="glass-panel" style={{
          position: 'absolute', bottom: '1rem', left: '2rem', right: '2rem',
          padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderRadius: '12px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
          border: '1px solid rgba(255,255,255,0.4)',
          background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
          animation: 'slide-up 0.3s ease-out'
        }}>
          <div>
            <h3 style={{margin: 0, fontSize: '1rem', color: 'var(--text-primary)', fontWeight: 600}}>Validation Globale</h3>
            <div style={{fontSize: '0.875rem', color: 'var(--text-secondary)', display: 'flex', gap: '1rem', marginTop: '0.25rem'}}>
               <span>Sélection : <strong>{apercus.length} règlements</strong></span>
               <span>Total Débit : <strong style={{color: isBalanced ? 'inherit' : '#ea580c'}}>{formatMoney(totalDebit)}</strong></span>
               <span>Total Crédit : <strong style={{color: isBalanced ? 'inherit' : '#ea580c'}}>{formatMoney(totalCredit)}</strong></span>
               {!isBalanced && <span style={{color: '#ea580c', fontWeight: 600}}>(Déséquilibre !)</span>}
               {hasErrors && <span style={{color: '#dc2626', fontWeight: 600}}>(Erreurs de compte détectées !)</span>}
            </div>
          </div>
          <button 
            className="btn btn-primary"
            onClick={handleValider}
            disabled={isSubmitting || hasErrors}
            style={{
              padding: '0.75rem 1.5rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem',
              backgroundColor: hasErrors ? '#9ca3af' : 'var(--success-color)',
              border: 'none', cursor: hasErrors ? 'not-allowed' : 'pointer'
            }}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <CheckSquare />}
            {isSubmitting ? 'Comptabilisation...' : 'Valider & Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
