import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { LogOut, LayoutDashboard, FileText, Loader2, DollarSign, Download, X, CheckSquare, RefreshCw, Settings, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import './index.css';

// Types
interface User {
  no: number;
  login: string;
  nom: string;
  prenom: string;
  societeId: number;
  societeName: string;
  caisses: number[];
  info1Label?: string;
  info2Label?: string;
  info3Label?: string;
  info4Label?: string;
  isAdmin?: boolean;
  token: string;
}

interface Reglement {
  no: number;
  reference: string | null;
  date: string;
  dateEcheance: string;
  montant: number;
  montantDeviseSociete: number;
  etat: number;
  clientIntitule: string;
  caisseNo: number;
  banqueNo: number | null;
  banqueTier: string | null;
  ribClient: string | null;
  modeReglementNo: number;
  isPointe: boolean;
  datePointage: string | null;
  isComptabilise: number;
  isRemis: number;
  dateRemis: string | null;
  isImpaye: number;
  impayeDate: string | null;
  isAnnule: boolean;
  pieceNumero: string | null;
  extraitNum: string | null;
  numero: string | null;
  libelle: string | null;
  soldeDeviseSociete: number;
  info1: string | null;
  info2: string | null;
  info3: string | null;
  info4: string | null;
}

import { DEFAULT_COLUMNS, getAvailableColumns, renderSharedCell, getTypeReglementLabel, formatMoney } from './utils';

import ApercuComptabilisation from './ApercuComptabilisation';
import { RapprochementBancaire } from './RapprochementBancaire';
import { RelevesBancaires } from './RelevesBancaires';
import { ExcelFilter } from './ExcelFilter';

import { API_BASE } from './api';

function App() {
  const [user, setUser] = useState<User | null>(() => {
    const saved = sessionStorage.getItem('gocom_user');
    if (!saved) return null;
    const parsed = JSON.parse(saved) as User;
    // Restaure le header Authorization dès l'init (avant le montage du dashboard et ses requêtes)
    if (parsed?.token) axios.defaults.headers.common['Authorization'] = `Bearer ${parsed.token}`;
    return parsed;
  });
  const [toast, setToast] = useState<{message: string, type: 'success'|'error'|'warning'} | null>(null);

  const showToast = (message: string, type: 'success'|'error'|'warning' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  
  const handleLogin = (u: User) => {
    sessionStorage.setItem('gocom_user', JSON.stringify(u));
    axios.defaults.headers.common['Authorization'] = `Bearer ${u.token}`;
    setUser(u);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('gocom_user');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };
  
  // Safeguard against old session data missing societeId
  useEffect(() => {
    if (user && user.societeId === undefined) {
      handleLogout();
    }
  }, [user]);
  
  if (!user || user.societeId === undefined) {
    return <Login onLogin={handleLogin} />;
  }
  
  return (
    <>
      <Dashboard user={user} onLogout={handleLogout} showToast={showToast} />
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 9999,
          backgroundColor: toast.type === 'error' ? 'var(--danger-color, #ef4444)' : toast.type === 'warning' ? '#f59e0b' : 'var(--success-color, #22c55e)',
          color: 'white', padding: '1rem 1.5rem', borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          fontWeight: 500, fontSize: '0.875rem', animation: 'fade-in 0.3s ease-out'
        }}>
          {toast.type === 'error' ? <X size={20} /> : <CheckSquare size={20} />}
          {toast.message}
        </div>
      )}
    </>
  );
}

