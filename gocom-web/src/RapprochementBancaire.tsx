// @ts-nocheck
import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from './api';
import { Play, CheckCircle, Link2, Unlink, ArrowUp, ArrowDown, Lock, Loader2, XCircle } from 'lucide-react';
import './RapprochementBancaire.css';
import { ExcelFilter } from './ExcelFilter';
import { CheckboxDropdown } from './CheckboxDropdown';
import { renderSharedCell, DEFAULT_COLUMNS, formatMoney, matchAmount, matchDateRange } from './utils';
import { Settings, X } from 'lucide-react';

interface LigneReleve {
    id: number;
    dateOperation: string;
    dateOperationRaw?: string;
    dateValeur: string;
    dateValeurRaw: string;
    libelle: string;
    reference: string;
    code: string;
    credit: number;
    lettrage: string | null;
    reservePar_UserId?: number | null;
    reservePar_UserName?: string | null;
    dateReservation?: string | null;
    // TASK-106 — clé d'appariement ligne ↔ règlement
    releveEnteteId: number;
    mvId: number | null;
}

interface ReglementGrc {
    mv_Id: number;
    date: string;
    clientCode: string;
    clientIntitule: string;
    libelle: string;
    montant: number;
    lettrage: string | null;
    reservePar_UserId?: number | null;
    reservePar_UserName?: string | null;
    dateReservation?: string | null;
    releveEnteteId?: number | null;
    // TASK-099 — champs nécessaires pour les règles d'affichage du bouton « Annuler »
    isAnnule?: boolean;
    isPointe?: boolean;
    isComptabilise?: number;
    isRemis?: number;
    isAffecte?: boolean;
}

interface Banque {
    id: number;
    code: string;
    rib: string;
}

// ─── Sous-composants mémoïsés ──────────────────────────────────────────────
// React.memo garantit que la sélection dans UNE grille ne déclenche aucun
// re-render (ni diff virtuel) dans l'AUTRE grille, même avec 1000+ lignes.

let grcRowRenderCount = 0;
let releveRowRenderCount = 0;
let rbRenderCount = 0;

interface GrcTableBodyProps {
    rows: ReglementGrc[];
    selectedGrcId: number | null;
    onSelect: (id: number) => void;
    onAnnuler: (row: ReglementGrc) => void;
    selectedColumns: string[];
    caissesMap: Record<number, any>;
    modesMap: Record<number, any>;
    banquesMap: Record<number, any>;
    currentUserId: number;
    loadedMvIds: Set<number>;
    showPrefix: boolean;
}

const getLettrageColor = (lettrage: string | null) => {
    if (!lettrage) return undefined;
    const colors = ['#fca5a5', '#fdba74', '#fcd34d', '#fef08a', '#d9f99d', '#bbf7d0', '#86efac', '#6ee7b7', '#5eead4', '#7dd3fc', '#93c5fd', '#c4b5fd', '#d8b4fe', '#f9a8d4', '#fda4af'];
    let hash = 0;
    for (let i = 0; i < lettrage.length; i++) hash = lettrage.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length] + '40';
};

// TASK-106 — repère affiché : "<idRelevé>-<lettre>" si withPrefix, sinon la lettre nue.
const formatRepere = (enteteId: number | null | undefined, lettre: string | null | undefined, withPrefix: boolean): string => {
    if (!lettre) return '';
    return withPrefix && enteteId != null ? `${enteteId}-${lettre}` : lettre;
};

// Ordre des paires : par relevé (numérique) puis par lettre — identique à l'existant au sein d'un même relevé.
const comparePairKey = (a: any, b: any): number => {
    const ea = a.releveEnteteId ?? 0, eb = b.releveEnteteId ?? 0;
    if (ea !== eb) return ea - eb;
    return String(a.lettrage ?? '').localeCompare(String(b.lettrage ?? ''));
};

