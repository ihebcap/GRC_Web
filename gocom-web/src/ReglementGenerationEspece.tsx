// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_BASE } from './api';
import { Loader2, CheckCircle2, XCircle, Banknote, RefreshCw, Settings, X } from 'lucide-react';
import { formatMoney } from './utils';
import { ExcelFilter } from './ExcelFilter';
import './ReglementGenerationEspece.css';

// TASK-059 & TASK-062 — Écran de génération interactive de règlements client espèce, avec affectation
// intégrale sur des factures déjà connues de l'échéancier trésorerie (RT_ECHEANCE).
// TASK-107 — Optimisation : tri multi-colonnes typé (défaut Date facture asc), pagination client,
// mémoïsation (getOptions, lignes de table), sélection visible/sûre (compteur dont M hors filtre, confirmation).
// TASK-108 — Persistance du tableau Résultat et mise à jour locale post-génération.

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
  { key: 'dateFacture', label: 'Date facture', filterType: 'date', defaultVisible: true },
  { key: 'dateEcheance', label: 'Date échéance', filterType: 'date', defaultVisible: true },
  { key: 'montant', label: 'Montant', filterType: 'number', isAmount: true, defaultVisible: true },
  { key: 'solde', label: 'Solde', filterType: 'number', isAmount: true, defaultVisible: true },
  { key: 'representant', label: 'Représentant', filterType: 'list', defaultVisible: true },
  { key: 'commentaire', label: 'Commentaire', filterType: 'list', defaultVisible: false },
  { key: 'info1', label: 'Info 1', filterType: 'list', defaultVisible: false },
  { key: 'info2', label: 'Info 2', filterType: 'list', defaultVisible: false },
  { key: 'info3', label: 'Info 3', filterType: 'list', defaultVisible: false },
  { key: 'info4', label: 'Info 4', filterType: 'list', defaultVisible: false },
];

const LOCALSTORAGE_KEY = 'gocom_reglement_espece_columns';
const LOCALSTORAGE_PAGE_SIZE = 'gocom_reglement_espece_pagesize';

function getItemValue(f: EcheanceARegler, key: string): string {
  if (key === 'dateFacture') {
    return f.dateFacture ? String(f.dateFacture).substring(0, 10) : '';
  }
  if (key === 'dateEcheance') {
    return f.dateEcheance ? String(f.dateEcheance).substring(0, 10) : '';
  }
  return String((f as any)[key] ?? '');
}

function renderCellContent(colKey: string, f: EcheanceARegler) {
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
}

// Composant de ligne mémoïsé : évite de recalculer les 100 lignes lors d'un clic de case
interface FactureRowProps {
  facture: EcheanceARegler;
  isChecked: boolean;
  activeColumns: ColumnDef[];
  onToggle: (echeanceNo: number) => void;
}

const FactureRow = React.memo(function FactureRow({
  facture,
  isChecked,
  activeColumns,
  onToggle
}: FactureRowProps) {
  return (
    <tr onClick={() => onToggle(facture.echeanceNo)} style={{ cursor: 'pointer' }}>
      <td onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggle(facture.echeanceNo)}
        />
      </td>
      {activeColumns.map(col => (
        <td
          key={col.key}
          style={col.isAmount ? { textAlign: 'right', fontWeight: col.key === 'solde' ? 600 : 'normal' } : {}}
        >
          {renderCellContent(col.key, facture)}
        </td>
      ))}
    </tr>
  );
});

interface Props {
  user: any;
  caissesMap: Record<number, any>;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning') => void;
}