// --- LOGIN COMPONENT ---
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [societeId, setSocieteId] = useState('');
  const [societes, setSocietes] = useState<{id: number, raisonSociale: string}[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    axios.get(`${API_BASE}/reference/societes`).then(res => {
      setSocietes(res.data);
      if (res.data.length > 0) setSocieteId(res.data[0].id.toString());
    }).catch(err => console.error("Erreur chargement sociétés", err));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    
    try {
      const res = await axios.post(`${API_BASE}/auth/login`, {
        username,
        password,
        societeId: parseInt(societeId)
      });
      onLogin(res.data);
    } catch (err) {
      setError('Identifiants incorrects. Veuillez réessayer.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h1 className="auth-title">GRC</h1>
        <p className="auth-subtitle">Accès sécurisé à l'espace de gestion</p>
        
        {error && (
          <div className="mb-4 text-sm text-danger text-center animate-fade-in">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Nom d'utilisateur</label>
            <input 
              type="text" 
              className="form-input" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              required 
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <input 
              type="password" 
              className="form-input" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              required 
            />
          </div>
          <div className="form-group">
            <label className="form-label">Société</label>
            <select 
              className="form-input" 
              value={societeId}
              onChange={e => setSocieteId(e.target.value)}
              required 
            >
              {societes.map(s => <option key={s.id || (s as any).Id || (s as any).ID} value={s.id || (s as any).Id || (s as any).ID}>{s.raisonSociale || (s as any).RaisonSociale || (s as any).raisonSocial || (s as any).RaisonSocial || (s as any).SO_RaisonSocial || 'GOCOM (Nom introuvable)'}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary mt-4" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" size={20} /> : 'Se Connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}

// --- DASHBOARD COMPONENT ---
function Dashboard({ user, onLogout, showToast }: { user: User; onLogout: () => void; showToast: (msg: string, type?: 'success'|'error'|'warning') => void }) {
  const availableColumns = React.useMemo(() => getAvailableColumns(user), [user]);

  const [reglements, setReglements] = useState<Reglement[]>([]);
  const [caissesMap, setCaissesMap] = useState<Record<number, any>>({});
  const [modesMap, setModesMap] = useState<Record<number, any>>({});
  const [banquesMap, setBanquesMap] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => parseInt(localStorage.getItem('gocom_page_size') || '10'));
  const [total, setTotal] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [currentView, setCurrentView] = useState<'reglements' | 'comptabilisation' | 'rapprochement' | 'releves'>('reglements');
  const [sortCol, setSortCol] = useState('date');
  const [sortDesc, setSortDesc] = useState(true);
  
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => {
    const saved = localStorage.getItem('gocom_table_columns');
    if (saved) {
      try {
        let cols = JSON.parse(saved) as string[];
        if (cols.includes('caisse')) {
          cols = cols.flatMap(c => c === 'caisse' ? ['caisseCode', 'caisseIntitule'] : [c]);
        }
        const validCols = cols.filter(c => availableColumns.some(ac => ac.key === c));
        if (validCols.length > 0) return Array.from(new Set(validCols));
      } catch (e) {
        // ignore
      }
    }
    return DEFAULT_COLUMNS;
  });
  
  // Save columns to local storage when changed
  useEffect(() => {
    localStorage.setItem('gocom_table_columns', JSON.stringify(selectedColumns));
  }, [selectedColumns]);

  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [debouncedFilters, setDebouncedFilters] = useState<Record<string, string>>({});
  const [distincts, setDistincts] = useState<Record<string, string[]>>({});
  
  // Rapprochement State
  const [isRapprochementMode, setIsRapprochementMode] = useState(false);
  const [rapprochementExtrait, setRapprochementExtrait] = useState('');
  const [rapprochementDate, setRapprochementDate] = useState(new Date().toISOString().substring(0, 10));
  const [rapprochementSolde, setRapprochementSolde] = useState<number>(0);
  const [selectedReglements, setSelectedReglements] = useState<Record<number, { extraitNum: string, dateValeur: string }>>({});
  const [isSubmittingRapprochement, setIsSubmittingRapprochement] = useState(false);
  
  // Comptabilisation State
  const [isComptabilisationMode, setIsComptabilisationMode] = useState(false);
  const [selectedComptabilisation, setSelectedComptabilisation] = useState<Record<number, boolean>>({});
  const [isSubmittingComptabilisation, setIsSubmittingComptabilisation] = useState(false);
  
  // Drag and Drop state
  const [draggedCol, setDraggedCol] = useState<string | null>(null);

  useEffect(() => {
    fetchReferences();
  }, []);

  // Debounce effect for filters
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), 500);
    return () => clearTimeout(timer);
  }, [filters]);

  useEffect(() => {
    setPage(1); // reset to page 1 on filter change
    fetchReglements(1, debouncedFilters);
  }, [debouncedFilters]);

  useEffect(() => {
    fetchReglements(page, debouncedFilters);
  }, [page]);
  
  useEffect(() => {
    localStorage.setItem('gocom_page_size', pageSize.toString());
    setPage(1);
    fetchReglements(1, debouncedFilters);
  }, [pageSize]);

  useEffect(() => {
    setPage(1);
    fetchReglements(1, debouncedFilters);
  }, [sortCol, sortDesc]);

  const handleExport = async () => {
    try {
      const params = buildParams(1, 1000000, debouncedFilters);
      const res = await axios.get(`${API_BASE}/reglements`, { params });
      const allData = res.data.items;
      
      const exportData = allData.map((reg: Reglement) => {
        const row: any = {};
        selectedColumns.forEach(key => {
          const colDef = availableColumns.find(c => c.key === key);
          if (!colDef) return;
          
          // Using shared rendering logic or manual mapping
          let val = null;
          if (key === 'no') val = reg.no;
          else if (key === 'client') val = reg.clientIntitule;
          else if (key === 'caisseCode') val = caissesMap[reg.caisseNo]?.code || reg.caisseNo;
          else if (key === 'caisseIntitule') val = caissesMap[reg.caisseNo]?.intitule || '';
          else if (key === 'banque') val = (reg.banqueNo != null ? (banquesMap[reg.banqueNo]?.code || reg.banqueNo) : '') || '';
          else if (key === 'banqueClient') val = reg.banqueTier || reg.ribClient || '';
          else if (key === 'mode') val = modesMap[reg.modeReglementNo]?.code || reg.modeReglementNo;
          else if (key === 'typeReglement') val = getTypeReglementLabel(modesMap[reg.modeReglementNo]?.typeNo);
          else if (key === 'date') val = reg.date ? new Date(reg.date).toLocaleDateString() : '';
          else if (key === 'montant') val = reg.montantDeviseSociete;
          else if (key === 'pointe') val = reg.isPointe ? 'OUI' : 'NON';
          else if (key === 'comptabilise') val = reg.isComptabilise > 0 ? 'OUI' : 'NON';
          else if (key === 'remis') val = reg.isRemis > 0 ? 'OUI' : 'NON';
          else if (key === 'impaye') val = reg.isImpaye > 0 ? 'OUI' : 'NON';
          else if (key === 'annule') val = reg.isAnnule ? 'OUI' : 'NON';
          else if (key === 'piece') val = reg.pieceNumero;
          else if (key === 'extrait') val = reg.extraitNum;
          else if (key === 'reference') val = reg.reference;
          else if (key === 'numero') val = reg.numero;
          else if (key === 'libelle') val = reg.libelle;
          else if (key === 'solde') val = reg.soldeDeviseSociete;
          else if (key === 'info1') val = reg.info1;
          else if (key === 'info2') val = reg.info2;
          else if (key === 'info3') val = reg.info3;
          else if (key === 'info4') val = reg.info4;
          row[colDef.label] = val;
        });
        return row;
      });
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Reglements");
      XLSX.writeFile(workbook, "Export_Reglements.xlsx");
    } catch (err) {
      console.error("Erreur lors de l'export Excel", err);
    }
  };

  const fetchReferences = async () => {
    try {
      const caissesStr = user.caisses.join(',');
      const [caissesRes, modesRes, banquesRes, distinctsRes] = await Promise.all([
        axios.get(`${API_BASE}/reference/caisses`),
        axios.get(`${API_BASE}/reference/modes?caisses=${caissesStr}`),
        axios.get(`${API_BASE}/reference/banques`),
        axios.get(`${API_BASE}/reglements/distincts?societeId=${user.societeId}&caisses=${caissesStr}`)
      ]);
      const cmap: Record<number, any> = {};
      caissesRes.data.forEach((c: any) => cmap[c.id] = c);
      setCaissesMap(cmap);

      const mmap: Record<number, any> = {};
      modesRes.data.forEach((m: any) => mmap[m.id] = m);
      setModesMap(mmap);

      const bmap: Record<number, any> = {};
      banquesRes.data.forEach((b: any) => bmap[b.id] = b);
      setBanquesMap(bmap);
      
      if (distinctsRes.data) {
        setDistincts(distinctsRes.data);
      }
    } catch (err) {
      console.error('Failed to fetch references', err);
    }
  };

  const toggleColumn = (key: string) => {
    setSelectedColumns(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };



  const buildParams = (currentPage: number, size: number, currentFilters: Record<string, string>) => {
      const caissesStr = user.caisses.join(',');
      const params: any = {
        societeId: user.societeId,
        caisses: caissesStr,
        page: currentPage,
        pageSize: size,
        sortCol,
        sortDesc
      };
      
      // Les valeurs de type liste sont jointes par '|||' ; les IDs backend attendus en CSV
      const toCsv = (v: string) => v.split('|||').filter(Boolean).join(',');

      if (currentFilters.caisseCode) params.caisseNos = toCsv(currentFilters.caisseCode);
      if (currentFilters.caisseIntitule) {
        const nos = toCsv(currentFilters.caisseIntitule);
        const selected = nos.split(',');
        params.caisseNos = params.caisseNos ? params.caisseNos.split(',').filter((id: string) => selected.includes(id)).join(',') : nos;
      }
      if (currentFilters.banque) params.banqueNos = toCsv(currentFilters.banque);
      if (currentFilters.mode) params.modeNos = toCsv(currentFilters.mode);

      if (currentFilters.typeReglement) {
        const selectedTypes = currentFilters.typeReglement.split('|||').map(Number);
        const matchedModes = Object.values(modesMap).filter((m: any) => selectedTypes.includes(m.typeNo)).map((m: any) => m.id);
        params.modeNos = params.modeNos ? params.modeNos.split(',').filter((id: string) => matchedModes.includes(parseInt(id))).join(',') : (matchedModes.length > 0 ? matchedModes.join(',') : '-1');
      }

      if (currentFilters.client) params.client = currentFilters.client;
      if (currentFilters.numero) params.numero = currentFilters.numero;
      if (currentFilters.piece) params.piece = currentFilters.piece;
      if (currentFilters.reference) params.reference = currentFilters.reference;
      if (currentFilters.libelle) params.libelle = currentFilters.libelle;
      if (currentFilters.extrait) params.extrait = currentFilters.extrait;
      if (currentFilters.banqueClient) params.banqueClient = currentFilters.banqueClient;
      if (currentFilters.info1) params.info1 = currentFilters.info1;
      if (currentFilters.info2) params.info2 = currentFilters.info2;
      if (currentFilters.info3) params.info3 = currentFilters.info3;
      if (currentFilters.info4) params.info4 = currentFilters.info4;

      // Filtres numériques (plage min~max) : montant, solde
      if (currentFilters.montant) {
        const [min, max] = currentFilters.montant.split('~');
        if (min) params.montantMin = min;
        if (max) params.montantMax = max;
      }
      if (currentFilters.solde) {
        const [min, max] = currentFilters.solde.split('~');
        if (min) params.soldeMin = min;
        if (max) params.soldeMax = max;
      }

      // Filtre date (période du~au) -> dateDebut / dateFin (déjà gérés côté backend/repo)
      if (currentFilters.date) {
        const [from, to] = currentFilters.date.split('~');
        if (from) params.dateDebut = from;
        if (to) params.dateFin = to + 'T23:59:59'; // borne "Au" inclusive (fin de journée)
      }

      if (currentFilters.pointe) params.pointe = currentFilters.pointe === 'oui';
      if (currentFilters.comptabilise) params.comptabilise = currentFilters.comptabilise === 'oui';
      if (currentFilters.remis) params.remis = currentFilters.remis === 'oui';
      if (currentFilters.impaye) params.impaye = currentFilters.impaye === 'oui';
      if (currentFilters.annule) params.annule = currentFilters.annule === 'oui';
      
      return params;
  };

  const handleSubmitRapprochement = async () => {
    const ids = Object.keys(selectedReglements).map(Number);
    if (ids.length === 0) return;
    
    for (const id of ids) {
      if (!selectedReglements[id].extraitNum || selectedReglements[id].extraitNum.trim() === '') {
        showToast(`Veuillez renseigner le N° Extrait pour #${id}`, 'warning');
        return;
      }
    }
    
    setIsSubmittingRapprochement(true);
    try {
      const requests = ids.map(id => ({
        ReglementId: id,
        ExtraitNum: selectedReglements[id].extraitNum,
        DateValeur: selectedReglements[id].dateValeur
      }));
      await axios.post(`${API_BASE}/rapprochement`, requests);
      setSelectedReglements({});
      setIsRapprochementMode(false);
      setFilters(prev => { const f = {...prev}; delete f.pointe; return f; });
      fetchReglements(page, debouncedFilters);
      showToast('Rapprochement validé !', 'success');
    } catch (err) {
      showToast('Erreur lors du rapprochement', 'error');
    } finally {
      setIsSubmittingRapprochement(false);
    }
  };

  const handleSubmitComptabilisation = async () => {
    const ids = Object.keys(selectedComptabilisation).map(Number);
    if (ids.length === 0) return;
    setIsSubmittingComptabilisation(true);
    try {
      const res = await axios.post(`${API_BASE}/reglements/comptabiliser`, ids);
      setSelectedComptabilisation({});
      if (res.data.errorCount > 0) showToast(`${res.data.successCount} comptabilisés, ${res.data.errorCount} erreurs.`, 'warning');
      else {
          showToast(`Comptabilisation réussie !`, 'success');
          setIsComptabilisationMode(false);
          setFilters(prev => { const f = {...prev}; delete f.comptabilise; return f; });
      }
      fetchReglements(page, debouncedFilters);
    } catch (err) {
      showToast('Erreur lors de la comptabilisation', 'error');
    } finally {
      setIsSubmittingComptabilisation(false);
    }
  };

  const fetchReglements = async (currentPage: number, currentFilters: Record<string, string> = {}) => {
    setLoading(true);
    try {
      const params = buildParams(currentPage, pageSize, currentFilters);
      const res = await axios.get(`${API_BASE}/reglements`, { params });
      setReglements(res.data.items);
      setTotal(res.data.totalItems);
    } catch (err) {
      console.error('Failed to fetch reglements', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, colKey: string) => {
    setDraggedCol(colKey);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    if (!draggedCol || draggedCol === targetKey) return;
    const fromIndex = selectedColumns.indexOf(draggedCol);
    const toIndex = selectedColumns.indexOf(targetKey);
    const newCols = [...selectedColumns];
    newCols.splice(fromIndex, 1);
    newCols.splice(toIndex, 0, draggedCol);
    setSelectedColumns(newCols);
    setDraggedCol(null);
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      if (value === '' || value === 'all') {
        delete newFilters[key];
      } else {
        newFilters[key] = value;
      }
      return newFilters;
    });
  };

  const totalPages = Math.ceil(total / pageSize);
  const tableBodyMemo = useMemo(() => (
    <tbody>
      {reglements.map(reg => {
        const isSelected = selectedReglements[reg.no] !== undefined || selectedComptabilisation[reg.no] !== undefined;
        const rowUI = (
        <tr 
          key={reg.no}
          onClick={() => {
            if (isRapprochementMode && !reg.isPointe) {
              setSelectedReglements(prev => {
                const n = { ...prev };
                if (n[reg.no]) {
                    delete n[reg.no];
                } else {
                    n[reg.no] = { 
                        extraitNum: rapprochementExtrait || '', 
                        dateValeur: rapprochementDate 
                    };
                }
                return n;
              });
            } else if (isComptabilisationMode && reg.isComptabilise === 0) {
              setSelectedComptabilisation(prev => {
                const n = { ...prev };
                if (n[reg.no]) delete n[reg.no];
                else n[reg.no] = true;
                return n;
              });
            }
          }}
          style={{
            cursor: (isRapprochementMode && !reg.isPointe) || (isComptabilisationMode && reg.isComptabilise === 0) ? 'pointer' : 'default',
            backgroundColor: isSelected ? 'rgba(34, 197, 94, 0.1)' : undefined,
            boxShadow: isSelected ? 'inset 4px 0 0 var(--success-color, #22c55e)' : undefined
          }}
        >
          {selectedColumns.map(key => (
            <td key={key}>{renderSharedCell(key, reg, caissesMap, modesMap, banquesMap)}</td>
          ))}
        </tr>
        );
        
        if (isSelected && isRapprochementMode) {
            return (
              <React.Fragment key={reg.no}>
                {rowUI}
                <tr style={{backgroundColor: 'rgba(34, 197, 94, 0.05)'}}>
                  <td colSpan={selectedColumns.length} style={{padding: '0.5rem 1rem 0.5rem 3rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)'}}>
                    <div style={{display: 'inline-flex', gap: '1.5rem', alignItems: 'center'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <span style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)'}}>N° Extrait pour cette ligne:</span>
                            <input 
                              type="text" 
                              className="form-input" 
                              style={{width: '120px', padding: '0.25rem 0.5rem', fontSize: '0.75rem', minHeight: 'auto'}} 
                              value={selectedReglements[reg.no].extraitNum} 
                              onChange={e => setSelectedReglements(p => ({...p, [reg.no]: {...p[reg.no], extraitNum: e.target.value}}))} 
                              onClick={e => e.stopPropagation()} 
                            />
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                            <span style={{fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)'}}>Date Valeur:</span>
                            <input 
                              type="date" 
                              className="form-input" 
                              style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem', minHeight: 'auto'}} 
                              value={selectedReglements[reg.no].dateValeur} 
                              onChange={e => setSelectedReglements(p => ({...p, [reg.no]: {...p[reg.no], dateValeur: e.target.value}}))} 
                              onClick={e => e.stopPropagation()} 
                            />
                        </div>
                    </div>
                  </td>
                </tr>
              </React.Fragment>
            );
        }
        
        return rowUI;
      })}
      {reglements.length === 0 && !loading && (
        <tr>
          <td colSpan={selectedColumns.length} style={{textAlign: 'center', padding: '2rem'}}>Aucun règlement trouvé</td>
        </tr>
      )}
    </tbody>
  ), [reglements, selectedReglements, selectedComptabilisation, isRapprochementMode, isComptabilisationMode, rapprochementExtrait, rapprochementDate, selectedColumns, caissesMap, modesMap, banquesMap, loading]);

  return (
    <div className="app-container animate-fade-in">
      {/* Sidebar */}
      <aside className={`app-sidebar ${isSidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-header" style={isSidebarOpen ? {cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start'} : {cursor: 'pointer'}} onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
          {isSidebarOpen ? (
            <>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
                <div className="flex items-center gap-2">
                  <LayoutDashboard size={24} style={{color: 'var(--accent-primary)'}} />
                  <span>GRC</span>
                </div>
                <ChevronRight size={18} style={{color: 'var(--text-tertiary)', transform: 'rotate(180deg)'}} />
              </div>
              <div style={{fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', paddingLeft: 'calc(24px + 0.5rem)', marginTop: '0.25rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                {user.societeName}
              </div>
            </>
          ) : (
            <LayoutDashboard size={24} style={{color: 'var(--accent-primary)'}} />
          )}
        </div>

        <div className="sidebar-menu">
          <div className={`sidebar-item ${currentView === 'reglements' ? 'active' : ''}`} title="Règlements" onClick={() => setCurrentView('reglements')}>
            <FileText size={18} />
            <span className="sidebar-text">Règlements</span>
          </div>
          <div className={`sidebar-item ${currentView === 'releves' ? 'active' : ''}`} title="Relevés Bancaires (Import)" onClick={() => setCurrentView('releves')}>
            <Download size={18} />
            <span className="sidebar-text">Relevés Bancaires</span>
          </div>
          <div className={`sidebar-item ${currentView === 'rapprochement' ? 'active' : ''}`} title="Rapprochement Bancaire" onClick={() => setCurrentView('rapprochement')}>
            <DollarSign size={18} />
            <span className="sidebar-text">Rapprochement</span>
          </div>
        </div>
        
        <div className="sidebar-footer">
          {isSidebarOpen ? (
            <>
              <div style={{fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)'}}>
                {user.nom} {user.prenom}
                {user.isAdmin && <span style={{backgroundColor: 'var(--accent-primary)', color: 'white', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', marginLeft: '6px', verticalAlign: 'middle'}}>ADMIN</span>}
              </div>
              <div style={{fontSize: '0.75rem', marginBottom: '1rem', color: 'var(--text-secondary)'}}>
                {user.isAdmin ? 'Toutes caisses' : (user.caisses.length > 3 ? `${user.caisses.length} caisses` : user.caisses.join(', '))}
              </div>
              <button onClick={onLogout} className="btn" style={{backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
                <LogOut size={16} />
                <span>Déconnexion</span>
              </button>
            </>
          ) : (
            <button onClick={onLogout} className="btn" style={{backgroundColor: 'transparent', color: 'var(--text-primary)', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center'}} title="Déconnexion">
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      
      {/* Main Content */}
      <main className="main-content">
        {currentView === 'releves' ? (
          <RelevesBancaires />
        ) : currentView === 'rapprochement' ? (
          <RapprochementBancaire caissesMap={caissesMap} modesMap={modesMap} availableColumns={availableColumns} user={user} showToast={showToast} onNavigateToImport={() => setCurrentView('releves')} />
        ) : currentView === 'comptabilisation' ? (
          <ApercuComptabilisation user={user} showToast={showToast} caissesMap={caissesMap} modesMap={modesMap} />
        ) : (
          <>
        <div className="table-container">
          <div className="table-header-wrapper">
            <div className="flex items-center gap-2">
              <span className="table-title">Règlements Clients</span>
              <span style={{fontSize: '0.875rem', color: 'var(--text-secondary)', marginLeft: '0.5rem'}}>
                ({total} enregistrements)
              </span>
            </div>
            
            <div style={{position: 'relative', display: 'flex', gap: '0.5rem'}}>
              {Object.keys(filters).filter(k => !(isRapprochementMode && k === 'pointe') && !(isComptabilisationMode && k === 'comptabilise')).length > 0 && (
                <button className="btn" style={{backgroundColor: 'white', padding: '0.25rem 0.5rem', border: '1px solid var(--border-color)', color: 'var(--danger-color, #ef4444)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem'}} onClick={() => setFilters(isRapprochementMode ? { pointe: 'non' } : isComptabilisationMode ? { comptabilise: 'non' } : {})}>
                  <X size={14} /> Effacer filtres
                </button>
              )}
              
              <button
                className="btn"
                style={{
                  width: 'auto',
                  backgroundColor: isComptabilisationMode ? 'var(--accent-primary)' : 'white',
                  color: isComptabilisationMode ? 'white' : 'var(--text-primary)',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  display: 'none',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  border: isComptabilisationMode ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)'
                }}
                onClick={() => {
                  if (Object.keys(selectedComptabilisation).length > 0) {
                    if (window.confirm('Voulez-vous annuler la sélection en cours ?')) {
                      setIsComptabilisationMode(false);
                      setSelectedComptabilisation({});
                      setFilters(prev => {
                        const f = {...prev};
                        delete f.comptabilise;
                        return f;
                      });
                    }
                  } else {
                    setIsComptabilisationMode(!isComptabilisationMode);
                    if (!isComptabilisationMode) {
                      setIsRapprochementMode(false);
                      setFilters(prev => ({...prev, comptabilise: 'non'}));
                      setSelectedComptabilisation({});
                    } else {
                      setFilters(prev => {
                        const f = {...prev};
                        delete f.comptabilise;
                        return f;
                      });
                    }
                  }
                }}
              >
                <CheckSquare size={14} /> 
                {isComptabilisationMode ? 'Fermer Comptabilisation' : 'Comptabiliser'}
              </button>

              <button 
                className="btn" 
                style={{
                  width: 'auto',
                  backgroundColor: isRapprochementMode ? 'var(--accent-primary)' : 'white',
                  color: isRapprochementMode ? 'white' : 'var(--text-primary)',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.8125rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  border: isRapprochementMode ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)'
                }}
                onClick={() => {
                  if (Object.keys(selectedReglements).length > 0) {
                    if (window.confirm('Voulez-vous annuler le rapprochement en cours ?')) {
                      setIsRapprochementMode(false);
                      setSelectedReglements({});
                      setFilters(prev => {
                        const f = {...prev};
                        delete f.pointe;
                        return f;
                      });
                    }
                  } else {
                    setIsRapprochementMode(!isRapprochementMode);
                    if (!isRapprochementMode) {
                      setIsComptabilisationMode(false);
                      setFilters(prev => ({...prev, pointe: 'non'}));
                      setSelectedReglements({});
                    } else {
                      setFilters(prev => {
                        const f = {...prev};
                        delete f.pointe;
                        return f;
                      });
                    }
                  }
                }}
              >
                <CheckSquare size={14} /> 
                {isRapprochementMode ? 'Fermer Rapprochement' : 'Rapprocher'}
              </button>

              <button className="btn" style={{backgroundColor: 'white', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'}} onClick={() => fetchReglements(page, debouncedFilters)}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Rafraîchir
              </button>

              <button className="btn" style={{backgroundColor: 'white', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'}} onClick={handleExport}>
                <Download size={14} /> Exporter
              </button>
              
              <div style={{position: 'relative'}}>
                <button className="btn" style={{backgroundColor: 'white', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.8125rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', whiteSpace: 'nowrap'}} onClick={() => setShowColumnMenu(!showColumnMenu)}>
                  Colonnes <Settings size={14} />
                </button>
                {showColumnMenu && (
                <div style={{position: 'absolute', right: 0, top: '110%', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1rem', zIndex: 50, width: '250px', boxShadow: 'var(--shadow-lg)'}}>
                  <div style={{fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)'}}>Colonnes à afficher</div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflowY: 'auto'}}>
                    {availableColumns.map(col => (
                      <label key={col.key} style={{display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem'}}>
                        <input type="checkbox" checked={selectedColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} />
                        {col.label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>
          
          {isComptabilisationMode && (
            <div style={{
              backgroundColor: 'var(--bg-secondary)', 
              padding: '1rem', 
              borderRadius: 'var(--radius-md)', 
              border: '1px solid var(--accent-primary)',
              marginBottom: '1rem',
              display: 'flex',
              gap: '2rem',
              alignItems: 'center',
              animation: 'fade-in 0.3s ease-out'
            }}>
              <div>
                <h3 style={{margin: 0, fontSize: '1rem', color: 'var(--text-primary)'}}>Mode Comptabilisation en masse</h3>
                <p style={{margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Sélectionnez les règlements ci-dessous pour les comptabiliser.</p>
              </div>
              
              <div style={{marginLeft: 'auto', textAlign: 'right', marginRight: '1rem'}}>
                <div style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Total Sélectionné</div>
                <div style={{fontSize: '1.25rem', fontWeight: 700, color: 'var(--success-color, #22c55e)'}}>
                   {formatMoney(Object.keys(selectedComptabilisation).reduce((acc, idStr) => {
                      const reg = reglements.find(r => r.no === parseInt(idStr));
                      return acc + (reg ? reg.montantDeviseSociete : 0);
                   }, 0))}
                </div>
              </div>
              
              <button 
                className="btn"
                style={{
                  width: 'auto',
                  backgroundColor: (Object.keys(selectedComptabilisation).length === 0 || isSubmittingComptabilisation) ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                  color: (Object.keys(selectedComptabilisation).length === 0 || isSubmittingComptabilisation) ? 'var(--text-secondary)' : 'white',
                  padding: '0.75rem 2rem',
                  borderRadius: '999px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: (Object.keys(selectedComptabilisation).length === 0 || isSubmittingComptabilisation) ? 'none' : '0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1)',
                  cursor: (Object.keys(selectedComptabilisation).length === 0 || isSubmittingComptabilisation) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
                disabled={Object.keys(selectedComptabilisation).length === 0 || isSubmittingComptabilisation}
                onClick={handleSubmitComptabilisation}
              >
                {isSubmittingComptabilisation ? <Loader2 className="animate-spin" size={18} /> : <CheckSquare size={18} />}
                {isSubmittingComptabilisation ? 'Comptabilisation en cours...' : `Lancer la Comptabilisation (${Object.keys(selectedComptabilisation).length})`}
              </button>
            </div>
          )}
          
          {isRapprochementMode && (
            <div style={{
              backgroundColor: 'var(--bg-secondary)', 
              padding: '1rem', 
              borderRadius: 'var(--radius-md)', 
              border: '1px solid var(--accent-primary)',
              marginBottom: '1rem',
              display: 'flex',
              gap: '2rem',
              alignItems: 'center'
            }}>
              <div>
                <label style={{display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem'}}>N° Extrait</label>
                <input type="text" style={{width: '150px', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)'}} value={rapprochementExtrait} onChange={e => setRapprochementExtrait(e.target.value)} placeholder="Ex: EXT-2023" />
              </div>
              <div>
                <label style={{display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem'}}>Date Valeur (Défaut)</label>
                <input type="date" style={{padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)'}} value={rapprochementDate} onChange={e => setRapprochementDate(e.target.value)} />
              </div>
              <div>
                <label style={{display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem'}}>Solde Bancaire Cible</label>
                <input type="number" style={{width: '150px', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)'}} value={rapprochementSolde} onChange={e => setRapprochementSolde(Number(e.target.value))} />
              </div>
              
              <div style={{marginLeft: 'auto', textAlign: 'right', marginRight: '1rem'}}>
                <div style={{fontSize: '0.75rem', color: 'var(--text-secondary)'}}>Total Pointé</div>
                <div style={{fontSize: '1.25rem', fontWeight: 700, color: 'var(--success-color, #22c55e)'}}>
                   {formatMoney(Object.keys(selectedReglements).reduce((acc, idStr) => {
                      const reg = reglements.find(r => r.no === parseInt(idStr));
                      return acc + (reg ? reg.montantDeviseSociete : 0);
                   }, 0))}
                </div>
              </div>
              
              <button 
                className="btn"
                style={{
                  width: 'auto',
                  backgroundColor: (Object.keys(selectedReglements).length === 0 || isSubmittingRapprochement) ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                  color: (Object.keys(selectedReglements).length === 0 || isSubmittingRapprochement) ? 'var(--text-secondary)' : 'white',
                  padding: '0.75rem 2rem',
                  borderRadius: '999px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: (Object.keys(selectedReglements).length === 0 || isSubmittingRapprochement) ? 'none' : '0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1)',
                  cursor: (Object.keys(selectedReglements).length === 0 || isSubmittingRapprochement) ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}
                disabled={Object.keys(selectedReglements).length === 0 || isSubmittingRapprochement}
                onClick={handleSubmitRapprochement}
              >
                <CheckSquare size={18} />
                {isSubmittingRapprochement ? 'Validation...' : `Valider Rapprochement (${Object.keys(selectedReglements).length})`}
              </button>
            </div>
          )}

          <div style={{overflow: 'auto', flex: 1, minHeight: '400px', paddingBottom: '2rem', position: 'relative'}}>
            {loading && reglements.length === 0 ? (
              <div style={{padding: '3rem', textAlign: 'center'}}>
                <Loader2 className="animate-spin" size={32} style={{margin: '0 auto', color: 'var(--accent-primary)'}} />
                <p className="mt-4 text-secondary">Chargement des données...</p>
              </div>
            ) : (
              <>
                {loading && (
                  <div style={{position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, backgroundColor: 'white', padding: '0.5rem 1rem', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)', fontSize: '0.875rem', fontWeight: 600}}>
                    <Loader2 className="animate-spin" size={16} />
                    Mise à jour...
                  </div>
                )}
                <table style={{minWidth: '1000px', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto'}}>
                <thead>
                  <tr>
                    {selectedColumns.map(key => {
                      const col = availableColumns.find(c => c.key === key);
                      if (!col) return null;
                      const isBoolean = ['pointe', 'comptabilise', 'remis', 'impaye', 'annule'].includes(col.key);
                      // Colonnes numériques -> filtre par plage (min/max) ; date -> filtre par période (du/au)
                      const filterType: 'list' | 'number' | 'date' = col.key === 'date' ? 'date'
                        : (['montant', 'solde'].includes(col.key) ? 'number' : 'list');
                      // Les distincts sont renvoyés par le backend avec des clés au pluriel
                      const distinctsKeyMap: Record<string, string> = {
                        client: 'clients', numero: 'numeros', piece: 'pieces', reference: 'references',
                        libelle: 'libelles', extrait: 'extraits', banqueClient: 'banqueClients',
                        info1: 'info1s', info2: 'info2s', info3: 'info3s', info4: 'info4s'
                      };

                      let options: any[] = [];
                      if (filterType === 'list') {
                        if (isBoolean) {
                          options = [{value: 'oui', label: 'Oui'}, {value: 'non', label: 'Non'}];
                        } else if (col.key === 'caisseCode') {
                          options = Object.values(caissesMap).filter((c: any) => user.isAdmin || user.caisses.includes(c.id) || user.caisses.length === 0).map((c: any) => ({ value: c.id.toString(), label: c.code }));
                        } else if (col.key === 'caisseIntitule') {
                          options = Object.values(caissesMap).filter((c: any) => user.isAdmin || user.caisses.includes(c.id) || user.caisses.length === 0).map((c: any) => ({ value: c.id.toString(), label: c.intitule }));
                        } else if (col.key === 'banque') {
                          options = Object.values(banquesMap).map((b: any) => ({ value: b.id.toString(), label: b.code || b.intitule || b.id.toString() }));
                        } else if (col.key === 'mode') {
                          options = Object.values(modesMap).map((m: any) => ({ value: m.id.toString(), label: `${m.code} - ${m.intitule}` }));
                        } else if (col.key === 'typeReglement') {
                          const types = Array.from(new Set(Object.values(modesMap).map((m: any) => m.typeNo).filter(t => t !== undefined && t !== null)));
                          options = types.map((t: any) => ({ value: t.toString(), label: getTypeReglementLabel(t) }));
                        } else if (col.key !== 'no') {
                          const distinctsKey = distinctsKeyMap[col.key] || col.key;
                          const uniqueValues = distincts[distinctsKey] || [];
                          options = uniqueValues.map((v: any) => ({ value: v, label: v }));
                        }
                      }
                      
                      const selectedValues = (filters[col.key] && filterType === 'list') ? filters[col.key].split('|||') : [];

                      return (
                        <th 
                          key={col.key}
                          draggable
                          onDragStart={(e) => handleDragStart(e, col.key)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDrop(e, col.key)}
                          onClick={() => {
                            if (sortCol === col.key) setSortDesc(!sortDesc);
                            else { setSortCol(col.key); setSortDesc(true); }
                          }}
                          style={{cursor: 'pointer', userSelect: 'none'}}
                        >
                          <div style={{display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap'}}>
                            {col.label} {sortCol === col.key ? (sortDesc ? '▼' : '▲') : ''}
                            {col.key !== 'no' && !(isRapprochementMode && col.key === 'pointe') && (
                              <ExcelFilter 
                                columnKey={col.key}
                                filterType={filterType}
                                options={options}
                                selectedValues={selectedValues}
                                textValue={filterType !== 'list' ? (filters[col.key] || '') : ''}
                                onChange={(val) => handleFilterChange(col.key, Array.isArray(val) ? val.join('|||') : val)}
                              />
                            )}
                            {isRapprochementMode && col.key === 'pointe' && (
                               <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: '4px' }} title="Filtre verrouillé en mode Rapprochement">🔒</span>
                            )}
                            {isComptabilisationMode && col.key === 'comptabilise' && (
                               <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: '4px' }} title="Filtre verrouillé en mode Comptabilisation">🔒</span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                {tableBodyMemo}
              </table>
              </>
            )}
          </div>
          
          <div className="pagination" style={{fontSize: '0.75rem'}}>
            <span className="text-secondary" style={{marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '1rem'}}>
              <span>
                Affichage {total === 0 ? 0 : ((page - 1) * pageSize) + 1} à {Math.min(page * pageSize, total)} sur {total}
              </span>
              <select 
                value={pageSize} 
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{padding: '0.1rem 0.25rem', borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', fontSize: '0.75rem', cursor: 'pointer'}}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={10000}>Tout</option>
              </select>
            </span>
            <button 
              className="page-btn" 
              style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}}
              disabled={page === 1 || loading}
              onClick={() => setPage(p => p - 1)}
            >
              Précédent
            </button>
            <span style={{fontWeight: 600}}>{page} / {totalPages || 1}</span>
            <button 
              className="page-btn" 
              style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}}
              disabled={page === totalPages || loading || totalPages === 0}
              onClick={() => setPage(p => p + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
        </>
        )}
      </main>
    </div>
  );
}

export default App;
