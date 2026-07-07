// @ts-nocheck
import React, { useState } from 'react';
import axios from 'axios';
import { API_BASE } from './api';
import { Play, CheckCircle, Link2, Unlink, ArrowUp, ArrowDown, Lock } from 'lucide-react';
import './RapprochementBancaire.css';
import { ExcelFilter } from './ExcelFilter';
import { renderSharedCell, DEFAULT_COLUMNS, formatMoney } from './utils';
import { Settings, X } from 'lucide-react';

interface LigneReleve {
    id: number;
    dateOperation: string;
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
    selectedColumns: string[];
    caissesMap: Record<number, any>;
    modesMap: Record<number, any>;
    banquesMap: Record<number, any>;
    currentUserId: number;
}

const GrcTableRow = ({ row, isSelected, onSelect, selectedColumns, caissesMap, modesMap, banquesMap, currentUserId }: any) => {
    // grcRowRenderCount++;
    // console.log(`[RENDER] GrcTableRow: ${row.mv_Id}`);
    const isLockedByOther = row.reservePar_UserId && Number(row.reservePar_UserId) !== Number(currentUserId);
    return (
    <tr className={row.lettrage ? 'lettered-row' : (isSelected ? 'selected-row' : '')} style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : {}}>
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
                    onChange={() => onSelect(row.mv_Id)}
                />
            )}
        </td>
        {selectedColumns.map((key: string) => (
            <td key={key} className={key === 'montant' || key === 'solde' ? 'amount' : ''}>
                {renderSharedCell(key, row, caissesMap, modesMap, banquesMap)}
            </td>
        ))}
    </tr>
  );
};

const areEqual = (prevProps: any, nextProps: any) => {
    let equal = true;
    const diffs: string[] = [];
    const propsToCompare = ['row', 'isSelected', 'onSelect', 'selectedColumns', 'caissesMap', 'modesMap', 'banquesMap', 'currentUserId'];
    for (const key of propsToCompare) {
        if (prevProps[key] !== nextProps[key]) {
            // console.log(`[DEBUG] GrcTableRow ${prevProps.row.mv_Id} failed equality due to: ${key}`);
            equal = false;
        }
    }
    return equal;
};

const GrcTableRowMemo = React.memo(GrcTableRow, areEqual);

const GrcTableBody = React.memo(({ rows, selectedGrcId, onSelect, selectedColumns, caissesMap, modesMap, banquesMap, currentUserId }: GrcTableBodyProps) => {
    // console.log(`[RENDER] GrcTableBody with ${rows.length} rows.`);
    return (
    <tbody>
        {rows.map(row => (
            <GrcTableRowMemo
                key={row.mv_Id}
                row={row}
                isSelected={selectedGrcId === row.mv_Id}
                onSelect={onSelect}
                selectedColumns={selectedColumns}
                caissesMap={caissesMap}
                modesMap={modesMap}
                banquesMap={banquesMap}
                currentUserId={currentUserId}
            />
        ))}
    </tbody>
)});

interface ReleveTableBodyProps {
    rows: LigneReleve[];
    selectedReleveLigneId: number | null;
    onSelect: (id: number) => void;
    currentUserId: number;
}

const ReleveTableRow = React.memo(({ row, isSelected, onSelect, currentUserId }: any) => {
    // releveRowRenderCount++;
    const isLockedByOther = row.reservePar_UserId && Number(row.reservePar_UserId) !== Number(currentUserId);
    return (
    <tr className={row.lettrage ? 'lettered-row' : (isSelected ? 'selected-row' : '')} style={isLockedByOther ? { opacity: 0.6, backgroundColor: '#f5f5f5' } : {}}>
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
        <td className="lettrage-cell">{row.lettrage}</td>
        <td>{row.dateOperation}</td>
        <td>{row.dateValeur}</td>
        <td>{row.libelle}</td>
        <td>{row.reference}</td>
        <td>{row.code}</td>
        <td className="amount">{formatMoney(Number(row.credit))}</td>
    </tr>
    );
});

const ReleveTableBody = React.memo(({ rows, selectedReleveLigneId, onSelect, currentUserId }: ReleveTableBodyProps) => (
    <tbody>
        {rows.map(row => (
            <ReleveTableRow
                key={row.id}
                row={row}
                isSelected={selectedReleveLigneId === row.id}
                onSelect={onSelect}
                currentUserId={currentUserId}
            />
        ))}
    </tbody>
));

