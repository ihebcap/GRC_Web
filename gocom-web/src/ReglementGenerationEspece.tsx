// @ts-nocheck
import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from './api';
import { Loader2, CheckCircle2, XCircle, Banknote, RefreshCw, Settings, X } from 'lucide-react';
import { formatMoney } from './utils';
import { ExcelFilter } from './ExcelFilter';
import './ReglementGenerationEspece.css';

// TASK-059 & TASK-062 — Écran de génération interactive de règlements client espèce, avec affectation
// intégrale sur des factures déjà connues de l'échéancier trésorerie (RT_ECHEANCE).
// Contrat back : GRC.API/Controllers/ReglementController.cs (factures-a-regler, generer-espece).
// Multi-clients : l'écran affiche la liste complète des factures ouvertes (Solde > 0) de la société
// avec filtres Excel par colonne et choix des colonnes affichées (persistance localStorage).

interface EcheanceARegler {
  echeanceNo: number;
  clientCode: string;
  clientIntitule: string;
  factureNumero: string;
  dateFacture: string;
  dateEcheance: string;
  commentaire: string;
  montant: number;
  solde: number;
  info1: string;
  info2: string;
  info3: string;
  info4: string;
  representant: string;
}

interface ReglementResultatItem {
  echeanceNo: number;
  factureNumero: string;
  success: boolean;
  reglementNo?: number;
  reglementNumero?: string;
  erreur?: string;
}

interface ColumnDef {
  key: string;
  label: string;
  filterType: 'list' | 'text' | 'number' | 'date';
  isAmount?: boolean;
  defaultVisible: boolean;
}

const ALL_COLUMNS: ColumnDef[] = [
  { key: 'clientCode', label: 'Code Client', filterType: 'list', defaultVisible: true },
  { key: 'clientIntitule', label: 'Intitulé Client', filterType: 'list', defaultVisible: true },
  { key: 'factureNumero', label: 'N° Facture', filterType: 'list', defaultVisible: true },
  { key: 'dateFacture', label: 'Date facture', filterType: 'list', defaultVisible: true },
  { key: 'dateEcheance', label: 'Date échéance', filterType: 'list', defaultVisible: true },
  { key: 'montant', label: 'Montant', filterType: 'list', isAmount: true, defaultVisible: true },
  { key: 'solde', label: 'Solde', filterType: 'list', isAmount: true, defaultVisible: true },
  { key: 'representant', label: 'Représentant', filterType: 'list', defaultVisible: true },
  { key: 'commentaire', label: 'Commentaire', filterType: 'list', defaultVisible: false },
  { key: 'info1', label: 'Info 1', filterType: 'list', defaultVisible: false },
  { key: 'info2', label: 'Info 2', filterType: 'list', defaultVisible: false },
  { key: 'info3', label: 'Info 3', filterType: 'list', defaultVisible: false },
  { key: 'info4', label: 'Info 4', filterType: 'list', defaultVisible: false },
];

const LOCALSTORAGE_KEY = 'gocom_reglement_espece_columns';