const GrcTableRow = ({ row, isSelected, onSelect, onAnnuler, selectedColumns, caissesMap, modesMap, banquesMap, currentUserId, reservedElsewhere, repere }: any) => {
    // grcRowRenderCount++;
    // console.log(`[RENDER] GrcTableRow: ${row.mv_Id}`);
    const isLockedByOther = row.reservePar_UserId && Number(row.reservePar_UserId) !== Number(currentUserId);
    // TASK-106 — réservé sur un autre relevé (aucune ligne chargée ne porte ce MV_ID) : verrouillé comme une réservation d'autrui
    const isLocked = isLockedByOther || reservedElsewhere;
    const isReserved = !!(row.lettrage || row.reservePar_UserId);

    // Règles d'affichage du bouton « Annuler » (cohérentes avec App.tsx:839)
    const isFree = !row.isAnnule && (row.isComptabilise ?? 0) === 0 && !row.isPointe && (row.isRemis ?? 0) === 0 && !row.isAffecte;
    const showAnnulerBtn = isFree || isReserved;   // visible si libre OU réservé ; absent sinon
    const annulerDisabled = isReserved;             // désactivé si réservé (lettré ou verrou utilisateur)

    return (
    <tr className={row.lettrage && !isLocked ? 'lettered-row' : (isSelected ? 'selected-row' : '')} style={isLocked ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : row.lettrage ? { backgroundColor: getLettrageColor(repere) } : {}}>
        {/* Colonne Sel. — case à cocher ou cadenas */}
        <td>
            {isLocked ? (
                <div style={{display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center'}} title={isLockedByOther ? `Réservé par ${row.reservePar_UserName ?? row.reservePar_UserId}` : `Réservé sur le relevé #${row.releveEnteteId ?? '?'} (non affiché) — sélectionnez ce relevé pour le dérapprocher`}>
                    <Lock size={14} style={{color: '#999'}} />
                    <span style={{fontSize: '0.75rem', color: '#999', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{isLockedByOther ? (row.reservePar_UserName ?? row.reservePar_UserId) : `#${row.releveEnteteId ?? '?'}`}</span>
                </div>
            ) : (
                <input
                    type="checkbox"
                    checked={!!row.lettrage || isSelected}
                    onChange={() => onSelect(row.mv_Id)}
                />
            )}
        </td>
        {/* TASK-099 — Colonne action : bouton Annuler */}
        <td style={{width: '40px', textAlign: 'center', padding: '0 4px'}}>
            {showAnnulerBtn && (
                annulerDisabled ? (
                    <span title="Dérapprochez d'abord la ligne" style={{display: 'inline-flex'}}>
                        <button
                            disabled
                            style={{
                                padding: '4px 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.75rem', cursor: 'not-allowed', borderRadius: '4px',
                                border: '1px solid #e5e7eb', color: '#9ca3af', backgroundColor: '#f3f4f6', opacity: 0.6,
                                pointerEvents: 'none'
                            }}
                            aria-label="Annuler le règlement (désactivé)"
                        >
                            <XCircle size={13} color="#9ca3af" />
                        </button>
                    </span>
                ) : (
                    <button
                        onClick={(e) => { e.stopPropagation(); onAnnuler(row); }}
                        style={{
                            padding: '4px 6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.75rem', cursor: 'pointer', borderRadius: '4px',
                            border: '1px solid #fecaca', color: '#ef4444', backgroundColor: '#fef2f2'
                        }}
                        title="Annuler le règlement"
                        aria-label="Annuler le règlement"
                    >
                        <XCircle size={13} color="#ef4444" />
                    </button>
                )
            )}
        </td>
        {selectedColumns.map((key: string) => (
            <td key={key} className={key === 'montant' || key === 'solde' ? 'amount' : ''}>
                {key === 'lettrage' ? <span className="lettrage-cell">{repere}</span> : renderSharedCell(key, row, caissesMap, modesMap, banquesMap)}
            </td>
        ))}
    </tr>
  );
};

const areEqual = (prevProps: any, nextProps: any) => {
    let equal = true;
    const diffs: string[] = [];
    // TASK-099 : onAnnuler ajouté à la liste pour que React.memo le détecte correctement
    const propsToCompare = ['row', 'isSelected', 'onSelect', 'onAnnuler', 'selectedColumns', 'caissesMap', 'modesMap', 'banquesMap', 'currentUserId', 'reservedElsewhere', 'repere'];
    for (const key of propsToCompare) {
        if (prevProps[key] !== nextProps[key]) {
            // console.log(`[DEBUG] GrcTableRow ${prevProps.row.mv_Id} failed equality due to: ${key}`);
            equal = false;
        }
    }
    return equal;
};

const GrcTableRowMemo = React.memo(GrcTableRow, areEqual);

const GrcTableBody = React.memo(({ rows, selectedGrcId, onSelect, onAnnuler, selectedColumns, caissesMap, modesMap, banquesMap, currentUserId, loadedMvIds, showPrefix }: GrcTableBodyProps) => {
    // console.log(`[RENDER] GrcTableBody with ${rows.length} rows.`);
    return (
    <tbody>
        {rows.map(row => {
            // TASK-106 — primitives calculées par ligne (compatibles avec la mémoïsation)
            const reservedElsewhere = !!row.lettrage && !loadedMvIds.has(row.mv_Id);
            const repere = formatRepere(row.releveEnteteId, row.lettrage, showPrefix || reservedElsewhere);
            return (
            <GrcTableRowMemo
                key={row.mv_Id}
                row={row}
                isSelected={selectedGrcId === row.mv_Id}
                onSelect={onSelect}
                onAnnuler={onAnnuler}
                selectedColumns={selectedColumns}
                caissesMap={caissesMap}
                modesMap={modesMap}
                banquesMap={banquesMap}
                currentUserId={currentUserId}
                reservedElsewhere={reservedElsewhere}
                repere={repere}
            />
            );
        })}
    </tbody>
)});

interface ReleveTableBodyProps {
    rows: LigneReleve[];
    selectedReleveLigneId: number | null;
    onSelect: (id: number) => void;
    currentUserId: number;
    onGenererReglement: (row: LigneReleve) => void;
    showPrefix: boolean;
    showReleveCol: boolean;
    releveLabels: Record<number, string>;
}

const ReleveTableRow = React.memo(({ row, isSelected, onSelect, currentUserId, onGenererReglement, repere, showReleveCol, releveLabel }: any) => {
    // releveRowRenderCount++;
    const isLockedByOther = row.reservePar_UserId && Number(row.reservePar_UserId) !== Number(currentUserId);
    return (
    <tr className={row.lettrage ? 'lettered-row' : (isSelected ? 'selected-row' : '')} style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : row.lettrage ? { backgroundColor: getLettrageColor(repere) } : {}}>
        <td>
            {isLockedByOther ? (
                <div style={{display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center'}} title={`Réservé par ${row.reservePar_UserName ?? row.reservePar_UserId}`}>
                    <Lock size={14} style={{color: '#999'}} />
                    <span style={{fontSize: '0.75rem', color: '#999', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{row.reservePar_UserName ?? row.reservePar_UserId}</span>
                </div>
            ) : (
                <input
                    type="checkbox"
                    checked={!!row.lettrage || isSelected}
                    onChange={() => onSelect(row.id)}
                />
            )}
        </td>
        {showReleveCol && <td title={releveLabel} style={{whiteSpace: 'nowrap', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis'}}>{releveLabel}</td>}
        <td className="lettrage-cell">{repere}</td>
        <td>{row.dateOperation}</td>
        <td>{row.dateValeur}</td>
        <td>{row.libelle}</td>
        <td>{row.reference}</td>
        <td>{row.code}</td>
        <td className="amount">{formatMoney(Number(row.credit))}</td>
        <td style={{textAlign: 'center', whiteSpace: 'nowrap'}}>
            {!row.lettrage && (
                <button
                    className="btn"
                    style={{
                        padding: '0.2rem 0.5rem',
                        fontSize: '0.75rem',
                        backgroundColor: '#2563eb',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        onGenererReglement(row);
                    }}
                    title="Générer un règlement client (Versement) pour cette ligne"
                >
                    Générer règlement
                </button>
            )}
        </td>
    </tr>
    );
});

const ReleveTableBody = React.memo(({ rows, selectedReleveLigneId, onSelect, currentUserId, onGenererReglement, showPrefix, showReleveCol, releveLabels }: ReleveTableBodyProps) => (
    <tbody>
        {rows.map(row => (
            <ReleveTableRow
                key={row.id}
                row={row}
                isSelected={selectedReleveLigneId === row.id}
                onSelect={onSelect}
                currentUserId={currentUserId}
                onGenererReglement={onGenererReglement}
                repere={formatRepere(row.releveEnteteId, row.lettrage, showPrefix)}
                showReleveCol={showReleveCol}
                releveLabel={releveLabels[row.releveEnteteId] ?? `Relevé #${row.releveEnteteId}`}
            />
        ))}
    </tbody>
));

interface Props {
    caissesMap: Record<number, any>;
    modesMap: Record<number, any>;
    availableColumns: any[];
    user: any;
    showToast: (msg: string, type?: 'success'|'error'|'warning') => void;
    // TASK-099 : showConfirm transmis par App.tsx pour ne pas dupliquer le composant de confirmation
    showConfirm: (message: string, onConfirm: () => void) => void;
    onNavigateToImport?: () => void;
}

export const RapprochementBancaire: React.FC<Props> = ({ caissesMap, modesMap, availableColumns, user, showToast, showConfirm, onNavigateToImport }) => {
    // rbRenderCount++;
    // console.log(`[RENDER] RapprochementBancaire (Total: ${rbRenderCount})`);
    const [releves, setReleves] = useState<any[]>([]);
    // TASK-100 : sélection multiple de relevés (traités comme un seul relevé par l'utilisateur).
    // Déclarés ici, avant tout effet/mémo/callback qui les cite (zone morte temporelle masquée par @ts-nocheck).
    const [selectedReleveIds, setSelectedReleveIds] = useState<number[]>([]);
    const selectedReleveIdsKey = [...selectedReleveIds].sort((a, b) => a - b).join(',');
    const showPrefix = selectedReleveIds.length > 1;
    const [lignesReleve, setLignesReleve] = useState<LigneReleve[]>([]);
    const [reglementsGrc, setReglementsGrc] = useState<ReglementGrc[]>([]);
    const [loadingGrc, setLoadingGrc] = useState(false);
    const [loadingReleve, setLoadingReleve] = useState(false);
    
    // Pour le lettrage manuel
    const [selectedGrcId, setSelectedGrcId] = useState<number | null>(null);
    const [selectedReleveLigneId, setSelectedReleveLigneId] = useState<number | null>(null);
    const [pendingReservation, setPendingReservation] = useState<{ grcId: number; ligneId: number } | null>(null);
    const [isUpdatingMontant, setIsUpdatingMontant] = useState(false);

    // Banques
    const [banques, setBanques] = useState<Banque[]>([]);
    const banquesMap = React.useMemo(() => {
        const m: Record<number, any> = {};
        banques.forEach((b: any) => { m[b.id] = b; });
        return m;
    }, [banques]);
    const [selectedBanqueId, setSelectedBanqueId] = useState<number | ''>('');
    const selectedBanqueIdRef = React.useRef<number | ''>('');
    selectedBanqueIdRef.current = selectedBanqueId;
    const releveLabels = React.useMemo(() => {
        const m: Record<number, string> = {};
        releves.forEach((r: any) => { m[r.id] = `${r.titre} (#${r.id})`; });
        return m;
    }, [releves]);
    const [currentLettrageIndex, setCurrentLettrageIndex] = useState(1); // 1 = 'A'

    // Filtre de date — 2 niveaux :
    //  - dateDebut / dateFin : valeurs live des inputs (l'utilisateur peut les saisir librement)
    //  - appliedDateDebut / appliedDateFin : valeurs envoyées à l'API (mises à jour seulement
    //    au clic du bouton Actualiser ou lors du premier chargement via la banque).
    const [dateDebut, setDateDebut] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [dateFin, setDateFin] = useState(() => new Date().toISOString().split('T')[0]);
    const [appliedDateDebut, setAppliedDateDebut] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [appliedDateFin, setAppliedDateFin] = useState(() => new Date().toISOString().split('T')[0]);

    // Filtre "lettrage" : 'non' (par défaut) | 'oui' | 'tous' — appliqué aux 2 grilles.
    // Porte sur le lettrage EN COURS de session (paires GRC↔relevé non encore approuvées),
    // à ne pas confondre avec « Pointé » (isPointe) qui est le rapprochement final en base GRC.
    const [lettrageFilter, setLettrageFilter] = useState<'non' | 'oui' | 'tous'>('non');
    
    // Filtres
    const [grcFilters, setGrcFilters] = useState<Record<string, {type: 'list'|'text'|'date', value: any}>>({});
    const [releveFilters, setReleveFilters] = useState<Record<string, {type: 'list'|'text'|'date', value: any}>>({});

    // Tris
    const [grcSort, setGrcSort] = useState<{key: string, desc: boolean} | null>(null);
    const [releveSort, setReleveSort] = useState<{key: string, desc: boolean} | null>(null);

    // Refs pour callbacks stables : évitent les stale-closures sans multiplier
    // les dépendances (et donc sans invalider React.memo des sous-composants).
    const selectedGrcIdRef = React.useRef<number | null>(null);
    const selectedReleveLigneIdRef = React.useRef<number | null>(null);
    const reglementsGrcRef = React.useRef<ReglementGrc[]>([]);
    const lignesReleveRef = React.useRef<LigneReleve[]>([]);
    const currentLettrageIndexRef = React.useRef(1);
    // TASK-106 — MV_ID des règlements appariés à une ligne du relevé affiché. Calculé sur lignesReleve COMPLET
    // (jamais sur la liste filtrée) : un filtre d'affichage ne doit pas rendre un règlement « réservé ailleurs ».
    // Déclaré avant tout useMemo/useCallback qui le cite (zone morte temporelle).
    const loadedMvIds = React.useMemo(() => {
        const s = new Set<number>();
        for (const l of lignesReleve) if (l.mvId != null) s.add(Number(l.mvId));
        return s;
    }, [lignesReleve]);
    // TASK-099 : ref vers showConfirm pour rendre handleAnnulerReglementGrc stable (deps=[])
    const showConfirmRef = React.useRef(showConfirm);
    const showToastRef = React.useRef(showToast);
    const fetchReglementsGrcRef = React.useRef<() => void>(() => {});

    // Séquencement des requêtes (TASK-079) : seule la réponse de la DERNIÈRE requête émise est appliquée,
    // protégeant contre les réponses réseau qui arrivent dans le désordre (ex: changement rapide de banque ou de période).
    const fetchGrcSeqRef = React.useRef(0);
    const fetchRelevesSeqRef = React.useRef(0);
    const fetchLignesReleveSeqRef = React.useRef(0);
    const refreshRelevesSeqRef = React.useRef(0);
    const isFetchingRelevesRef = React.useRef(false);
    // Synchronisation synchrone pendant le render (valeurs toujours à jour avant callbacks)
    selectedGrcIdRef.current = selectedGrcId;
    selectedReleveLigneIdRef.current = selectedReleveLigneId;
    reglementsGrcRef.current = reglementsGrc;
    lignesReleveRef.current = lignesReleve;
    currentLettrageIndexRef.current = currentLettrageIndex;
    showConfirmRef.current = showConfirm;
    showToastRef.current = showToast;

    // Columns
    const [selectedColumns, setSelectedColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('gocom_grc_columns');
        if (saved) {
            try {
                let cols = JSON.parse(saved) as string[];
                const validCols = cols.filter(c => availableColumns.some(ac => ac.key === c));
                if (validCols.length > 0) return Array.from(new Set(['lettrage', ...validCols.filter(c => c !== 'lettrage')]));
            } catch (e) {}
        }
        return ['lettrage', ...DEFAULT_COLUMNS];
    });

    React.useEffect(() => {
        localStorage.setItem('gocom_grc_columns', JSON.stringify(selectedColumns));
    }, [selectedColumns]);

    const [showColumnMenu, setShowColumnMenu] = useState(false);
    const [draggedCol, setDraggedCol] = useState<string | null>(null);

    const toggleColumn = (key: string) => setSelectedColumns(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    const handleDragStart = (e: React.DragEvent, colKey: string) => { setDraggedCol(colKey); e.dataTransfer.effectAllowed = 'move'; };
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

    // TASK-037 : la lettre de rapprochement est desormais CALCULEE et RENVOYEE par le serveur
    // (endpoint /reserve). getLettrageFromIndex / le compteur local ne decident plus de la lettre.
    // getIndexFromLettrage reste utilise a l'affichage (recalcul de l'index de depart au chargement).
    const getIndexFromLettrage = React.useCallback((lettrage: string): number => {
        if (!lettrage) return 0;
        let index = 0;
        for (const c of lettrage.toUpperCase()) {
            if (c < 'A' || c > 'Z') continue;
            index = index * 26 + (c.charCodeAt(0) - 65 + 1);
        }
        return index;
    }, []);

    React.useEffect(() => {
        const userStr = sessionStorage.getItem('gocom_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            if (user.societeId) {
                axios.get(`${API_BASE}/reference/banques?societeId=${user.societeId}`)
                    .then(res => {
                        setBanques(res.data);
                    })
                    .catch(err => console.error("Erreur chargement banques", err));
            }
        }
    }, []);

    // État modal Générer règlement (Versement)
    const [clients, setClients] = useState<Array<{ code: string; intitule: string; no: number }>>([]);
    const [loadingClients, setLoadingClients] = useState(false);
    const [modalLigne, setModalLigne] = useState<LigneReleve | null>(null);
    const [clientInputDisplay, setClientInputDisplay] = useState('');
    const [showClientSuggestions, setShowClientSuggestions] = useState(false);
    const [selectedClientCode, setSelectedClientCode] = useState('');
    const [selectedCaisseCode, setSelectedCaisseCode] = useState('');
    const [mvReference, setMvReference] = useState('');
    const [isSubmittingVersement, setIsSubmittingVersement] = useState(false);

    // TASK-064 — Mode adaptatif local/serveur selon le volume réel de clients ERP.
    // ≤ seuil : chargement complet + filtrage front (comportement historique).
    // > seuil : recherche serveur bornée et débouncée, aucun chargement massif côté front.
    const CLIENT_VOLUME_THRESHOLD = 500;
    const [clientSearchMode, setClientSearchMode] = useState<'local' | 'server'>('local');
    const [clientVolumeChecked, setClientVolumeChecked] = useState(false);
    const [serverSuggestions, setServerSuggestions] = useState<Array<{ code: string; intitule: string; no: number }>>([]);
    const [searchingServer, setSearchingServer] = useState(false);

    const handleOpenGenererModal = React.useCallback((row: LigneReleve) => {
        setModalLigne(row);
        setClientInputDisplay('');
        setShowClientSuggestions(false);
        setSelectedClientCode('');
        setServerSuggestions([]);
        setMvReference(row.reference || '');

        if (user?.caisses && user.caisses.length === 1) {
            const caisseId = user.caisses[0];
            if (caissesMap[caisseId]) {
                setSelectedCaisseCode(caissesMap[caisseId].code);
            }
        } else {
            setSelectedCaisseCode('');
        }

        // Mesure du volume réel une seule fois par session (le volume ERP ne varie pas en cours
        // de session) : bascule en mode serveur si le volume dépasse le seuil, sinon comportement
        // historique (chargement complet, mis en cache 10 min côté serveur).
        if (!clientVolumeChecked) {
            setLoadingClients(true);
            axios.get(`${API_BASE}/reference/clients/count`)
                .then(res => {
                    setClientVolumeChecked(true);
                    if (res.data.count > CLIENT_VOLUME_THRESHOLD) {
                        setClientSearchMode('server');
                        setLoadingClients(false);
                    } else {
                        setClientSearchMode('local');
                        axios.get(`${API_BASE}/reference/clients`)
                            .then(res2 => setClients(res2.data))
                            .catch(err => console.error('Erreur chargement clients', err))
                            .finally(() => setLoadingClients(false));
                    }
                })
                .catch(err => {
                    console.error('Erreur mesure volume clients', err);
                    setClientVolumeChecked(true);
                    setClientSearchMode('local');
                    axios.get(`${API_BASE}/reference/clients`)
                        .then(res2 => setClients(res2.data))
                        .catch(e => console.error('Erreur chargement clients', e))
                        .finally(() => setLoadingClients(false));
                });
        }
    }, [user, caissesMap, clientVolumeChecked]);

    // Combobox client : suggestions bornées à 30 résultats max dans le DOM.
    // Empêche la création de milliers de <li> à chaque frappe, source du gel de rendu.
    const MAX_CLIENT_SUGGESTIONS = 30;

    // Mode serveur : recherche débouncée (250 ms) via /reference/clients/search,
    // déjà bornée côté back (voir ReglementGenerationService.SearchClients).
    React.useEffect(() => {
        if (clientSearchMode !== 'server') return;
        const term = clientInputDisplay.trim();
        if (!term) {
            setServerSuggestions([]);
            setSearchingServer(false);
            return;
        }
        setSearchingServer(true);
        const handle = setTimeout(() => {
            axios.get(`${API_BASE}/reference/clients/search`, { params: { q: term, max: MAX_CLIENT_SUGGESTIONS } })
                .then(res => setServerSuggestions(res.data))
                .catch(err => console.error('Erreur recherche clients', err))
                .finally(() => setSearchingServer(false));
        }, 250);
        return () => clearTimeout(handle);
    }, [clientSearchMode, clientInputDisplay]);

    const clientSuggestions = React.useMemo(() => {
        if (clientSearchMode === 'server') return serverSuggestions;
        const term = clientInputDisplay.toLowerCase().trim();
        if (!term) return clients.slice(0, MAX_CLIENT_SUGGESTIONS);
        return clients
            .filter(c =>
                (c.code || '').toLowerCase().includes(term) ||
                (c.intitule || '').toLowerCase().includes(term)
            )
            .slice(0, MAX_CLIENT_SUGGESTIONS);
    }, [clients, clientInputDisplay, clientSearchMode, serverSuggestions]);

    const userCaissesOptions = React.useMemo(() => {
        if (!user?.caisses) return [];
        return user.caisses.map((id: number) => caissesMap[id]).filter(Boolean);
    }, [user, caissesMap]);

    const fetchReglementsGrc = React.useCallback(() => {
        const seq = ++fetchGrcSeqRef.current;
        if (!selectedBanqueId) {
            setReglementsGrc([]);
            setLoadingGrc(false);
            return;
        }

        const userStr = sessionStorage.getItem('gocom_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            setLoadingGrc(true);
            const caissesStr = user.caisses ? user.caisses.join(',') : '';
            const dateParams = `${appliedDateDebut ? `&dateDebut=${appliedDateDebut}` : ''}${appliedDateFin ? `&dateFin=${appliedDateFin}T23:59:59` : ''}`;
            axios.get(`${API_BASE}/reglements?societeId=${user.societeId}&caisses=${caissesStr}&banqueNos=${selectedBanqueId}&page=1&pageSize=1000&pointe=false&eligibleRappBancaire=true${dateParams}`)
                .then(res => {
                    if (seq !== fetchGrcSeqRef.current) return;
                    setReglementsGrc(res.data.items.map((r: any) => ({
                        ...r,
                        mv_Id: r.no,
                        lettrage: r.lettrage || null,
                        releveEnteteId: r.releveEnteteId ?? null,
                        reservePar_UserId: r.reservePar_UserId,
                        reservePar_UserName: r.reservePar_UserName,
                        dateReservation: r.dateReservation
                    })));
                })
                .catch(err => {
                    if (seq !== fetchGrcSeqRef.current) return;
                    console.error(err);
                })
                .finally(() => {
                    if (seq === fetchGrcSeqRef.current) setLoadingGrc(false);
                });
        } else {
            setLoadingGrc(false);
        }
    }, [selectedBanqueId, appliedDateDebut, appliedDateFin]);

    React.useEffect(() => {
        fetchReglementsGrcRef.current = fetchReglementsGrc;
        fetchReglementsGrc();
    }, [fetchReglementsGrc]);

    // TASK-099 — Annulation de règlement depuis la grille GRC.
    // Copie fidèle de handleAnnulerReglement (App.tsx:665), suivie d'un rechargement de la grille GRC.
    // Référence stable (deps=[]) : lit showConfirmRef / showToastRef / fetchReglementsGrcRef pour
    // éviter les stale closures sans recréer le callback à chaque rendu (mémoïsation des lignes).
    const handleAnnulerReglementGrc = React.useCallback((reg: ReglementGrc) => {
        showConfirmRef.current(
            `Voulez-vous vraiment annuler le règlement [${reg.mv_Id}] d'un montant de ${formatMoney(reg.montant)} ? Cette opération est irréversible.`,
            async () => {
                try {
                    await axios.post(`${API_BASE}/reglements/${reg.mv_Id}/annuler`);
                    showToastRef.current(`Règlement [${reg.mv_Id}] annulé avec succès.`, 'success');
                    // S5 : réinitialiser la sélection si le règlement annulé était sélectionné
                    if (selectedGrcIdRef.current === reg.mv_Id) {
                        setSelectedGrcId(null);
                    }
                    fetchReglementsGrcRef.current();
                } catch (err: any) {
                    const msg = err.response?.data?.message || err.response?.data?.title || err.response?.data || 'Erreur lors de l\'annulation du règlement.';
                    showToastRef.current(typeof msg === 'string' ? msg : JSON.stringify(msg), 'error');
                }
            }
        );
    }, []);

    const handleConfirmGenererVersement = async () => {
        if (!modalLigne || !selectedClientCode || !selectedCaisseCode) return;
        setIsSubmittingVersement(true);
        try {
            const res = await axios.post(`${API_BASE}/ReleveBancaire/generer-reglement`, {
                ligneReleveId: modalLigne.id,
                clientCode: selectedClientCode,
                caisseCode: selectedCaisseCode,
                mvReference: mvReference
            });

            if (res.data.success) {
                showToast(`Règlement ${res.data.reglementNumero} généré avec succès ! Relancez l'auto-rapprochement pour lettrer la ligne.`, 'success');
                setModalLigne(null);
                fetchReglementsGrc();
            } else {
                showToast(res.data.erreur || 'Erreur lors de la génération du règlement.', 'error');
            }
        } catch (err: any) {
            console.error(err);
            const msg = err.response?.data?.erreur || err.response?.data?.message || err.message || 'Erreur lors de la génération.';
            showToast(msg, 'error');
        } finally {
            setIsSubmittingVersement(false);
        }
    };

    // TASK-100 : remise à zéro des sélections et des filtres « Repère » / « Relevé » (changement de banque ou de sélection).
    // Retourne `prev` si rien à retirer, pour ne pas provoquer de rendus inutiles.
    const resetSelectionEtFiltres = () => {
        setSelectedGrcId(null);
        setSelectedReleveLigneId(null);
        setPendingReservation(null);
        setReleveFilters(prev => { if (!prev.lettrage && !prev.releveEnteteId) return prev; const next = { ...prev }; delete next.lettrage; delete next.releveEnteteId; return next; });
        setGrcFilters(prev => { if (!prev.lettrage) return prev; const next = { ...prev }; delete next.lettrage; return next; });
    };

    // Chargement des relevés bancaires — dépend uniquement de la banque (indépendant de la période)
    React.useEffect(() => {
        const seq = ++fetchRelevesSeqRef.current;
        // Invalider toute requête de lignes en vol de l'ancienne sélection
        fetchLignesReleveSeqRef.current++;

        if (!selectedBanqueId) {
            isFetchingRelevesRef.current = false;
            setReleves([]);
            setSelectedReleveIds([]);
            resetSelectionEtFiltres();
            setLignesReleve([]);
            setLoadingReleve(false);
            return;
        }

        isFetchingRelevesRef.current = true;
        setSelectedReleveIds([]);
        resetSelectionEtFiltres();
        setLignesReleve([]);
        setLoadingReleve(true);

        axios.get(`${API_BASE}/ReleveBancaire?banqueId=${selectedBanqueId}&nonRapprochesSeulement=true`)
            .then(res => {
                if (seq !== fetchRelevesSeqRef.current) return;
                isFetchingRelevesRef.current = false;
                setReleves(res.data);
                if (res.data && res.data.length > 0) {
                    setSelectedReleveIds([res.data[0].id]);
                } else {
                    setSelectedReleveIds([]);
                    setLignesReleve([]);
                    setLoadingReleve(false);
                }
            })
            .catch(err => {
                if (seq !== fetchRelevesSeqRef.current) return;
                isFetchingRelevesRef.current = false;
                console.error(err);
                setLoadingReleve(false);
            });
    }, [selectedBanqueId]);

    // TASK-100 : une seule requête pour l'union des relevés cochés (tout ou rien), un seul jeton de séquence.
    React.useEffect(() => {
        const seq = ++fetchLignesReleveSeqRef.current;
        resetSelectionEtFiltres();
        if (selectedReleveIds.length === 0) {
            setLignesReleve([]);
            if (!isFetchingRelevesRef.current) {
                setLoadingReleve(false);
            }
            return;
        }

        setLoadingReleve(true);
        axios.post(`${API_BASE}/ReleveBancaire/lignes`, { releveBancaireEnteteIds: [...selectedReleveIds].sort((a, b) => a - b) })
            .then(res => {
                if (seq !== fetchLignesReleveSeqRef.current) return;
                setLignesReleve(res.data.map((l: any) => ({
                    id: l.id,
                    dateOperation: new Date(l.dateOperation).toLocaleDateString(),
                    dateOperationRaw: l.dateOperation,
                    dateValeur: new Date(l.dateValeur).toLocaleDateString(),
                    dateValeurRaw: l.dateValeur,
                    libelle: l.libelle,
                    reference: l.reference || '',
                    code: l.code || '',
                    credit: l.credit,
                    lettrage: l.lettrage || null,
                    reservePar_UserId: l.reservePar_UserId,
                    reservePar_UserName: l.reservePar_UserName,
                    dateReservation: l.dateReservation,
                    releveEnteteId: l.releveBancaireEnteteId,
                    mvId: l.mV_ID ?? null
                })));
            })
            .catch(err => {
                if (seq !== fetchLignesReleveSeqRef.current) return;
                console.error(err);
                setLignesReleve([]);
                showToast(err.response?.status === 403 ? "Accès refusé à l'un des relevés sélectionnés." : "Impossible de charger les lignes des relevés sélectionnés.", 'error');
            })
            .finally(() => {
                if (seq === fetchLignesReleveSeqRef.current) setLoadingReleve(false);
            });

    }, [selectedReleveIdsKey]);

    // Recalculer l'index de départ du lettrage quand le relevé est chargé
    React.useEffect(() => {
        const existingLettrages = lignesReleve
            .map(l => l.lettrage)
            .filter(Boolean) as string[];
        if (existingLettrages.length > 0) {
            const maxIndex = Math.max(...existingLettrages.map(getIndexFromLettrage));
            setCurrentLettrageIndex(maxIndex + 1);
        } else {
            setCurrentLettrageIndex(1);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lignesReleve.length]);

    const handleAutoReconcile = async () => {
        if (selectedReleveIds.length === 0) {
            showToast("Veuillez sélectionner un relevé bancaire.", "warning");
            return;
        }
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const user = userStr ? JSON.parse(userStr) : {};
            // Même périmètre que la grille GRC : les dates appliquées (Du/Au)
            const response = await axios.post(`${API_BASE}/ReleveBancaire/auto-reconcile`, {
                releveBancaireEnteteIds: selectedReleveIds,
                banqueId: selectedBanqueId ?? 0,
                dateDebut: appliedDateDebut || null,
                dateFin: appliedDateFin ? `${appliedDateFin}T23:59:59` : null
            }, {
                headers: { Authorization: `Bearer ${user.token}` }
            });

            const propositions: Array<{ ligneReleveId: number; reglementGrcId: number; montant: number; lettragePropose: string }> = response.data;

            if (propositions.length === 0) {
                showToast("Aucune correspondance parfaite trouvée (1=1 sur le montant).", "warning");
                return;
            }

            // TASK-037 : plus de pre-generation de lettre cote client. /reserve-batch calcule et
            // renvoie atomiquement la lettre attribuee cote serveur (verrou par releve + UPDATE
            // conditionnel) => lettres distinctes garanties, meme pour un lot.
            // TASK-066 : un seul aller-retour HTTP pour tout le lot (au lieu d'un POST /reserve par proposition).
            const batchResp = await axios.post(`${API_BASE}/ReleveBancaire/reserve-batch`,
                propositions.map(p => ({ ligneReleveId: p.ligneReleveId, mvId: p.reglementGrcId })),
                { headers: { Authorization: `Bearer ${user.token}` } }
            );
            const batchResults: Array<{ ligneReleveId: number; mvId: number; success: boolean; lettrage: string | null }> = batchResp.data;

            const validProps: Array<{ ligneReleveId: number; reglementGrcId: number; assignedLetter: string }> = [];
            let conflits = 0;
            for (const r of batchResults) {
                if (r.success) {
                    validProps.push({ ligneReleveId: r.ligneReleveId, reglementGrcId: r.mvId, assignedLetter: r.lettrage! });
                } else {
                    conflits++;
                }
            }

            const currentUserId = userStr ? JSON.parse(userStr).no : 0;

            // Appliquer les propositions validées aux deux grilles avec la lettre RENVOYEE par le serveur,
            // matchée par Id de ligne (relevé) / MV_ID (règlement GRC).
            // TASK-106 : Map (id → paire) plutôt que des find imbriqués ; mvId posé sur la ligne, releveEnteteId sur le règlement.
            const propByLigne = new Map(validProps.map(p => [p.ligneReleveId, p]));
            const propByMv = new Map(validProps.map(p => [p.reglementGrcId, p]));
            const enteteByLigne = new Map(lignesReleveRef.current.map(l => [l.id, l.releveEnteteId]));
            setLignesReleve(prev => prev.map(l => {
                const match = propByLigne.get(l.id);
                return match ? { ...l, lettrage: match.assignedLetter, reservePar_UserId: currentUserId, mvId: match.reglementGrcId } : l;
            }));
            setReglementsGrc(prev => prev.map(r => {
                const match = propByMv.get(r.mv_Id);
                return match ? { ...r, lettrage: match.assignedLetter, reservePar_UserId: currentUserId, releveEnteteId: enteteByLigne.get(match.ligneReleveId) ?? null } : r;
            }));

            if (conflits > 0) {
                showToast(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`, "success");
            } else {
                showToast(`💡 L'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`, "success");
            }
        } catch (error) {
            console.error("Erreur auto-reconcile", error);
            showToast("Erreur lors de l'auto-rapprochement.", "error");
        }
    };


    // Libère UNE ligne lettrée du relevé affiché et le règlement de même MV_ID (appariement par identifiant, jamais par lettre).
    // TASK-106 : remplace delettrerByLettrage. Callback stable (deps=[]) : setters, showToast et valeurs passées en argument.
    const delettrerLigne = React.useCallback(async (ligne: LigneReleve) => {
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const resp = await axios.post(`${API_BASE}/ReleveBancaire/release-batch`,
                [{ ligneReleveId: ligne.id }], { headers: { Authorization: `Bearer ${token}` } });
            const ok = (resp.data as Array<{ ligneReleveId: number; success: boolean }>)
                .some(r => r.ligneReleveId === ligne.id && r.success);
            if (ok) {
                setLignesReleve(prev => prev.map(l => l.id === ligne.id
                    ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null, mvId: null } : l));
                if (ligne.mvId != null) {
                    setReglementsGrc(prev => prev.map(r => r.mv_Id === ligne.mvId
                        ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null, releveEnteteId: null } : r));
                }
            } else {
                showToast("Impossible de libérer la ligne (déjà libre, validée ou non autorisé).", "warning");
            }
        } catch (e) { console.error(e); showToast("Erreur lors de la dissociation.", "error"); }
    }, []);

    // Lettrage manuel — lit les refs (valeurs fraîches) pour éviter les stale closures
    // tout en gardant une référence stable (n'invalidera pas React.memo des grilles).
    const executeManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const currentUserId = userStr ? JSON.parse(userStr).no : 0;

            // TASK-037 : on n'envoie plus de lettre ; le serveur calcule et renvoie la lettre attribuee.
            const resp = await axios.post(`${API_BASE}/ReleveBancaire/reserve`, {
                ligneReleveId: ligneId,
                mvId: grcId
            }, { headers: { Authorization: `Bearer ${token}` } });

            const assignedLetter: string = resp.data?.lettrage;

            const ligne = lignesReleveRef.current.find(l => l.id === ligneId);
            setReglementsGrc(prev => prev.map(r => r.mv_Id === grcId ? { ...r, lettrage: assignedLetter, reservePar_UserId: currentUserId, releveEnteteId: ligne?.releveEnteteId ?? null } : r));
            setLignesReleve(prev => prev.map(l => l.id === ligneId ? { ...l, lettrage: assignedLetter, reservePar_UserId: currentUserId, mvId: grcId } : l));
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
    }, []);

    const applyManualLettrage = React.useCallback((grcId: number, ligneId: number) => {
        const grc = reglementsGrcRef.current.find(r => r.mv_Id === grcId);
        const releve = lignesReleveRef.current.find(r => r.id === ligneId);

        if (grc?.montant !== releve?.credit) {
            setPendingReservation({ grcId, ligneId });
            return;
        }
        executeManualLettrage(grcId, ligneId);
    }, [executeManualLettrage]);

    // TASK-090 — Correction du montant du règlement avec celui de la ligne de relevé puis lettrage
    const handleUpdateMontantAndLettrer = React.useCallback(async (grcId: number, ligneId: number) => {
        const releve = lignesReleveRef.current.find(l => l.id === ligneId);
        if (!releve) {
            showToast("Ligne de relevé introuvable.", "error");
            setPendingReservation(null);
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
            return;
        }

        const nouveauMontant = releve.credit;
        setIsUpdatingMontant(true);

        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

            // N'envoyer STRICTEMENT que la clé montant dans le corps JSON (pas reference/date/banqueNo)
            // pour ne pas écraser d'autres champs (ex: reference existante vidée si chaîne vide envoyée).
            await axios.put(`${API_BASE}/reglements/${grcId}`, {
                montant: nouveauMontant
            }, { headers });

            // Rafraîchir l'affichage du règlement dans la grille GRC de l'écran
            setReglementsGrc(prev => prev.map(r => r.mv_Id === grcId ? { ...r, montant: nouveauMontant } : r));

            // Enchaîner avec la réservation / le lettrage manuel
            await executeManualLettrage(grcId, ligneId);
        } catch (error: any) {
            const msg = error.response?.data?.message || error.response?.data?.title || error.message || "Erreur lors de la mise à jour du montant du règlement.";
            showToast(typeof msg === 'string' ? msg : JSON.stringify(msg), "error");
            setPendingReservation(null);
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        } finally {
            setIsUpdatingMontant(false);
        }
    }, [executeManualLettrage, showToast]);

    // handleSelectGrc — ref pour selectedReleveLigneId : la référence du callback
    // reste stable même quand la sélection du relevé change => GrcTableBody ne re-rend pas.
    const handleSelectGrc = React.useCallback((grcId: number) => {
        // console.log(`[ACTION] handleSelectGrc(${grcId})`);
        // console.time(`SelectGrc-${grcId}`);
        // grcRowRenderCount = 0;
        // releveRowRenderCount = 0;
        
        const grc = reglementsGrcRef.current.find(r => r.mv_Id === grcId);
        // Clic sur une ligne déjà lettrée -> on délettre la paire
        if (grc?.lettrage) {
            // TASK-106 : ligne appariée par MV_ID ; aucune ligne chargée ⇒ « réservé ailleurs » ⇒ rien
            const ligne = lignesReleveRef.current.find(l => l.mvId === grc.mv_Id);
            if (ligne) delettrerLigne(ligne);
            // console.timeEnd(`SelectGrc-${grcId}`);
            return;
        }
        if (selectedReleveLigneIdRef.current != null) {
            applyManualLettrage(grcId, selectedReleveLigneIdRef.current);
        } else {
            setSelectedGrcId(prev => (prev === grcId ? null : grcId));
        }
        // console.timeEnd(`SelectGrc-${grcId}`);
        // setTimeout(() => console.log(`[STATS] GrcRows Rendered: ${grcRowRenderCount}, ReleveRows Rendered: ${releveRowRenderCount}`), 100);
    }, [delettrerLigne, applyManualLettrage]);

    // handleSelectReleve — ref pour selectedGrcId : même principe.
    const handleSelectReleve = React.useCallback((ligneId: number) => {
        // console.log(`[ACTION] handleSelectReleve(${ligneId})`);
        // console.time(`SelectReleve-${ligneId}`);
        // grcRowRenderCount = 0;
        // releveRowRenderCount = 0;

        const rel = lignesReleveRef.current.find(l => l.id === ligneId);
        if (rel?.lettrage) {
            delettrerLigne(rel);
            // console.timeEnd(`SelectReleve-${ligneId}`);
            return;
        }
        if (selectedGrcIdRef.current != null) {
            applyManualLettrage(selectedGrcIdRef.current, ligneId);
        } else {
            setSelectedReleveLigneId(prev => (prev === ligneId ? null : ligneId));
        }
        // console.timeEnd(`SelectReleve-${ligneId}`);
        // setTimeout(() => console.log(`[STATS] GrcRows Rendered: ${grcRowRenderCount}, ReleveRows Rendered: ${releveRowRenderCount}`), 100);
    }, [delettrerLigne, applyManualLettrage]);

    // Retire TOUS les lettrages en attente (non encore approuvés) des 2 grilles
    // TASK-066 : un seul appel release-batch au lieu d'une boucle séquentielle N appels /release.
    // Traitement indépendant par ligne : seules les lignes confirmées par le serveur sont libérées.
    const handleDelettrerTout = async () => {
        const userStr = sessionStorage.getItem('gocom_user');
        const token = userStr ? JSON.parse(userStr).token : '';
        const currentUserId = userStr ? JSON.parse(userStr).no : 0;
        
        const lignesToRelease = lignesReleveRef.current.filter(l => l.lettrage && (!l.reservePar_UserId || Number(l.reservePar_UserId) === Number(currentUserId)));
        if (lignesToRelease.length === 0) return;
        
        try {
            const resp = await axios.post(`${API_BASE}/ReleveBancaire/release-batch`,
                lignesToRelease.map(l => ({ ligneReleveId: l.id })),
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const results: Array<{ ligneReleveId: number; success: boolean }> = resp.data;
            const releasedIds = new Set(results.filter(r => r.success).map(r => r.ligneReleveId));
            // TASK-106 : les règlements libérés = ceux dont la LIGNE l'a été (même MV_ID), jamais par lettre
            const releasedMvIds = new Set(lignesToRelease.filter(l => releasedIds.has(l.id) && l.mvId != null).map(l => Number(l.mvId)));
            setLignesReleve(prev => prev.map(l => releasedIds.has(l.id) ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null, mvId: null } : l));
            setReglementsGrc(prev => prev.map(r => releasedMvIds.has(r.mv_Id) ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null, releveEnteteId: null } : r));
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);

            const failedCount = results.length - releasedIds.size;
            if (failedCount > 0) {
                showToast(`Dissociation : ${releasedIds.size} ligne(s) libérée(s), ${failedCount} échec(s).`, "warning");
            }
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la dissociation globale.", "error");
        }
    };

    // TASK-100 : relit la liste des relevés après une approbation (un relevé 100 % approuvé disparaît du combo).
    // Compteur DÉDIÉ, et vérification de la banque au retour (ne jamais écraser la liste d'une autre banque).
    const refreshReleves = React.useCallback(() => {
        const banque = selectedBanqueIdRef.current;
        if (!banque || isFetchingRelevesRef.current) return;
        const seq = ++refreshRelevesSeqRef.current;
        axios.get(`${API_BASE}/ReleveBancaire?banqueId=${banque}&nonRapprochesSeulement=true`)
            .then(res => {
                if (seq !== refreshRelevesSeqRef.current || banque !== selectedBanqueIdRef.current) return;
                const liste = res.data || [];
                setReleves(liste);
                setSelectedReleveIds(prev => { const next = prev.filter(id => liste.some((r: any) => r.id === id)); return next.length === prev.length ? prev : next; });
            })
            .catch(err => console.error(err));
    }, []);

    const handleApprouver = async () => {
        // TASK-106 : appariement par MV_ID ; seules MES réservations sont envoyées, seules les paires APPROUVÉES sont retirées.
        const currentUserId = Number(user?.no) || 0;
        const grcParMvId = new Map(reglementsGrc.map(r => [Number(r.mv_Id), r]));
        const candidates = lignesReleve.filter(l => l.lettrage && l.mvId != null && (!l.reservePar_UserId || Number(l.reservePar_UserId) === currentUserId));
        const pairs: any[] = [];
        const sansReglement: number[] = [];

        for (const ligne of candidates) {
            const grc = grcParMvId.get(Number(ligne.mvId));
            if (grc) {
                pairs.push({
                    releveLigneId: ligne.id,
                    grcReglementId: grc.mv_Id,
                    lettrage: ligne.lettrage,
                    codeExcel: ligne.code || 'MANUAL',
                    libelle: ligne.libelle,
                    dateValeur: ligne.dateValeurRaw
                });
            } else {
                sansReglement.push(ligne.id);
            }
        }
        const msgSansReglement = `${sansReglement.length} ligne(s) réservée(s) n'ont pas de règlement dans la grille GRC (période ou filtre) : élargissez la période Du/Au puis réessayez.`;

        if (pairs.length === 0) {
            showToast(sansReglement.length > 0 ? msgSansReglement : "Aucun rapprochement en cours à approuver.", "warning");
            return;
        }

        try {
            const response = await axios.post(`${API_BASE}/ReleveBancaire/validate`, pairs);
            const data = response.data;

            const failed = new Set<number>(data.failedLigneIds || []);
            const approuvees = pairs.filter(p => !failed.has(p.releveLigneId));
            const idsApprouves = new Set<number>(approuvees.map(p => p.releveLigneId));
            const mvApprouves = new Set<number>(approuvees.map(p => Number(p.grcReglementId)));
            setLignesReleve(prev => prev.filter(l => !idsApprouves.has(l.id)));
            setReglementsGrc(prev => prev.filter(r => !mvApprouves.has(Number(r.mv_Id))));
            if (approuvees.length > 0) refreshReleves();

            // Toast unique (3 s) : le message « sans règlement » est ajouté au résultat, jamais un second showToast.
            const suffixe = sansReglement.length > 0 ? `\n\n${msgSansReglement}` : '';
            if (data.success) {
                showToast("Rapprochement validé avec succès !" + suffixe, sansReglement.length > 0 ? "warning" : "success");
            } else {
                showToast(`Validation terminée avec des erreurs.\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\n\nErreurs:\n${data.errors.join('\n')}` + suffixe, "warning");
            }
        } catch (error: any) {
            console.error("Erreur de validation", error);
            const errorData = error.response?.data;
            let message = "Erreur lors de la validation du rapprochement.";
            if (errorData) {
                if (typeof errorData === 'string') message = errorData;
                else if (errorData.message) message = errorData.message + (errorData.errors ? '\n' + errorData.errors.join('\n') : '');
                else message = JSON.stringify(errorData);
            }
            showToast(message, "error");
        }
    };

    const chargerDonneesSimulees = () => {
        // Obsolete
    };


    const getGrcCellValue = (r: any, key: string) => {
        if (key === 'caisseCode') return caissesMap[r.caisseNo] ? caissesMap[r.caisseNo].code : String(r.caisseNo);
        if (key === 'caisseIntitule') return caissesMap[r.caisseNo] ? caissesMap[r.caisseNo].intitule : '';
        if (key === 'mode') return modesMap[r.modeReglementNo] ? `${modesMap[r.modeReglementNo].code} - ${modesMap[r.modeReglementNo].intitule}` : String(r.modeReglementNo);
        if (key === 'typeReglement') {
            const typeNo = modesMap[r.modeReglementNo]?.typeNo;
            if (typeNo === 0) return 'Espèce';
            if (typeNo === 1) return 'Chèque';
            if (typeNo === 2) return 'Traite';
            if (typeNo === 3) return 'Virement';
            if (typeNo === 4) return 'Carte Bancaire';
            return 'Autre';
        }
        if (key === 'pointe') return (r.isPointe || !!r.lettrage) ? 'OUI' : 'NON';
        if (key === 'comptabilise') return r.isComptabilise > 0 ? 'OUI' : 'NON';
        if (key === 'remis') return r.isRemis > 0 ? 'OUI' : 'NON';
        if (key === 'impaye') return r.isImpaye > 0 ? 'OUI' : 'NON';
        if (key === 'annule') return r.isAnnule ? 'OUI' : 'NON';
        if (key === 'client') return r.clientIntitule;
        if (key === 'piece') return r.pieceNumero;
        if (key === 'extrait') return r.extraitNum;
        if (key === 'montant') return r.montantDeviseSociete || r.montant;
        if (key === 'solde') return r.soldeDeviseSociete;
        if (key === 'lettrage') return formatRepere(r.releveEnteteId, r.lettrage, showPrefix || (!!r.lettrage && !loadedMvIds.has(r.mv_Id)));
        return r[key as keyof typeof r];
    };

    // Filtre "lettrés" (front uniquement) : une ligne n'est considérée lettrée que si
    // son lettrage existe des DEUX côtés (règlement GRC apparié avec une ligne relevé).
    // Indépendant de isPointe (rapprochement final en base).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const pairedLettrages = React.useMemo(() => {
        const grcLettrages = new Set(reglementsGrc.map(r => r.lettrage).filter(Boolean));
        const releveLettrages = new Set(lignesReleve.map(l => l.lettrage).filter(Boolean));
        return new Set([...grcLettrages].filter(x => releveLettrages.has(x)));
    }, [reglementsGrc, lignesReleve]);

    const isPaired = React.useCallback(
        (lettrage: string | null) => !!lettrage && pairedLettrages.has(lettrage),
        [pairedLettrages]
    );

    const filteredReglements = React.useMemo(() => reglementsGrc.filter(r => {
        if (lettrageFilter === 'oui' && !r.lettrage) return false;
        for (const [key, filter] of Object.entries(grcFilters)) {
            const val = getGrcCellValue(r, key);
            if (filter.type === 'list' && Array.isArray(filter.value) && filter.value.length > 0) {
                if (!filter.value.includes(String(val))) return false;
            } else if (filter.type === 'text' && filter.value) {
                if (key === 'montant' || key === 'solde') {
                    if (!matchAmount(val, filter.value)) return false;
                } else {
                    if (!(val || '').toString().toLowerCase().includes(filter.value.toLowerCase())) return false;
                }
            } else if (filter.type === 'date' && filter.value) {
                // TASK-102 : plage Du/Au sur la date brute yyyy-mm-dd (pas de chaîne localisée, pas de new Date)
                if (!matchDateRange(r.date, filter.value)) return false;
            }
        }
        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [reglementsGrc, lettrageFilter, grcFilters, isPaired, loadedMvIds, showPrefix]);

    const filteredLignes = React.useMemo(() => lignesReleve.filter(l => {
        // Partie Encaissement : n'afficher que les lignes en crédit (credit > 0)
        if (!(Number(l.credit) > 0)) return false;
        if (lettrageFilter === 'oui' && !l.lettrage) return false;
        for (const [key, filter] of Object.entries(releveFilters)) {
            if (filter.type === 'list' && Array.isArray(filter.value) && filter.value.length > 0) {
                const affiche = key === 'lettrage' ? formatRepere(l.releveEnteteId, l.lettrage, showPrefix) : String(l[key as keyof LigneReleve]);
                if (!filter.value.includes(affiche)) return false;
            } else if (filter.type === 'text' && filter.value) {
                if (key === 'credit') {
                    if (!matchAmount(l.credit, filter.value)) return false;
                } else {
                    if (!(l[key as keyof LigneReleve] || '').toString().toLowerCase().includes(filter.value.toLowerCase())) return false;
                }
            } else if (filter.type === 'date' && filter.value) {
                // TASK-102 : plage Du/Au sur la date brute yyyy-mm-dd
                const raw = key === 'dateValeur' ? l.dateValeurRaw : (l.dateOperationRaw ?? l.dateOperation);
                if (!matchDateRange(raw, filter.value)) return false;
            }
        }
        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [lignesReleve, lettrageFilter, releveFilters, isPaired, showPrefix]);

    const sortedReglements = React.useMemo(() => [...filteredReglements].sort((a, b) => {
        // TASK-106 : rang 0 = apparié ici, 1 = réservé ailleurs, 2 = libre
        const rangA = a.lettrage ? (loadedMvIds.has(a.mv_Id) ? 0 : 1) : 2;
        const rangB = b.lettrage ? (loadedMvIds.has(b.mv_Id) ? 0 : 1) : 2;
        if (rangA !== rangB) return rangA - rangB;
        if (rangA < 2) { const c = comparePairKey(a, b); if (c !== 0) return c; }
        if (!grcSort) return 0;
        const valA = getGrcCellValue(a, grcSort.key);
        const valB = getGrcCellValue(b, grcSort.key);
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
            return grcSort.desc ? valB - valA : valA - valB;
        }
        if (grcSort.key === 'date') {
            const timeA = new Date(valA).getTime();
            const timeB = new Date(valB).getTime();
            if (!isNaN(timeA) && !isNaN(timeB)) {
                return grcSort.desc ? timeB - timeA : timeA - timeB;
            }
        }
        return grcSort.desc ? String(valB).localeCompare(String(valA)) : String(valA).localeCompare(String(valB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [filteredReglements, grcSort, loadedMvIds, showPrefix]);

    const sortedLignes = React.useMemo(() => [...filteredLignes].sort((a, b) => {
        const aL = !!a.lettrage, bL = !!b.lettrage;
        if (aL !== bL) return aL ? -1 : 1;
        if (aL && bL) { const c = comparePairKey(a, b); if (c !== 0) return c; }
        if (!releveSort) return 0;
        if (releveSort.key === 'lettrage') { const c = comparePairKey(a, b); return releveSort.desc ? -c : c; }
        const valA = (a as any)[releveSort.key];
        const valB = (b as any)[releveSort.key];
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
            return releveSort.desc ? valB - valA : valA - valB;
        }
        return releveSort.desc ? String(valB).localeCompare(String(valA)) : String(valA).localeCompare(String(valB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [filteredLignes, releveSort, showPrefix]);

    // Mémoïsation des options de filtre GRC (indexées par colonne) pour éviter
    // de recalculer pour toutes les colonnes à chaque re-render (sélection de ligne, etc.)
    const grcFilterOptionsMap = React.useMemo(() => {
        const map: Record<string, {label: string, value: string}[] | undefined> = {};
        for (const col of [{key: 'lettrage'}, ...availableColumns]) {
            const key = col.key;
            if (key === 'date' || key === 'montant' || key === 'solde') { map[key] = undefined; continue; }
            const unique = Array.from(new Set(reglementsGrc.map(r => getGrcCellValue(r, key)))).filter(val => val !== null && val !== undefined && val !== '');
            map[key] = unique.map(u => ({label: String(u), value: String(u)})).sort((a,b) => a.label.localeCompare(b.label));
        }
        return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reglementsGrc, availableColumns, loadedMvIds, showPrefix]);

    const getGrcFilterOptions = React.useCallback((key: string) => {
        return grcFilterOptionsMap[key];
    }, [grcFilterOptionsMap]);

    // Mémoïsation des options de filtre relevé
    const releveFilterOptionsMap = React.useMemo(() => {
        const keys: (keyof LigneReleve)[] = ['libelle', 'reference', 'code'];
        const map: Record<string, {label: string, value: string}[] | undefined> = {};
        for (const key of keys) {
            const unique = Array.from(new Set(lignesReleve.map(l => l[key]))).filter(Boolean);
            map[key] = unique.map(u => ({label: String(u), value: String(u)})).sort((a,b) => a.label.localeCompare(b.label));
        }
        // TASK-100 : repères = valeurs AFFICHÉES (préfixées si > 1 relevé), triées par (relevé, lettre) et non en texte.
        const couples = new Map<string, any>();
        lignesReleve.forEach(l => { if (l.lettrage) couples.set(`${l.releveEnteteId}|${l.lettrage}`, l); });
        const repOptions = Array.from(new Set([...couples.values()].sort(comparePairKey).map(l => formatRepere(l.releveEnteteId, l.lettrage, showPrefix))));
        map['lettrage'] = repOptions.map(v => ({label: v, value: v}));
        const ids = Array.from(new Set(lignesReleve.map(l => l.releveEnteteId))).filter(id => id != null).sort((a, b) => a - b);
        map['releveEnteteId'] = ids.map(id => ({label: releveLabels[id] ?? `Relevé #${id}`, value: String(id)}));
        return map;
    }, [lignesReleve, showPrefix, releveLabels]);

    const getReleveFilterOptions = React.useCallback((key: keyof LigneReleve) => {
        if (key === 'dateOperation' || key === 'dateValeur' || key === 'credit') return undefined;
        return releveFilterOptionsMap[key];
    }, [releveFilterOptionsMap]);

    const handleGrcSort = (key: string) => {
        setGrcSort(prev => prev?.key === key ? {key, desc: !prev.desc} : {key, desc: false});
    };

    const handleReleveSort = (key: string) => {
        setReleveSort(prev => prev?.key === key ? {key, desc: !prev.desc} : {key, desc: false});
    };

    const renderSortIcon = (sortState: {key: string, desc: boolean} | null, key: string) => {
        if (sortState?.key !== key) return null;
        return sortState.desc ? <ArrowDown size={14} style={{marginLeft: '4px', display: 'inline'}} /> : <ArrowUp size={14} style={{marginLeft: '4px', display: 'inline'}} />;
    };

    return (
        <div className="rapprochement-container">
            <header className="rappro-toolbar">
                <h2 className="rappro-title">Rapprochement bancaire</h2>

                <div className="toolbar-group">
                    <select
                        className="toolbar-select"
                        value={selectedBanqueId}
                        onChange={(e) => setSelectedBanqueId(e.target.value ? Number(e.target.value) : '')}
                    >
                        <option value="">Banque…</option>
                        {banques.map(b => (
                            <option key={b.id} value={b.id}>{b.code} - {b.rib}</option>
                        ))}
                    </select>

                    <CheckboxDropdown
                        options={releves.map(r => ({ value: String(r.id), label: `#${r.id} · ${r.titre} - ${new Date(r.dateImport).toLocaleDateString()}` }))}
                        selectedValues={selectedReleveIds.map(String)}
                        onChange={vals => setSelectedReleveIds(vals.map(Number))}
                        placeholder="Relevé associé…"
                        disabled={!selectedBanqueId}
                    />

                    <select
                        className="toolbar-select"
                        value={lettrageFilter}
                        onChange={(e) => setLettrageFilter(e.target.value as 'non' | 'oui' | 'tous')}
                        title="Filtrer selon le rapprochement en cours de session (paires non encore approuvées). Une fois approuvées, les lignes deviennent « pointées » (état final en base GRC, colonne Pointé)."
                    >
                        <option value="non">Non rapprochés</option>
                        <option value="oui">Rapprochés (en cours)</option>
                        <option value="tous">Tous</option>
                    </select>
                </div>

                <div className="toolbar-actions">
                    <button className="btn btn-auto" onClick={handleAutoReconcile}>
                        <Play size={16} /> Auto
                    </button>
                    <button className="btn btn-ghost-danger" onClick={handleDelettrerTout} title="Retirer tous les rapprochements en cours (non approuvés)">
                        <Unlink size={16} /> Dérapprocher
                    </button>
                    <button className="btn btn-success" onClick={handleApprouver}>
                        <CheckCircle size={16} /> Approuver
                    </button>
                </div>
            </header>

            <div className="grids-wrapper">
                {/* GRILLE DROITE : RELEVE EXCEL (Maintenant en haut) */}
                <div className="grid-panel">
                    <div className="grid-header">
                        <h3>Relevé Bancaire</h3>
                        <span className="badge">Filtre: Encaissements (Crédit)</span>
                    </div>
                    <div className="table-container">
                        {loadingReleve && (
                            <div style={{position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, backgroundColor: 'white', padding: '0.5rem 1rem', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)', fontSize: '0.875rem', fontWeight: 600}}>
                                <Loader2 className="animate-spin" size={16} />
                                Mise à jour...
                            </div>
                        )}
                        {selectedBanqueId && releves.length === 0 && !loadingReleve ? (
                            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                <p style={{ fontSize: '1.125rem', marginBottom: '8px' }}>Aucun relevé à rapprocher pour cette banque.</p>
                                {onNavigateToImport && (
                                    <button className="btn btn-primary" onClick={onNavigateToImport} style={{ marginTop: '16px' }}>
                                        Aller à l'import de relevé
                                    </button>
                                )}
                            </div>
                        ) : (
                        <table style={{ opacity: loadingReleve ? 0.6 : 1, transition: 'opacity 0.2s', pointerEvents: loadingReleve ? 'none' : 'auto' }}>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>
                                    {showPrefix && (
                                    <th>
                                        <span onClick={() => handleReleveSort('releveEnteteId')} style={{cursor: 'pointer'}}>Relevé {renderSortIcon(releveSort, 'releveEnteteId')}</span>
                                        <ExcelFilter columnKey="releveEnteteId" filterType="list" options={getReleveFilterOptions('releveEnteteId')} selectedValues={releveFilters['releveEnteteId']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, releveEnteteId: {type: 'list', value: val}}))} />
                                    </th>
                                    )}
                                    <th>
                                        <span onClick={() => handleReleveSort('lettrage')} style={{cursor: 'pointer'}}>Repère {renderSortIcon(releveSort, 'lettrage')}</span>
                                        <ExcelFilter columnKey="lettrage" filterType="list" options={getReleveFilterOptions('lettrage')} selectedValues={releveFilters['lettrage']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, lettrage: {type: 'list', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('dateOperation')} style={{cursor: 'pointer'}}>Date Op. {renderSortIcon(releveSort, 'dateOperation')}</span>
                                        <ExcelFilter columnKey="dateOperation" filterType="date" textValue={releveFilters['dateOperation']?.value || ''} onChange={(val) => setReleveFilters(prev => ({...prev, dateOperation: {type: 'date', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('dateValeur')} style={{cursor: 'pointer'}}>Date Val. {renderSortIcon(releveSort, 'dateValeur')}</span>
                                        <ExcelFilter columnKey="dateValeur" filterType="date" textValue={releveFilters['dateValeur']?.value || ''} onChange={(val) => setReleveFilters(prev => ({...prev, dateValeur: {type: 'date', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('libelle')} style={{cursor: 'pointer'}}>Libellé {renderSortIcon(releveSort, 'libelle')}</span>
                                        <ExcelFilter columnKey="libelle" filterType="list" options={getReleveFilterOptions('libelle')} selectedValues={releveFilters['libelle']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, libelle: {type: 'list', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('reference')} style={{cursor: 'pointer'}}>Référence {renderSortIcon(releveSort, 'reference')}</span>
                                        <ExcelFilter columnKey="reference" filterType="list" options={getReleveFilterOptions('reference')} selectedValues={releveFilters['reference']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, reference: {type: 'list', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('code')} style={{cursor: 'pointer'}}>Code {renderSortIcon(releveSort, 'code')}</span>
                                        <ExcelFilter columnKey="code" filterType="list" options={getReleveFilterOptions('code')} selectedValues={releveFilters['code']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, code: {type: 'list', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('credit')} style={{cursor: 'pointer'}}>Crédit {renderSortIcon(releveSort, 'credit')}</span>
                                        <ExcelFilter columnKey="credit" filterType="text" textValue={releveFilters['credit']?.value || ''} onChange={(val) => setReleveFilters(prev => ({...prev, credit: {type: 'text', value: val}}))} />
                                    </th>
                                    <th style={{width: '130px', textAlign: 'center'}}>
                                        <span>Action</span>
                                    </th>
                                </tr>
                            </thead>
                            <ReleveTableBody rows={sortedLignes} selectedReleveLigneId={selectedReleveLigneId} onSelect={handleSelectReleve} currentUserId={Number(user?.no) || 0} onGenererReglement={handleOpenGenererModal} showPrefix={showPrefix} showReleveCol={showPrefix} releveLabels={releveLabels} />
                        </table>
                        )}
                    </div>
                    <div style={{padding: '0.25rem 1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)'}}>
                        {sortedLignes.length} élément(s) affiché(s)
                    </div>
                </div>

                {pendingReservation && (
                    <div style={{ padding: '12px 16px', background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: '8px', color: '#664d03', display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0' }}>
                        <div>
                            <strong>Attention :</strong> Les montants sélectionnés sont différents. Voulez-vous mettre à jour le montant du règlement avec celui du relevé et rapprocher ?
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn btn-success"
                                disabled={isUpdatingMontant}
                                onClick={() => handleUpdateMontantAndLettrer(pendingReservation.grcId, pendingReservation.ligneId)}
                            >
                                {isUpdatingMontant ? 'Mise à jour en cours...' : 'Mettre à jour le montant et rapprocher'}
                            </button>
                            <button
                                className="btn btn-ghost-danger"
                                disabled={isUpdatingMontant}
                                onClick={() => { setPendingReservation(null); setSelectedGrcId(null); setSelectedReleveLigneId(null); }}
                            >
                                Annuler
                            </button>
                        </div>
                    </div>
                )}

                {/* GRILLE GAUCHE : GRC (Maintenant en bas) */}
                <div className="grid-panel">
                    <div className="grid-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                            <h3>Règlements GRC</h3>
                            <span className="badge">Virement, Chèque, Traite</span>
                        </div>
                        <div className="grid-header-controls">
                            <label className="date-field">
                                Du
                                <input type="date" value={dateDebut} max={dateFin || undefined} onChange={(e) => setDateDebut(e.target.value)} />
                            </label>
                            <label className="date-field">
                                Au
                                <input type="date" value={dateFin} min={dateDebut || undefined} onChange={(e) => setDateFin(e.target.value)} />
                            </label>
                            <button
                                className="btn"
                                title="Recharger les règlements GRC avec la période saisie"
                                onClick={() => { setAppliedDateDebut(dateDebut); setAppliedDateFin(dateFin); }}
                                style={{padding: '0.25rem 0.6rem', fontSize: '0.8rem', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap'}}
                            >
                                Actualiser
                            </button>
                        <div style={{position: 'relative'}}>
                            <button className="btn" onClick={() => setShowColumnMenu(!showColumnMenu)} style={{padding: '0.25rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)'}} title="Configuration des colonnes">
                                <Settings size={18} />
                            </button>
                            {showColumnMenu && (
                                <div style={{position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'white', border: '1px solid var(--border-color)', borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', width: '250px', maxHeight: '400px', display: 'flex', flexDirection: 'column'}}>
                                    <div style={{padding: '0.75rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)'}}>
                                        <span style={{fontWeight: 600, fontSize: '0.875rem'}}>Colonnes affichées</span>
                                        <button onClick={() => setShowColumnMenu(false)} style={{background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)'}}><X size={16} /></button>
                                    </div>
                                    <div style={{padding: '0.5rem', overflowY: 'auto', flex: 1}}>
                                        {[{key: 'lettrage', label: 'Repère'}, ...availableColumns].map(col => (
                                            <label key={col.key} style={{display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', cursor: 'pointer', fontSize: '0.875rem'}}>
                                                <input type="checkbox" checked={selectedColumns.includes(col.key)} onChange={() => toggleColumn(col.key)} disabled={col.key === 'lettrage'} />
                                                {col.label}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                        </div>
                    </div>
                    <div className="table-container">
                        {loadingGrc && (
                            <div style={{position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10, backgroundColor: 'white', padding: '0.5rem 1rem', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-primary)', fontSize: '0.875rem', fontWeight: 600}}>
                                <Loader2 className="animate-spin" size={16} />
                                Mise à jour...
                            </div>
                        )}
                        <table style={{ opacity: loadingGrc ? 0.6 : 1, transition: 'opacity 0.2s', pointerEvents: loadingGrc ? 'none' : 'auto' }}>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>
                                    {/* TASK-099 : colonne action — ne fait pas partie de selectedColumns ni de l'export */}
                                    <th style={{width: '40px'}}></th>
                                    {selectedColumns.map(colKey => {
                                        const colDef = [{key: 'lettrage', label: 'Repère'}, ...availableColumns].find(c => c.key === colKey) || {key: colKey, label: colKey};
                                        const isDate = colKey === 'date';
                                        const isText = ['montant', 'solde'].includes(colKey);
                                        const ftype = isDate ? 'date' : isText ? 'text' : 'list';
                                        return (
                                            <th 
                                                key={colKey}
                                                draggable 
                                                onDragStart={(e) => handleDragStart(e, colKey)}
                                                onDragOver={handleDragOver}
                                                onDrop={(e) => handleDrop(e, colKey)}
                                                style={{cursor: 'grab', opacity: draggedCol === colKey ? 0.5 : 1}}
                                            >
                                                <span onClick={() => handleGrcSort(colKey)} style={{cursor: 'pointer'}}>{colDef.label} {renderSortIcon(grcSort, colKey)}</span>
                                                <ExcelFilter 
                                                    columnKey={colKey} 
                                                    filterType={ftype}
                                                    options={ftype === 'list' ? getGrcFilterOptions(colKey) : undefined}
                                                    selectedValues={grcFilters[colKey]?.type === 'list' ? grcFilters[colKey]?.value : []}
                                                    textValue={grcFilters[colKey]?.type === ftype && ftype !== 'list' ? grcFilters[colKey]?.value : ''}
                                                    onChange={(val) => setGrcFilters(prev => ({...prev, [colKey]: {type: ftype, value: val}}))}
                                                />
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <GrcTableBody rows={sortedReglements} selectedGrcId={selectedGrcId} onSelect={handleSelectGrc} onAnnuler={handleAnnulerReglementGrc} selectedColumns={selectedColumns} caissesMap={caissesMap} modesMap={modesMap} banquesMap={banquesMap} currentUserId={Number(user?.no) || 0} loadedMvIds={loadedMvIds} showPrefix={showPrefix} />
                        </table>
                    </div>
                    <div style={{padding: '0.25rem 1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)'}}>
                        {sortedReglements.length} élément(s) affiché(s)
                    </div>
                </div>
            </div>

            {/* Modal Génération Règlement Versement (TASK-060) */}
            {modalLigne && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <div style={{
                        backgroundColor: 'white', borderRadius: '8px', width: '540px', maxWidth: '95vw',
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)',
                        overflow: 'hidden', display: 'flex', flexDirection: 'column'
                    }}>
                        <div style={{
                            padding: '1rem 1.5rem', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 600, color: '#0f172a' }}>
                                Générer un règlement (Versement)
                            </h3>
                            <button
                                onClick={() => setModalLigne(null)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Récapitulatif de la ligne de relevé */}
                            <div style={{ backgroundColor: '#f1f5f9', padding: '0.875rem 1rem', borderRadius: '6px', fontSize: '0.875rem', color: '#334155' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <div><strong>Date Opération :</strong> {modalLigne.dateOperation}</div>
                                    <div><strong>Montant :</strong> {formatMoney(Number(modalLigne.credit))}</div>
                                </div>
                                <div style={{ marginBottom: '0.5rem' }}><strong>Libellé relevé :</strong> {modalLigne.libelle}</div>
                                <div><strong>Banque :</strong> {banquesMap[Number(selectedBanqueId)]?.code ? `${banquesMap[Number(selectedBanqueId)].code} - ${banquesMap[Number(selectedBanqueId)].rib}` : '—'}</div>
                                <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#64748b' }}>
                                    * Mode de règlement : <strong>Versement</strong> (fixé)
                                </div>
                            </div>

                            {/* Combobox Client — champ unique, suggestions bornées */}
                            <div className="form-group" style={{ margin: 0, position: 'relative' }}>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem', color: '#1e293b' }}>
                                    Client <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    placeholder={loadingClients ? 'Chargement des clients...' : 'Rechercher par code ou intitulé...'}
                                    value={clientInputDisplay}
                                    onChange={(e) => {
                                        setClientInputDisplay(e.target.value);
                                        setSelectedClientCode('');
                                        setShowClientSuggestions(true);
                                    }}
                                    onFocus={() => setShowClientSuggestions(true)}
                                    onBlur={() => setTimeout(() => setShowClientSuggestions(false), 300)}
                                    style={{
                                        width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px',
                                        border: selectedClientCode ? '1px solid #22c55e' : '1px solid #cbd5e1',
                                        fontSize: '0.875rem', boxSizing: 'border-box'
                                    }}
                                />
                                {showClientSuggestions && (
                                    <ul style={{
                                        position: 'absolute', zIndex: 1000, top: '100%', left: 0, right: 0,
                                        margin: 0, padding: 0, listStyle: 'none',
                                        backgroundColor: '#fff', border: '1px solid #cbd5e1',
                                        borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                        maxHeight: '180px', overflowY: 'auto', fontSize: '0.875rem'
                                    }}>
                                        {loadingClients ? (
                                            <li style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>Chargement en cours...</li>
                                        ) : searchingServer ? (
                                            <li style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>Recherche en cours...</li>
                                        ) : clientSuggestions.length === 0 ? (
                                            <li style={{ padding: '0.5rem 0.75rem', color: '#64748b' }}>Aucun client trouvé</li>
                                        ) : (
                                            clientSuggestions.map(c => (
                                                <li
                                                    key={c.code}
                                                    onMouseDown={() => {
                                                        setSelectedClientCode(c.code);
                                                        setClientInputDisplay(`${c.code} - ${c.intitule}`);
                                                        setShowClientSuggestions(false);
                                                    }}
                                                    style={{
                                                        padding: '0.45rem 0.75rem', cursor: 'pointer',
                                                        backgroundColor: selectedClientCode === c.code ? '#eff6ff' : 'transparent',
                                                        borderBottom: '1px solid #f1f5f9'
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                                                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = selectedClientCode === c.code ? '#eff6ff' : 'transparent')}
                                                >
                                                    <span style={{ fontWeight: 600 }}>{c.code}</span>
                                                    <span style={{ color: '#64748b' }}> — {c.intitule}</span>
                                                </li>
                                            ))
                                        )}
                                    </ul>
                                )}
                            </div>

                            {/* Sélection Caisse */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem', color: '#1e293b' }}>
                                    Caisse <span style={{ color: '#ef4444' }}>*</span>
                                </label>
                                <select
                                    value={selectedCaisseCode}
                                    onChange={(e) => setSelectedCaisseCode(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
                                >
                                    <option value="">Sélectionner une caisse...</option>
                                    {userCaissesOptions.map(ca => (
                                        <option key={ca.code} value={ca.code}>
                                            {ca.code} - {ca.intitule}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {/* Champ Saisie MV_Reference */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.25rem', color: '#1e293b' }}>
                                    Référence
                                </label>
                                <input
                                    type="text"
                                    placeholder="Saisir la référence..."
                                    value={mvReference}
                                    onChange={(e) => setMvReference(e.target.value)}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
                                />
                            </div>
                        </div>

                        <div style={{
                            padding: '1rem 1.5rem', backgroundColor: '#f8fafc', borderTop: '1px solid #e2e8f0',
                            display: 'flex', justifyContent: 'flex-end', gap: '0.75rem'
                        }}>
                            <button
                                className="btn"
                                onClick={() => setModalLigne(null)}
                                style={{ backgroundColor: '#e2e8f0', color: '#334155', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
                                disabled={isSubmittingVersement}
                            >
                                Annuler
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleConfirmGenererVersement}
                                disabled={isSubmittingVersement || !selectedClientCode || !selectedCaisseCode}
                                style={{ padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                {isSubmittingVersement ? 'Génération en cours...' : 'Générer le règlement'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