export const RapprochementBancaire: React.FC<{caissesMap: any, modesMap: any, availableColumns: any[], user: any}> = ({caissesMap, modesMap, availableColumns, user}) => {
    // rbRenderCount++;
    // console.log(`[RENDER] RapprochementBancaire (Total: ${rbRenderCount})`);
    const [releves, setReleves] = useState<any[]>([]);
    const [selectedReleveId, setSelectedReleveEnteteId] = useState<number | ''>('');
    const [lignesReleve, setLignesReleve] = useState<LigneReleve[]>([]);
    const [reglementsGrc, setReglementsGrc] = useState<ReglementGrc[]>([]);
    const [loadingGrc, setLoadingGrc] = useState(false);
    const [loadingReleve, setLoadingReleve] = useState(false);
    
    // Pour le lettrage manuel
    const [selectedGrcId, setSelectedGrcId] = useState<number | null>(null);
    const [selectedReleveLigneId, setSelectedReleveLigneId] = useState<number | null>(null);

    // Banques
    const [banques, setBanques] = useState<Banque[]>([]);
    const banquesMap = React.useMemo(() => {
        const m: Record<number, any> = {};
        banques.forEach((b: any) => { m[b.id] = b; });
        return m;
    }, [banques]);
    const [selectedBanqueId, setSelectedBanqueId] = useState<number | ''>('');
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
    const [grcFilters, setGrcFilters] = useState<Record<string, {type: 'list'|'text', value: any}>>({});
    const [releveFilters, setReleveFilters] = useState<Record<string, {type: 'list'|'text', value: any}>>({});

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
    // Synchronisation synchrone pendant le render (valeurs toujours à jour avant callbacks)
    selectedGrcIdRef.current = selectedGrcId;
    selectedReleveLigneIdRef.current = selectedReleveLigneId;
    reglementsGrcRef.current = reglementsGrc;
    lignesReleveRef.current = lignesReleve;
    currentLettrageIndexRef.current = currentLettrageIndex;

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

    // Utility : même logique que LettrageGenerator backend (A..Z, AA, AB...)
    const getLettrageFromIndex = React.useCallback((index: number): string => {
        if (index <= 0) return '';
        let lettrage = '';
        while (index > 0) {
            const modulo = (index - 1) % 26;
            lettrage = String.fromCharCode(65 + modulo) + lettrage;
            index = Math.floor((index - modulo) / 26);
        }
        return lettrage;
    }, []);

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

    // Chargement des règlements GRC — rechargé quand la banque OU les dates APPLIQUÉES changent.
    // Les dates appliquées sont mises à jour uniquement via le bouton Actualiser,
    // ce qui permet à l'utilisateur de modifier les deux champs avant de relancer la requête.
    React.useEffect(() => {
        if (!selectedBanqueId) {
            setReglementsGrc([]);
            return;
        }

        const userStr = sessionStorage.getItem('gocom_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            setLoadingGrc(true);
            const caissesStr = user.caisses ? user.caisses.join(',') : '';
            // Fetch Reglements GRC — borné par la période appliquée (dateFin inclusive : fin de journée)
            const dateParams = `${appliedDateDebut ? `&dateDebut=${appliedDateDebut}` : ''}${appliedDateFin ? `&dateFin=${appliedDateFin}T23:59:59` : ''}`;
            // Le filtre lettré/non-lettré est appliqué côté client (sur le lettrage de session)
            // pour ne pas recharger et ainsi préserver les appariements en cours.
            // L'état « Pointé » (isPointe, rapprochement final) reste consultable via la colonne Pointé.
            axios.get(`${API_BASE}/reglements?societeId=${user.societeId}&caisses=${caissesStr}&banqueNos=${selectedBanqueId}&page=1&pageSize=1000&pointe=false${dateParams}`)
                .then(res => {
                    setReglementsGrc(res.data.items.map((r: any) => ({
                        ...r,
                        mv_Id: r.no,
                        lettrage: r.lettrage || null,
                        reservePar_UserId: r.reservePar_UserId,
                        reservePar_UserName: r.reservePar_UserName,
                        dateReservation: r.dateReservation
                    })));
                })
                .catch(err => console.error(err))
                .finally(() => setLoadingGrc(false));
        }
    }, [selectedBanqueId, appliedDateDebut, appliedDateFin]);

    // Chargement des relevés bancaires — dépend uniquement de la banque (indépendant de la période)
    React.useEffect(() => {
        if (!selectedBanqueId) {
            setReleves([]);
            setSelectedReleveEnteteId('');
            return;
        }

        axios.get(`${API_BASE}/ReleveBancaire?banqueId=${selectedBanqueId}&nonRapprochesSeulement=true`)
            .then(res => {
                setReleves(res.data);
                if (res.data && res.data.length > 0) {
                    setSelectedReleveEnteteId(res.data[0].id);
                } else {
                    setSelectedReleveEnteteId('');
                }
            })
            .catch(err => console.error(err));
    }, [selectedBanqueId]);

    React.useEffect(() => {
        if (!selectedReleveId) {
            setLignesReleve([]);
            return;
        }
        
        setLoadingReleve(true);
        axios.get(`${API_BASE}/ReleveBancaire/${selectedReleveId}/lignes`)
            .then(res => {
                setLignesReleve(res.data.map((l: any) => ({
                    id: l.id,
                    dateOperation: new Date(l.dateOperation).toLocaleDateString(),
                    dateValeur: new Date(l.dateValeur).toLocaleDateString(),
                    dateValeurRaw: l.dateValeur,
                    libelle: l.libelle,
                    reference: l.reference || '',
                    code: l.code || '',
                    credit: l.credit,
                    lettrage: l.lettrage || null,
                    reservePar_UserId: l.reservePar_UserId,
                    reservePar_UserName: l.reservePar_UserName,
                    dateReservation: l.dateReservation
                })));
            })
            .catch(err => console.error(err))
            .finally(() => setLoadingReleve(false));

    }, [selectedReleveId]);

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
        if (!selectedReleveId) {
            alert("Veuillez sélectionner un relevé bancaire.");
            return;
        }
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const user = userStr ? JSON.parse(userStr) : {};
            // Même périmètre que la grille GRC : les dates appliquées (Du/Au)
            const response = await axios.post(`${API_BASE}/ReleveBancaire/auto-reconcile`, {
                releveBancaireEnteteId: Number(selectedReleveId),
                banqueId: selectedBanqueId ?? 0,
                dateDebut: appliedDateDebut || null,
                dateFin: appliedDateFin ? `${appliedDateFin}T23:59:59` : null
            }, {
                headers: { Authorization: `Bearer ${user.token}` }
            });

            const propositions: Array<{ ligneReleveId: number; reglementGrcId: number; montant: number; lettragePropose: string }> = response.data;

            if (propositions.length === 0) {
                alert("Aucune correspondance parfaite trouvée (1=1 sur le montant).");
                return;
            }

            // Générer les lettrages localement pour éviter les conflits avec le lettrage manuel
            let localIndex = currentLettrageIndexRef.current;
            const propsWithLettrage = propositions.map(p => {
                const lettrage = getLettrageFromIndex(localIndex++);
                return { ...p, localLettrage: lettrage };
            });

            // Reserver séquentiellement
            const validProps = [];
            let conflits = 0;
            for (const p of propsWithLettrage) {
                try {
                    await axios.post(`${API_BASE}/ReleveBancaire/reserve`, {
                        ligneReleveId: p.ligneReleveId,
                        mvId: p.reglementGrcId,
                        lettrage: p.localLettrage
                    }, { headers: { Authorization: `Bearer ${user.token}` } });
                    validProps.push(p);
                } catch (e: any) {
                    if (e.response?.status === 409) conflits++;
                }
            }

            const currentUserId = userStr ? JSON.parse(userStr).no : 0;

            // Appliquer les propositions validées aux deux grilles (lettrage local)
            setLignesReleve(prev => prev.map(l => {
                const match = validProps.find(p => p.ligneReleveId === l.id);
                return match ? { ...l, lettrage: match.localLettrage, reservePar_UserId: currentUserId } : l;
            }));
            setReglementsGrc(prev => prev.map(r => {
                const match = validProps.find(p => p.reglementGrcId === r.mv_Id);
                return match ? { ...r, lettrage: match.localLettrage, reservePar_UserId: currentUserId } : r;
            }));
            setCurrentLettrageIndex(localIndex);

            if (conflits > 0) {
                alert(`💡 ${validProps.length} correspondances trouvées et réservées. ${conflits} conflits ignorés.`);
            } else {
                alert(`💡 L'algorithme a trouvé ${validProps.length} correspondance(s) parfaite(s). Vérifiez les paires rapprochées puis cliquez sur « Approuver ».`);
            }
        } catch (error) {
            console.error("Erreur auto-reconcile", error);
            alert("Erreur lors de l'auto-rapprochement.");
        }
    };


    // Retire un lettrage (les 2 côtés de la paire) en le ciblant par sa lettre.
    // Callback stable (deps=[]) : utilise uniquement des setters, jamais de state lu.
    const delettrerByLettrage = React.useCallback(async (lettre: string) => {
        const lignes = lignesReleveRef.current.filter(l => l.lettrage === lettre);
        try {
            const userStr = sessionStorage.getItem('gocom_user');
            const token = userStr ? JSON.parse(userStr).token : '';
            for (const l of lignes) {
                await axios.post(`${API_BASE}/ReleveBancaire/release`, {
                    ligneReleveId: l.id
                }, { headers: { Authorization: `Bearer ${token}` } });
            }
            setReglementsGrc(prev => prev.map(r => r.lettrage === lettre ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null } : r));
            setLignesReleve(prev => prev.map(l => l.lettrage === lettre ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null } : l));
        } catch (e) {
            console.error(e);
            alert("Erreur lors de la dissociation.");
        }
    }, []);

    // Lettrage manuel — lit les refs (valeurs fraîches) pour éviter les stale closures
    // tout en gardant une référence stable (n'invalidera pas React.memo des grilles).
    const applyManualLettrage = React.useCallback(async (grcId: number, ligneId: number) => {
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
                alert(error.response.data.message || "Déjà réservé par un autre utilisateur.");
            } else {
                alert("Erreur lors de la réservation.");
            }
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        }
    }, [getLettrageFromIndex]);

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
            delettrerByLettrage(grc.lettrage);
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
    }, [delettrerByLettrage, applyManualLettrage]);

    // handleSelectReleve — ref pour selectedGrcId : même principe.
    const handleSelectReleve = React.useCallback((ligneId: number) => {
        // console.log(`[ACTION] handleSelectReleve(${ligneId})`);
        // console.time(`SelectReleve-${ligneId}`);
        // grcRowRenderCount = 0;
        // releveRowRenderCount = 0;

        const rel = lignesReleveRef.current.find(l => l.id === ligneId);
        if (rel?.lettrage) {
            delettrerByLettrage(rel.lettrage);
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
    }, [delettrerByLettrage, applyManualLettrage]);

    // Retire TOUS les lettrages en attente (non encore approuvés) des 2 grilles
    const handleDelettrerTout = async () => {
        const userStr = sessionStorage.getItem('gocom_user');
        const token = userStr ? JSON.parse(userStr).token : '';
        const currentUserId = userStr ? JSON.parse(userStr).no : 0;
        
        const lignesToRelease = lignesReleveRef.current.filter(l => l.lettrage && (!l.reservePar_UserId || Number(l.reservePar_UserId) === Number(currentUserId)));
        
        try {
            for (const l of lignesToRelease) {
                await axios.post(`${API_BASE}/ReleveBancaire/release`, {
                    ligneReleveId: l.id
                }, { headers: { Authorization: `Bearer ${token}` } });
            }
            setReglementsGrc(prev => prev.map(r => (r.lettrage && (!r.reservePar_UserId || Number(r.reservePar_UserId) === Number(currentUserId))) ? { ...r, lettrage: null, reservePar_UserId: null, dateReservation: null } : r));
            setLignesReleve(prev => prev.map(l => (l.lettrage && (!l.reservePar_UserId || Number(l.reservePar_UserId) === Number(currentUserId))) ? { ...l, lettrage: null, reservePar_UserId: null, dateReservation: null } : l));
            setSelectedGrcId(null);
            setSelectedReleveLigneId(null);
        } catch (e) {
            console.error(e);
            alert("Erreur lors de la dissociation globale.");
        }
    };

    const handleApprouver = async () => {
        const pairs: any[] = [];
        const letteredLignes = lignesReleve.filter(l => l.lettrage);
        
        for (const ligne of letteredLignes) {
            const grc = reglementsGrc.find(r => r.lettrage === ligne.lettrage);
            if (grc) {
                pairs.push({
                    releveLigneId: ligne.id,
                    grcReglementId: grc.mv_Id,
                    lettrage: ligne.lettrage,
                    codeExcel: ligne.code || 'MANUAL',
                    dateValeur: ligne.dateValeurRaw
                });
            }
        }

        if (pairs.length === 0) {
            alert("Aucun rapprochement en cours à approuver.");
            return;
        }

        try {
            const response = await axios.post(`${API_BASE}/ReleveBancaire/validate`, pairs);
            const data = response.data;
            
            if (data.success) {
                alert("Rapprochement validé avec succès !");
                setReglementsGrc(prev => prev.filter(r => !r.lettrage));
                setLignesReleve(prev => prev.filter(l => !l.lettrage));
            } else {
                alert(`Validation terminée avec des erreurs.\nSuccès: ${data.successCount}, Échecs: ${data.errorCount}.\n\nErreurs:\n${data.errors.join('\n')}`);
                
                const failedLigneIds = data.failedLigneIds || [];

                setLignesReleve(prev => prev.filter(l => {
                    if (!l.lettrage) return true;
                    if (failedLigneIds.includes(l.id)) return true;
                    return false;
                }));
                
                setReglementsGrc(prev => prev.filter(r => {
                    if (!r.lettrage) return true;
                    const ligne = letteredLignes.find(l => l.lettrage === r.lettrage);
                    if (ligne && failedLigneIds.includes(ligne.id)) return true;
                    return false;
                }));
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
            alert(message);
        }
    };

    const chargerDonneesSimulees = () => {
        // Obsolete
    };

    const matchAmount = (val: number, filterText: string) => {
        if (!filterText) return true;
        const cleanFilter = filterText.trim().replace(',', '.');
        const num = parseFloat(cleanFilter.replace(/[^0-9.-]/g, ''));
        if (isNaN(num)) return val.toString().includes(filterText);
        if (cleanFilter.startsWith('>=')) return val >= num;
        if (cleanFilter.startsWith('<=')) return val <= num;
        if (cleanFilter.startsWith('>')) return val > num;
        if (cleanFilter.startsWith('<')) return val < num;
        if (cleanFilter.startsWith('=')) return val === num;
        return val.toString().includes(cleanFilter);
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
        if (key === 'lettrage') return r.lettrage;
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
            }
        }
        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [reglementsGrc, lettrageFilter, grcFilters, isPaired]);

    const filteredLignes = React.useMemo(() => lignesReleve.filter(l => {
        // Partie Encaissement : n'afficher que les lignes en crédit (credit > 0)
        if (!(Number(l.credit) > 0)) return false;
        if (lettrageFilter === 'oui' && !l.lettrage) return false;
        for (const [key, filter] of Object.entries(releveFilters)) {
            if (filter.type === 'list' && Array.isArray(filter.value) && filter.value.length > 0) {
                if (!filter.value.includes(String(l[key as keyof LigneReleve]))) return false;
            } else if (filter.type === 'text' && filter.value) {
                if (key === 'credit') {
                    if (!matchAmount(l.credit, filter.value)) return false;
                } else {
                    if (!(l[key as keyof LigneReleve] || '').toString().toLowerCase().includes(filter.value.toLowerCase())) return false;
                }
            }
        }
        return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [lignesReleve, lettrageFilter, releveFilters, isPaired]);

    const sortedReglements = React.useMemo(() => [...filteredReglements].sort((a, b) => {
        const aL = !!a.lettrage, bL = !!b.lettrage;
        if (aL !== bL) return aL ? -1 : 1;
        if (aL && bL && a.lettrage !== b.lettrage) return String(a.lettrage).localeCompare(String(b.lettrage));
        if (!grcSort) return 0;
        const valA = getGrcCellValue(a, grcSort.key);
        const valB = getGrcCellValue(b, grcSort.key);
        if (valA === valB) return 0;
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'number' && typeof valB === 'number') {
            return grcSort.desc ? valB - valA : valA - valB;
        }
        return grcSort.desc ? String(valB).localeCompare(String(valA)) : String(valA).localeCompare(String(valB));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [filteredReglements, grcSort]);

    const sortedLignes = React.useMemo(() => [...filteredLignes].sort((a, b) => {
        const aL = !!a.lettrage, bL = !!b.lettrage;
        if (aL !== bL) return aL ? -1 : 1;
        if (aL && bL && a.lettrage !== b.lettrage) return String(a.lettrage).localeCompare(String(b.lettrage));
        if (!releveSort) return 0;
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
    }), [filteredLignes, releveSort]);

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
    }, [reglementsGrc, availableColumns]);

    const getGrcFilterOptions = React.useCallback((key: string) => {
        return grcFilterOptionsMap[key];
    }, [grcFilterOptionsMap]);

    // Mémoïsation des options de filtre relevé
    const releveFilterOptionsMap = React.useMemo(() => {
        const keys: (keyof LigneReleve)[] = ['lettrage', 'libelle', 'reference', 'code'];
        const map: Record<string, {label: string, value: string}[] | undefined> = {};
        for (const key of keys) {
            const unique = Array.from(new Set(lignesReleve.map(l => l[key]))).filter(Boolean);
            map[key] = unique.map(u => ({label: String(u), value: String(u)})).sort((a,b) => a.label.localeCompare(b.label));
        }
        return map;
    }, [lignesReleve]);

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

                    <select
                        className="toolbar-select"
                        value={selectedReleveId}
                        onChange={(e) => setSelectedReleveEnteteId(e.target.value ? Number(e.target.value) : '')}
                        disabled={!selectedBanqueId}
                    >
                        <option value="">Relevé associé…</option>
                        {releves.map(r => (
                            <option key={r.id} value={r.id}>{r.titre} - {new Date(r.dateImport).toLocaleDateString()}</option>
                        ))}
                    </select>

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
                        <table>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>
                                    <th>
                                        <span onClick={() => handleReleveSort('lettrage')} style={{cursor: 'pointer'}}>Repère {renderSortIcon(releveSort, 'lettrage')}</span>
                                        <ExcelFilter columnKey="lettrage" filterType="list" options={getReleveFilterOptions('lettrage')} selectedValues={releveFilters['lettrage']?.value || []} onChange={(val) => setReleveFilters(prev => ({...prev, lettrage: {type: 'list', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('dateOperation')} style={{cursor: 'pointer'}}>Date Op. {renderSortIcon(releveSort, 'dateOperation')}</span>
                                        <ExcelFilter columnKey="dateOperation" filterType="text" textValue={releveFilters['dateOperation']?.value || ''} onChange={(val) => setReleveFilters(prev => ({...prev, dateOperation: {type: 'text', value: val}}))} />
                                    </th>
                                    <th>
                                        <span onClick={() => handleReleveSort('dateValeur')} style={{cursor: 'pointer'}}>Date Val. {renderSortIcon(releveSort, 'dateValeur')}</span>
                                        <ExcelFilter columnKey="dateValeur" filterType="text" textValue={releveFilters['dateValeur']?.value || ''} onChange={(val) => setReleveFilters(prev => ({...prev, dateValeur: {type: 'text', value: val}}))} />
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
                                </tr>
                            </thead>
                            <ReleveTableBody rows={sortedLignes} selectedReleveLigneId={selectedReleveLigneId} onSelect={handleSelectReleve} currentUserId={Number(user?.no) || 0} />
                        </table>
                    </div>
                    <div style={{padding: '0.25rem 1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)'}}>
                        {sortedLignes.length} élément(s) affiché(s)
                    </div>
                </div>

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
                        <table>
                            <thead>
                                <tr>
                                    <th style={{width: '40px'}}>Sel.</th>
                                    {selectedColumns.map(colKey => {
                                        const colDef = [{key: 'lettrage', label: 'Repère'}, ...availableColumns].find(c => c.key === colKey) || {key: colKey, label: colKey};
                                        const isText = ['date', 'montant', 'solde'].includes(colKey);
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
                                                    filterType={isText ? 'text' : 'list'} 
                                                    options={isText ? undefined : getGrcFilterOptions(colKey)} 
                                                    selectedValues={grcFilters[colKey]?.type === 'list' ? grcFilters[colKey]?.value : []} 
                                                    textValue={grcFilters[colKey]?.type === 'text' ? grcFilters[colKey]?.value : ''} 
                                                    onChange={(val) => setGrcFilters(prev => ({...prev, [colKey]: {type: isText ? 'text' : 'list', value: val}}))} 
                                                />
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <GrcTableBody rows={sortedReglements} selectedGrcId={selectedGrcId} onSelect={handleSelectGrc} selectedColumns={selectedColumns} caissesMap={caissesMap} modesMap={modesMap} banquesMap={banquesMap} currentUserId={Number(user?.no) || 0} />
                        </table>
                    </div>
                    <div style={{padding: '0.25rem 1rem', fontSize: '0.75rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)'}}>
                        {sortedReglements.length} élément(s) affiché(s)
                    </div>
                </div>
            </div>
        </div>
    );
};