interface Props {
  user: any;
  caissesMap: Record<number, any>;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

export default function ReglementGenerationEspece({ user, caissesMap, showToast }: Props) {
  const [factures, setFactures] = useState<EcheanceARegler[]>([]);
  const [loadingFactures, setLoadingFactures] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [filters, setFilters] = useState<Record<string, { type: 'list' | 'text' | 'number' | 'date', value: any }>>({});

  const [caisseCode, setCaisseCode] = useState('');
  const [generating, setGenerating] = useState(false);
  const [resultats, setResultats] = useState<ReglementResultatItem[] | null>(null);

  // Gestion du choix de colonnes par utilisateur (localStorage)
  const [showColModal, setShowColModal] = useState(false);
  const [selectedColKeys, setSelectedColKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_KEY);
      if (saved) {
        let parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Migration rétrocompatible : si l'ancien localStorage contenait 'client', le remplacer par clientCode et clientIntitule
          if (parsed.includes('client')) {
            parsed = parsed.filter(k => k !== 'client');
            if (!parsed.includes('clientCode')) parsed.push('clientCode');
            if (!parsed.includes('clientIntitule')) parsed.push('clientIntitule');
          }
          return parsed;
        }
      }
    } catch (e) {
      console.error('Erreur chargement colonnes sauvegardées', e);
    }
    return ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
  });

  const toggleColumn = (key: string) => {
    setSelectedColKeys(prev => {
      let next: string[];
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev; // Au moins 1 colonne
        next = prev.filter(k => k !== key);
      } else {
        next = [...prev, key];
      }
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const activeColumns = useMemo(() => {
    return ALL_COLUMNS.filter(c => selectedColKeys.includes(c.key));
  }, [selectedColKeys]);

  // Restriction UX aux caisses affectées au profil de l'utilisateur — même patron que App.tsx.
  const caissesDisponibles = useMemo(() => {
    return Object.values(caissesMap || {}).filter(
      (c: any) => user?.isAdmin || (user?.caisses || []).includes(c.id) || (user?.caisses || []).length === 0
    );
  }, [caissesMap, user]);

  const chargerFactures = async () => {
    setLoadingFactures(true);
    setResultats(null);
    setChecked({});
    try {
      const res = await axios.get(`${API_BASE}/reglements/factures-a-regler`);
      setFactures(res.data || []);
    } catch (err) {
      console.error('Erreur chargement factures à régler', err);
      showToast("Erreur lors du chargement des factures à régler.", 'error');
      setFactures([]);
    } finally {
      setLoadingFactures(false);
    }
  };

  useEffect(() => {
    chargerFactures();
  }, []);

  const updateFilter = (key: string, type: 'list' | 'text' | 'number' | 'date', value: any) => {
    setFilters(prev => {
      const next = { ...prev };
      if (!value || (Array.isArray(value) && value.length === 0)) delete next[key];
      else next[key] = { type, value };
      return next;
    });
  };

  const getItemValue = (f: EcheanceARegler, key: string): string => {
    if (key === 'dateFacture') {
      return f.dateFacture ? String(f.dateFacture).substring(0, 10) : '';
    }
    if (key === 'dateEcheance') {
      return f.dateEcheance ? String(f.dateEcheance).substring(0, 10) : '';
    }
    return String((f as any)[key] ?? '');
  };

  const filteredFactures = useMemo(() => {
    return factures.filter(f => {
      for (const [key, filter] of Object.entries(filters)) {
        const val = getItemValue(f, key);

        if (filter.type === 'list' && filter.value && filter.value.length > 0) {
          if (!filter.value.includes(val)) return false;
        } else if (filter.type === 'text' && filter.value) {
          if (!val.toLowerCase().includes(String(filter.value).trim().toLowerCase())) return false;
        } else if (filter.type === 'number' && filter.value) {
          const [min, max] = filter.value.split('~');
          if ((min || max) && (val === '' || isNaN(Number(val)))) return false;
          const num = Number(val);
          if (min && num < Number(min)) return false;
          if (max && num > Number(max)) return false;
        } else if (filter.type === 'date' && filter.value) {
          const [min, max] = filter.value.split('~');
          if ((min || max) && !val) return false;
          if (min && val < min) return false;
          if (max && val > max) return false;
        }
      }
      return true;
    });
  }, [factures, filters]);

  const getOptions = (key: string) => {
    const unique = Array.from(new Set(factures.map(f => getItemValue(f, key))));
    return unique
      .map(u => {
        if (!u) return { label: '(Vide)', value: u };

        if (key === 'dateFacture' || key === 'dateEcheance') {
          const d = new Date(u);
          const label = !isNaN(d.getTime()) ? d.toLocaleDateString('fr-FR') : u;
          return { label, value: u };
        }

        if (key === 'montant' || key === 'solde') {
          const num = Number(u);
          const label = !isNaN(num) ? formatMoney(num) : u;
          return { label, value: u };
        }

        return { label: u, value: u };
      })
      .sort((a, b) => {
        if (a.value === '') return -1;
        if (b.value === '') return 1;
        if (key === 'montant' || key === 'solde') {
          return Number(a.value) - Number(b.value);
        }
        if (key === 'dateFacture' || key === 'dateEcheance') {
          return a.value.localeCompare(b.value);
        }
        return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      });
  };

  const toggleFacture = (echeanceNo: number) => {
    setChecked(prev => {
      const next = { ...prev };
      if (next[echeanceNo]) delete next[echeanceNo];
      else next[echeanceNo] = true;
      return next;
    });
  };

  const allFilteredChecked = useMemo(() => {
    if (filteredFactures.length === 0) return false;
    return filteredFactures.every(f => !!checked[f.echeanceNo]);
  }, [filteredFactures, checked]);

  const toggleSelectAllFiltered = () => {
    setChecked(prev => {
      const next = { ...prev };
      if (allFilteredChecked) {
        filteredFactures.forEach(f => { delete next[f.echeanceNo]; });
      } else {
        filteredFactures.forEach(f => { next[f.echeanceNo] = true; });
      }
      return next;
    });
  };

  const echeanceNosCoches = Object.keys(checked).map(Number);
  const totalCoche = factures
    .filter(f => checked[f.echeanceNo])
    .reduce((acc, f) => acc + Number(f.solde), 0);

  const peutGenerer = echeanceNosCoches.length > 0 && !!caisseCode && !generating;

  const handleGenerer = async () => {
    if (echeanceNosCoches.length === 0 || !caisseCode) return;
    setGenerating(true);
    setResultats(null);
    try {
      const res = await axios.post(`${API_BASE}/reglements/generer-espece`, {
        caisseCode,
        echeanceNos: echeanceNosCoches
      });

      const reglementsCreees: ReglementResultatItem[] = (res.data?.reglementsCreees || []).map((r: any) => ({ ...r, success: true }));
      const erreurs: ReglementResultatItem[] = (res.data?.erreurs || []).map((r: any) => ({ ...r, success: false }));
      const combined = [...reglementsCreees, ...erreurs].sort((a, b) => a.echeanceNo - b.echeanceNo);
      setResultats(combined);

      if (res.data?.success) {
        showToast(`${reglementsCreees.length} règlement(s) généré(s) avec succès (1 par facture).`, 'success');
      } else {
        showToast(`${reglementsCreees.length} règlement(s) créé(s), ${erreurs.length} en échec — voir le détail par facture ci-dessous.`, 'warning');
      }

      chargerFactures();
    } catch (err: any) {
      if (err.response?.status === 403) {
        showToast("Vous n'êtes pas autorisé à utiliser cette caisse.", 'error');
      } else if (err.response?.status === 400) {
        const msg = typeof err.response.data === 'string' ? err.response.data : "Requête invalide.";
        showToast(msg, 'error');
      } else {
        console.error('Erreur génération règlements espèce', err);
        const msg = err.response?.data?.title || (typeof err.response?.data === 'string' ? err.response.data : null);
        showToast(msg || "Erreur lors de la génération des règlements.", 'error');
      }
    } finally {
      setGenerating(false);
    }
  };

  const renderCellContent = (colKey: string, f: EcheanceARegler) => {
    switch (colKey) {
      case 'clientCode':
        return <strong>{f.clientCode}</strong>;
      case 'clientIntitule':
        return f.clientIntitule;
      case 'factureNumero':
        return f.factureNumero;
      case 'dateFacture':
        return f.dateFacture ? new Date(f.dateFacture).toLocaleDateString('fr-FR') : '';
      case 'dateEcheance':
        return f.dateEcheance ? new Date(f.dateEcheance).toLocaleDateString('fr-FR') : '';
      case 'montant':
        return formatMoney(f.montant);
      case 'solde':
        return formatMoney(f.solde);
      case 'representant':
        return f.representant || '—';
      case 'commentaire':
        return f.commentaire || '—';
      case 'info1':
        return f.info1 || '—';
      case 'info2':
        return f.info2 || '—';
      case 'info3':
        return f.info3 || '—';
      case 'info4':
        return f.info4 || '—';
      default:
        return String((f as any)[colKey] ?? '');
    }
  };

  return (
    <div className="regesp-container animate-fade-in">
      <div className="card table-container regesp-factures-container">
        <div className="table-header-wrapper" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <span className="table-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Banknote size={20} style={{ color: 'var(--accent-primary)' }} />
              Factures ouvertes ({filteredFactures.length} / {factures.length})
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '0.5rem', borderLeft: '1px solid var(--border-color)' }}>
              <select
                className="form-input"
                style={{ width: '200px', fontSize: '0.85rem', padding: '0.35rem 0.6rem' }}
                value={caisseCode}
                onChange={e => setCaisseCode(e.target.value)}
              >
                <option value="">Choisir une caisse…</option>
                {caissesDisponibles.map((c: any) => (
                  <option key={c.id} value={c.code}>{c.code} - {c.intitule}</option>
                ))}
              </select>

              <button
                className="btn btn-primary"
                style={{ padding: '0.4rem 1rem', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                disabled={!peutGenerer}
                onClick={handleGenerer}
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Banknote size={15} />}
                {generating ? 'Génération…' : `Générer (${echeanceNosCoches.length})`}
              </button>
            </div>

            {echeanceNosCoches.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.825rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', padding: '0.3rem 0.75rem', borderRadius: '6px' }}>
                <span>Cochées : <strong style={{ color: 'var(--text-primary)' }}>{echeanceNosCoches.length}</strong></span>
                <span>Total : <strong style={{ color: 'var(--accent-primary)' }}>{formatMoney(totalCoche)}</strong></span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="btn"
              style={{ backgroundColor: 'white', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
              onClick={() => setShowColModal(!showColModal)}
              title="Personnaliser l'affichage des colonnes"
            >
              <Settings size={14} /> Colonnes
            </button>
            <button
              className="btn"
              style={{ backgroundColor: 'white', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
              onClick={chargerFactures}
              disabled={loadingFactures}
            >
              <RefreshCw size={14} className={loadingFactures ? 'animate-spin' : ''} /> Rafraîchir
            </button>
          </div>
        </div>

        {/* Modal / Popover de choix de colonnes */}
        {showColModal && (
          <div style={{
            position: 'absolute', right: '1.5rem', top: '3.5rem', zIndex: 100,
            backgroundColor: 'white', border: '1px solid var(--border-color)',
            borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: '1rem',
            width: '280px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>Colonnes affichées</strong>
              <button style={{ border: 'none', background: 'none', cursor: 'pointer' }} onClick={() => setShowColModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '250px', overflowY: 'auto' }}>
              {ALL_COLUMNS.map(col => (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedColKeys.includes(col.key)}
                    onChange={() => toggleColumn(col.key)}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {loadingFactures ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>
            <Loader2 className="animate-spin" size={28} style={{ color: 'var(--accent-primary)' }} />
          </div>
        ) : factures.length === 0 ? (
          <div className="regesp-empty" style={{ padding: '2rem' }}>Aucune facture ouverte.</div>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={allFilteredChecked}
                      onChange={toggleSelectAllFiltered}
                      title="Tout sélectionner / désélectionner (lignes filtrées)"
                    />
                  </th>
                  {activeColumns.map(col => (
                    <th key={col.key} style={col.isAmount ? { textAlign: 'right' } : {}}>
                      {col.label}
                      <ExcelFilter
                        filterType={col.filterType}
                        options={col.filterType === 'list' ? getOptions(col.key) : undefined}
                        selectedValues={col.filterType === 'list' ? (filters[col.key]?.value || []) : undefined}
                        textValue={col.filterType !== 'list' ? (filters[col.key]?.value || '') : undefined}
                        onChange={v => updateFilter(col.key, col.filterType, v)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredFactures.length === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                      Aucune facture ne correspond aux filtres appliqués.
                    </td>
                  </tr>
                ) : (
                  filteredFactures.map(f => (
                    <tr key={f.echeanceNo} onClick={() => toggleFacture(f.echeanceNo)} style={{ cursor: 'pointer' }}>
                      <td onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!checked[f.echeanceNo]}
                          onChange={() => toggleFacture(f.echeanceNo)}
                        />
                      </td>
                      {activeColumns.map(col => (
                        <td key={col.key} style={col.isAmount ? { textAlign: 'right', fontWeight: col.key === 'solde' ? 600 : 'normal' } : {}}>
                          {renderCellContent(col.key, f)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {resultats && (
        <div className="card regesp-resultats-container">
          <div className="table-header-wrapper">
            <span className="table-title">Résultat — 1 règlement par facture</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>N° Facture</th>
                <th>Statut</th>
                <th>N° Règlement</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map(r => (
                <tr key={r.echeanceNo} className={r.success ? 'regesp-row-ok' : 'regesp-row-ko'}>
                  <td>{r.factureNumero}</td>
                  <td>
                    {r.success ? (
                      <span className="regesp-badge regesp-badge-ok"><CheckCircle2 size={13} /> Créé</span>
                    ) : (
                      <span className="regesp-badge regesp-badge-ko"><XCircle size={13} /> Échec</span>
                    )}
                  </td>
                  <td>{r.success ? r.reglementNumero : '—'}</td>
                  <td>{r.success ? '' : r.erreur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