export default function ReglementGenerationEspece({ user, caissesMap, showToast }: Props) {
  const [factures, setFactures] = useState<EcheanceARegler[]>([]);
  const [loadingFactures, setLoadingFactures] = useState(false);
  const loadingFacturesRef = useRef(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [filters, setFilters] = useState<Record<string, { type: 'list' | 'text' | 'number' | 'date', value: any }>>({});

  // TASK-107 : Tri cliquable par colonne, par défaut Date facture ascendante (du plus ancien au plus récent)
  const [sortCol, setSortCol] = useState<string>('dateFacture');
  const [sortDesc, setSortDesc] = useState<boolean>(false);

  // TASK-107 : Pagination client
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(LOCALSTORAGE_PAGE_SIZE);
      if (saved) {
        const parsed = Number(saved);
        if ([50, 100, 200, 500].includes(parsed)) return parsed;
      }
    } catch {}
    return 100;
  });
  const [page, setPage] = useState<number>(1);

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
        if (prev.length <= 1) return prev;
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

  // Restriction UX aux caisses affectées au profil de l'utilisateur
  const caissesDisponibles = useMemo(() => {
    return Object.values(caissesMap || {}).filter(
      (c: any) => user?.isAdmin || (user?.caisses || []).includes(c.id) || (user?.caisses || []).length === 0
    );
  }, [caissesMap, user]);

  const chargerFactures = async () => {
    if (loadingFacturesRef.current) return;
    loadingFacturesRef.current = true;
    setLoadingFactures(true);
    setChecked({});
    try {
      const res = await axios.get(`${API_BASE}/reglements/factures-a-regler`);
      setFactures(res.data || []);
    } catch (err) {
      console.error('Erreur chargement factures à régler', err);
      showToast("Erreur lors du chargement des factures à régler.", 'error');
      setFactures([]);
    } finally {
      loadingFacturesRef.current = false;
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

  // Remise à la première page lors d'un changement de filtre ou de tri
  useEffect(() => {
    setPage(1);
  }, [filters, sortCol, sortDesc]);

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
    try {
      localStorage.setItem(LOCALSTORAGE_PAGE_SIZE, String(newSize));
    } catch {}
  };

  const handleSort = (colKey: string) => {
    if (sortCol === colKey) {
      setSortDesc(prev => !prev);
    } else {
      setSortCol(colKey);
      setSortDesc(false);
    }
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

  const collator = useMemo(() => new Intl.Collator('fr-FR', { numeric: true, sensitivity: 'base' }), []);

  // TASK-107 : Tri global préalable sur filteredFactures avant découpage en pages
  const sortedFactures = useMemo(() => {
    if (filteredFactures.length === 0) return [];
    const list = [...filteredFactures];
    const colDef = ALL_COLUMNS.find(c => c.key === sortCol);
    const isNum = colDef?.isAmount || colDef?.filterType === 'number';
    const isDate = colDef?.filterType === 'date';

    list.sort((a, b) => {
      let cmp = 0;
      if (isNum) {
        const valA = Number((a as any)[sortCol]) || 0;
        const valB = Number((b as any)[sortCol]) || 0;
        cmp = valA - valB;
      } else if (isDate) {
        const valA = (a as any)[sortCol] || '';
        const valB = (b as any)[sortCol] || '';
        cmp = valA.localeCompare(valB);
      } else {
        const valA = String((a as any)[sortCol] || '');
        const valB = String((b as any)[sortCol] || '');
        cmp = collator.compare(valA, valB);
      }
      if (cmp !== 0) return sortDesc ? -cmp : cmp;
      return a.echeanceNo - b.echeanceNo;
    });
    return list;
  }, [filteredFactures, sortCol, sortDesc, collator]);

  // TASK-107 : Découpage paginé
  const totalFiltered = sortedFactures.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);

  const paginatedFactures = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedFactures.slice(start, start + pageSize);
  }, [sortedFactures, currentPage, pageSize]);

  // TASK-107 : Mémoïsation des options de filtres en une passe unique par colonne
  const optionsByCol = useMemo(() => {
    const map: Record<string, { label: string, value: string }[]> = {};
    for (const col of activeColumns) {
      if (col.filterType !== 'list') continue;
      const key = col.key;
      const uniqueVals = new Set<string>();
      for (let i = 0; i < factures.length; i++) {
        uniqueVals.add(getItemValue(factures[i], key));
      }
      const opts = Array.from(uniqueVals).map(u => {
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
      });
      opts.sort((a, b) => {
        if (a.value === '') return -1;
        if (b.value === '') return 1;
        if (key === 'montant' || key === 'solde') {
          return Number(a.value) - Number(b.value);
        }
        return collator.compare(a.label, b.label);
      });
      map[key] = opts;
    }
    return map;
  }, [factures, activeColumns, collator]);

  const toggleFacture = useCallback((echeanceNo: number) => {
    setChecked(prev => {
      const next = { ...prev };
      if (next[echeanceNo]) delete next[echeanceNo];
      else next[echeanceNo] = true;
      return next;
    });
  }, []);

  // Map d'accès direct pour calcul O(1) par élément coché sans balayer les 30 000 factures
  const facturesByNo = useMemo(() => {
    const map = new Map<number, EcheanceARegler>();
    for (let i = 0; i < factures.length; i++) {
      map.set(factures[i].echeanceNo, factures[i]);
    }
    return map;
  }, [factures]);

  const { echeanceNosCoches, totalCoche } = useMemo(() => {
    const keys = Object.keys(checked);
    const nos: number[] = [];
    let sum = 0;
    for (let i = 0; i < keys.length; i++) {
      const no = Number(keys[i]);
      if (checked[no]) {
        nos.push(no);
        const f = facturesByNo.get(no);
        if (f) sum += Number(f.solde) || 0;
      }
    }
    return { echeanceNosCoches: nos, totalCoche: sum };
  }, [checked, facturesByNo]);

  // TASK-107 Étape 3 : Compteur de factures cochées visibles vs masquées par les filtres
  const nbCochesFiltrees = useMemo(() => {
    if (echeanceNosCoches.length === 0) return 0;
    let count = 0;
    for (let i = 0; i < filteredFactures.length; i++) {
      if (checked[filteredFactures[i].echeanceNo]) count++;
    }
    return count;
  }, [filteredFactures, checked, echeanceNosCoches.length]);

  const nbCochesHorsFiltre = echeanceNosCoches.length - nbCochesFiltrees;

  // Tout cocher / décocher global sur l'ensemble des lignes filtrées (toutes pages confondues)
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

  const peutGenerer = echeanceNosCoches.length > 0 && !!caisseCode && !generating;

  const handleGenerer = async () => {
    if (echeanceNosCoches.length === 0 || !caisseCode) return;

    // TASK-107 Étape 3 : Confirmation explicite avant génération rappelant total, montant et avertissement si masquées
    const confirmMsg = nbCochesHorsFiltre > 0
      ? `Confirmez-vous la génération de ${echeanceNosCoches.length} règlement(s) espèce pour un montant total de ${formatMoney(totalCoche)} sur la caisse ${caisseCode} ?\n\nATTENTION : ${nbCochesHorsFiltre} facture(s) cochée(s) sont actuellement masquées par les filtres appliqués.`
      : `Confirmez-vous la génération de ${echeanceNosCoches.length} règlement(s) espèce pour un montant total de ${formatMoney(totalCoche)} sur la caisse ${caisseCode} ?`;

    if (!window.confirm(confirmMsg)) return;

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

      // TASK-108 : Mise à jour locale sans refetch complet (10,7 Mo évités).
      // Les factures réglées avec succès sont retirées de la liste et décochées.
      // Les factures en échec restent listées et cochées pour permettre correction ou analyse.
      const successEcheanceNos = new Set(reglementsCreees.map(r => Number(r.echeanceNo)));
      if (successEcheanceNos.size > 0) {
        setFactures(prev => prev.filter(f => !successEcheanceNos.has(Number(f.echeanceNo))));
        setChecked(prev => {
          const next = { ...prev };
          for (const no of successEcheanceNos) {
            delete next[no];
          }
          return next;
        });
      }
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.825rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)', padding: '0.3rem 0.75rem', borderRadius: '6px' }}>
                <span>
                  Cochées : <strong style={{ color: 'var(--text-primary)' }}>{echeanceNosCoches.length}</strong>
                  {nbCochesHorsFiltre > 0 && (
                    <span style={{ color: '#d97706', marginLeft: '0.35rem', fontWeight: 500 }} title={`${nbCochesHorsFiltre} facture(s) sélectionnée(s) ne correspondent pas aux filtres actuels`}>
                      (dont {nbCochesHorsFiltre} hors filtre)
                    </span>
                  )}
                </span>
                <span>Total : <strong style={{ color: 'var(--accent-primary)' }}>{formatMoney(totalCoche)}</strong></span>
                {nbCochesHorsFiltre > 0 && (
                  <button
                    className="btn"
                    style={{ padding: '0.15rem 0.4rem', fontSize: '0.75rem', backgroundColor: 'transparent', border: '1px solid #d97706', color: '#d97706', cursor: 'pointer' }}
                    onClick={() => {
                      setChecked(prev => {
                        const next: Record<number, boolean> = {};
                        for (let i = 0; i < filteredFactures.length; i++) {
                          const no = filteredFactures[i].echeanceNo;
                          if (prev[no]) next[no] = true;
                        }
                        return next;
                      });
                    }}
                    title="Décocher les factures masquées par les filtres"
                  >
                    Décocher hors filtre
                  </button>
                )}
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
                      title="Tout sélectionner / désélectionner (lignes filtrées, multi-pages)"
                    />
                  </th>
                  {activeColumns.map(col => (
                    <th
                      key={col.key}
                      style={{ cursor: 'pointer', userSelect: 'none', ...(col.isAmount ? { textAlign: 'right' } : {}) }}
                      onClick={() => handleSort(col.key)}
                      title={`Trier par ${col.label}`}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: col.isAmount ? 'flex-end' : 'flex-start', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                        <span>
                          {col.label} {sortCol === col.key ? (sortDesc ? '▼' : '▲') : ''}
                        </span>
                        <div onClick={e => e.stopPropagation()}>
                          <ExcelFilter
                            filterType={col.filterType}
                            options={col.filterType === 'list' ? optionsByCol[col.key] : undefined}
                            selectedValues={col.filterType === 'list' ? (filters[col.key]?.value || []) : undefined}
                            textValue={col.filterType !== 'list' ? (filters[col.key]?.value || '') : undefined}
                            onChange={v => updateFilter(col.key, col.filterType, v)}
                          />
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {totalFiltered === 0 ? (
                  <tr>
                    <td colSpan={activeColumns.length + 1} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)' }}>
                      Aucune facture ne correspond aux filtres appliqués.
                    </td>
                  </tr>
                ) : (
                  paginatedFactures.map(f => (
                    <FactureRow
                      key={f.echeanceNo}
                      facture={f}
                      isChecked={!!checked[f.echeanceNo]}
                      activeColumns={activeColumns}
                      onToggle={toggleFacture}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Barre de pagination client */}
        {!loadingFactures && factures.length > 0 && (
          <div className="pagination" style={{ fontSize: '0.75rem', padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }}>
            <span className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span>
                Affichage {totalFiltered === 0 ? 0 : ((currentPage - 1) * pageSize) + 1} à {Math.min(currentPage * pageSize, totalFiltered)} sur {totalFiltered}
                {totalFiltered !== factures.length && ` (filtré sur ${factures.length})`}
              </span>
              <select
                value={pageSize}
                onChange={e => handlePageSizeChange(Number(e.target.value))}
                style={{ padding: '0.15rem 0.35rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', fontSize: '0.75rem', cursor: 'pointer' }}
                title="Nombre de factures par page"
              >
                <option value={50}>50 / page</option>
                <option value={100}>100 / page</option>
                <option value={200}>200 / page</option>
                <option value={500}>500 / page</option>
              </select>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className="page-btn btn"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                disabled={currentPage === 1 || loadingFactures}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Précédent
              </button>
              <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{currentPage} / {totalPages}</span>
              <button
                className="page-btn btn"
                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                disabled={currentPage === totalPages || loadingFactures || totalPages === 0}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Suivant
              </button>
            </div>
          </div>
        )}
      </div>

      {resultats && (
        <div className="card regesp-resultats-container">
          <div className="table-header-wrapper" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="table-title">Résultat — 1 règlement par facture</span>
            <button
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              onClick={() => setResultats(null)}
              title="Fermer le tableau de résultats"
            >
              <X size={16} />
            </button>
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
