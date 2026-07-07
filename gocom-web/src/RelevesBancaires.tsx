import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_BASE } from './api';
import { Upload, CheckCircle, Clock, ArrowLeft, Trash2 } from 'lucide-react';
import './RapprochementBancaire.css';
import { ExcelFilter } from './ExcelFilter';

interface LigneEtatRapprochementDto {
    id: number;
    dateOperation: string | null;
    dateValeur: string | null;
    libelle: string | null;
    reference: string | null;
    code: string | null;
    debit: number | null;
    credit: number | null;
    montantReel: number | null;
    statut: 'NonRapproche' | 'Reserve' | 'Valide';
    lettrage: string | null;
    mV_ID: number | null;
    reservePar_UserId: number | null;
    reservePar_UserName: string | null;
    dateReservation: string | null;
    dateValidation: string | null;
    reglementNumero: string | null;
    reglementDate: string | null;
    reglementCaisseNo: number | null;
    reglementClient: string | null;
}

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

const ReleveInterrogation: React.FC<{ releve: any; caissesMap: Record<number, any>; onBack: () => void }> = ({ releve, caissesMap, onBack }) => {
    const [lignes, setLignes] = useState<LigneEtatRapprochementDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<'Tous' | 'Traite' | 'NonTraite'>('Tous');
    const [filters, setFilters] = useState<Record<string, {type:'list'|'text'|'number'|'date', value:any}>>({});

    useEffect(() => {
        setLoading(true);
        axios.get(`${API_BASE}/ReleveBancaire/${releve.id}/etat`)
            .then(res => {
                setLignes(res.data);
                setError('');
            })
            .catch(err => {
                console.error(err);
                setError('Erreur lors du chargement de l\'état.');
            })
            .finally(() => setLoading(false));
    }, [releve.id]);

    const traiteCount = lignes.filter(l => l.statut === 'Reserve' || l.statut === 'Valide').length;
    const nonTraiteCount = lignes.length - traiteCount;

    const filteredLignes = useMemo(() => {
        return lignes.filter(l => {
            if (filter === 'Traite' && l.statut !== 'Reserve' && l.statut !== 'Valide') return false;
            if (filter === 'NonTraite' && l.statut !== 'NonRapproche') return false;

            for (const [key, f] of Object.entries(filters)) {
                let val: any = l[key as keyof LigneEtatRapprochementDto];
                
                if (key === 'reglementGrc') {
                    if ((l.statut === 'Reserve' || l.statut === 'Valide') && l.reglementNumero) {
                        val = `N° ${l.reglementNumero}`;
                    } else {
                        val = '';
                    }
                }
                if (key === 'dateOperation' && l.dateOperation) {
                    val = l.dateOperation.substring(0, 10);
                }

                if (f.type === 'list' && Array.isArray(f.value) && f.value.length > 0) {
                    if (!f.value.includes(String(val))) return false;
                } else if (f.type === 'text' && f.value) {
                    if (key === 'debit' || key === 'credit') {
                        if (!matchAmount(Number(val) || 0, f.value)) return false;
                    } else {
                        if (!(val || '').toString().toLowerCase().includes(f.value.toLowerCase())) return false;
                    }
                } else if (f.type === 'number' && f.value) {
                    const [min, max] = f.value.split('~');
                    const numVal = Number(val) || 0;
                    if (min && numVal < Number(min)) return false;
                    if (max && numVal > Number(max)) return false;
                } else if (f.type === 'date' && f.value) {
                    const [min, max] = f.value.split('~');
                    if (min && val < min) return false;
                    if (max && val > max) return false;
                }
            }
            return true;
        });
    }, [lignes, filter, filters]);

    const getOptions = (key: keyof LigneEtatRapprochementDto | 'reglementGrc') => {
        const unique = Array.from(new Set(lignes.map(l => {
            if (key === 'reglementGrc') return l.reglementNumero ? `N° ${l.reglementNumero}` : '';
            if (key === 'dateOperation') return l.dateOperation ? l.dateOperation.substring(0, 10) : '';
            return String(l[key as keyof LigneEtatRapprochementDto] || '');
        })));
        return unique.map(u => ({ label: u || '(Vide)', value: u })).sort((a,b) => a.label.localeCompare(b.label));
    };

    const updateFilter = (key: string, type: 'list'|'text'|'number'|'date', value: any) => {
        setFilters(prev => {
            const next = {...prev};
            if (!value || (Array.isArray(value) && value.length === 0)) delete next[key];
            else next[key] = { type, value };
            return next;
        });
    };

    if (loading) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement de l'état...</div>;
    if (error) return <div style={{ padding: '1rem', color: 'red' }}>{error}</div>;

    return (
        <div style={{ padding: '1rem', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
                <button onClick={onBack} className="btn" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                    <ArrowLeft size={16} /> Retour
                </button>
                <div style={{ flex: 1 }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>{releve.titre}</h2>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        N° {releve.id} · Importé le {new Date(releve.dateImport).toLocaleString('fr-FR')} par {releve.importePar_UserId}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>État du rapprochement</span>
                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        <span style={{ color: 'var(--success-color)', fontWeight: 500 }}>{traiteCount} traitées</span>
                        {' · '}
                        <span style={{ color: 'var(--text-secondary)' }}>{nonTraiteCount} non traitées</span>
                    </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button onClick={() => setFilter('Tous')} className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: filter === 'Tous' ? 'var(--accent-primary)' : 'white', color: filter === 'Tous' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>Tous</button>
                    <button onClick={() => setFilter('Traite')} className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: filter === 'Traite' ? 'var(--success-color)' : 'white', color: filter === 'Traite' ? 'white' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>Traitées</button>
                    <button onClick={() => setFilter('NonTraite')} className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem', backgroundColor: filter === 'NonTraite' ? '#f5f5f5' : 'white', color: filter === 'NonTraite' ? 'var(--text-primary)' : 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: '4px', cursor: 'pointer' }}>Non Traitées</button>
                </div>
            </div>

            <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--border-color)', borderRadius: '8px', backgroundColor: 'white' }}>
                <table style={{ minWidth: '1000px', margin: 0 }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-secondary)', zIndex: 1 }}>
                        <tr>
                            <th>Date Op. <ExcelFilter filterType="date" textValue={filters['dateOperation']?.value} onChange={v => updateFilter('dateOperation', 'date', v)} /></th>
                            <th>Libellé <ExcelFilter filterType="list" options={getOptions('libelle')} selectedValues={filters['libelle']?.value || []} onChange={v => updateFilter('libelle', 'list', v)} /></th>
                            <th>Débit <ExcelFilter filterType="text" textValue={filters['debit']?.value} onChange={v => updateFilter('debit', 'text', v)} /></th>
                            <th>Crédit <ExcelFilter filterType="text" textValue={filters['credit']?.value} onChange={v => updateFilter('credit', 'text', v)} /></th>
                            <th>Code <ExcelFilter filterType="list" options={getOptions('code')} selectedValues={filters['code']?.value || []} onChange={v => updateFilter('code', 'list', v)} /></th>
                            <th>Statut <ExcelFilter filterType="list" options={getOptions('statut')} selectedValues={filters['statut']?.value || []} onChange={v => updateFilter('statut', 'list', v)} /></th>
                            <th>Réservé par <ExcelFilter filterType="text" textValue={filters['reservePar_UserName']?.value} onChange={v => updateFilter('reservePar_UserName', 'text', v)} /></th>
                            <th>Règlement GRC <ExcelFilter filterType="text" textValue={filters['reglementGrc']?.value} onChange={v => updateFilter('reglementGrc', 'text', v)} /></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredLignes.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)' }}>Aucune ligne.</td></tr>
                        ) : filteredLignes.map(l => (
                            <tr key={l.id}>
                                <td>{l.dateOperation ? new Date(l.dateOperation).toLocaleDateString('fr-FR') : ''}</td>
                                <td>{l.libelle}</td>
                                <td className="amount" style={{ textAlign: 'right' }}>
                                    {l.debit && l.debit > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(l.debit) : ''}
                                </td>
                                <td className="amount" style={{ textAlign: 'right' }}>
                                    {l.credit && l.credit > 0 ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'MAD' }).format(l.credit) : ''}
                                </td>
                                <td>{l.code}</td>
                                <td>
                                    {l.statut === 'Valide' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--success-color)', color: 'white', fontSize: '0.75rem' }}><CheckCircle size={12} /> Validé</span>}
                                    {l.statut === 'Reserve' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e67e22', color: 'white', fontSize: '0.75rem' }}><Clock size={12} /> Réservé</span>}
                                    {l.statut === 'NonRapproche' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e0e0e0', color: '#555', fontSize: '0.75rem' }}>Non traité</span>}
                                </td>
                                <td>
                                    {l.statut === 'Reserve' && l.reservePar_UserName && (
                                        <div style={{ fontSize: '0.75rem' }}>
                                            <div>{l.reservePar_UserName}</div>
                                            <div style={{ color: 'var(--text-secondary)' }}>{l.dateReservation ? new Date(l.dateReservation).toLocaleString('fr-FR') : ''}</div>
                                        </div>
                                    )}
                                </td>
                                <td>
                                    {(l.statut === 'Reserve' || l.statut === 'Valide') && l.reglementNumero && (
                                        <div style={{ fontSize: '0.75rem' }}>
                                            <div style={{ fontWeight: 500 }}>N° {l.reglementNumero} - {l.reglementDate ? new Date(l.reglementDate).toLocaleDateString('fr-FR') : ''}</div>
                                            <div style={{ color: 'var(--text-secondary)' }}>
                                                {l.reglementCaisseNo ? (caissesMap[l.reglementCaisseNo]?.intitule || caissesMap[l.reglementCaisseNo]?.code || l.reglementCaisseNo) : ''}
                                                {l.reglementClient ? ` · ${l.reglementClient}` : ''}
                                            </div>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

interface Banque {
    id: number;
    code: string;
    rib: string;
}

export const RelevesBancaires: React.FC = () => {
    const [banques, setBanques] = useState<Banque[]>([]);
    const [selectedBanqueId, setSelectedBanqueId] = useState<number | ''>('');
    const [titre, setTitre] = useState('');
    const [file, setFile] = useState<File | null>(null);

    const [releves, setReleves] = useState<any[]>([]);
    const [caissesMap, setCaissesMap] = useState<Record<number, any>>({});
    const [selectedReleve, setSelectedReleve] = useState<any | null>(null);

    useEffect(() => {
        const userStr = sessionStorage.getItem('gocom_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            if (user.societeId) {
                axios.get(`${API_BASE}/reference/banques?societeId=${user.societeId}`)
                    .then(res => {
                        setBanques(res.data);
                        if (res.data.length > 0) {
                            const firstBank = res.data[0];
                            setSelectedBanqueId(firstBank.id);
                            setTitre(`${firstBank.code} - ${new Date().toLocaleDateString('fr-FR')}`);
                        }
                    })
                    .catch(err => console.error("Erreur chargement banques", err));
                    
                axios.get(`${API_BASE}/reference/caisses`)
                    .then(res => {
                        const map: Record<number, any> = {};
                        res.data.forEach((c: any) => { map[c.id] = c; });
                        setCaissesMap(map);
                    })
                    .catch(err => console.error("Erreur chargement caisses", err));
            }
        }
    }, []);

    const fetchReleves = () => {
        if (!selectedBanqueId) {
            setReleves([]);
            return;
        }
        axios.get(`${API_BASE}/ReleveBancaire?banqueId=${selectedBanqueId}`)
            .then(res => setReleves(res.data))
            .catch(err => console.error("Erreur chargement relevés", err));
    };

    useEffect(() => {
        fetchReleves();
    }, [selectedBanqueId]);

    const handleBanqueChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (!val) {
            setSelectedBanqueId('');
            setTitre('');
            return;
        }
        const bId = Number(val);
        setSelectedBanqueId(bId);
        
        const b = banques.find(b => b.id === bId);
        if (b) {
            const today = new Date().toLocaleDateString('fr-FR');
            setTitre(`${b.code} - ${today}`);
        }
    };

    const handleFileUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !titre || !selectedBanqueId) {
            alert("Veuillez saisir un titre, choisir un fichier et sélectionner une banque.");
            return;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("titre", titre);
        formData.append("banqueId", selectedBanqueId.toString());
        const userStr = sessionStorage.getItem('gocom_user');
        if (userStr) {
            const user = JSON.parse(userStr);
            const nom = user.nom ? user.nom.trim() : "";
            const prenom = user.prenom ? user.prenom.trim() : "";
            const fullName = (prenom + " " + nom).trim();
            const finalName = fullName ? fullName : (user.login ? user.login : "INCONNU");
            formData.append("userId", finalName);
        }

        try {
            const response = await axios.post(`${API_BASE}/ReleveBancaire/upload`, formData);
            alert(response.data.message);
            setTitre('');
            setFile(null);
            fetchReleves();
        } catch (error) {
            console.error("Erreur lors de l'upload", error);
            alert("Erreur lors de l'import");
        }
    };

    const handleDeleteReleve = async (id: number) => {
        if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce relevé ? Cette action supprimera également toutes ses lignes associées.")) {
            return;
        }

        try {
            await axios.delete(`${API_BASE}/ReleveBancaire/${id}`);
            alert("Relevé supprimé avec succès.");
            fetchReleves();
        } catch (error: any) {
            console.error("Erreur lors de la suppression", error);
            if (error.response?.status === 409) {
                alert(error.response.data.message || "Suppression impossible : lignes actionnées.");
            } else {
                alert("Erreur lors de la suppression du relevé.");
            }
        }
    };

    if (selectedReleve) {
        return <ReleveInterrogation releve={selectedReleve} caissesMap={caissesMap} onBack={() => setSelectedReleve(null)} />;
    }

    return (
        <div className="table-container" style={{ margin: '0', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="table-header-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
                <div className="flex items-center gap-2">
                    <span className="table-title">Gestion des Relevés Bancaires</span>
                </div>
                
                <form onSubmit={handleFileUpload} style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', flexWrap: 'wrap', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Banque / RIB</label>
                        <select 
                            value={selectedBanqueId} 
                            onChange={handleBanqueChange}
                            className="form-input"
                            style={{ padding: '8px', fontSize: '0.875rem' }}
                        >
                            <option value="">-- Choisir une Banque --</option>
                            {banques.map(b => (
                                <option key={b.id} value={b.id}>{b.code} - {b.rib}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Titre / Description</label>
                        <input 
                            type="text" 
                            placeholder="Ex: CIH Janvier" 
                            value={titre} 
                            onChange={(e) => setTitre(e.target.value)} 
                            className="form-input"
                            style={{ padding: '8px', fontSize: '0.875rem' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '200px' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Fichier Excel</label>
                        <input 
                            type="file" 
                            accept=".xls,.xlsx" 
                            onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
                            className="form-input"
                            style={{ padding: '8px', fontSize: '0.875rem', backgroundColor: 'white' }}
                        />
                    </div>

                    <button type="submit" className="btn" style={{ backgroundColor: 'var(--accent-primary)', color: 'white', padding: '8px 16px', fontWeight: 600, borderRadius: '8px', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', height: '38px', cursor: 'pointer' }}>
                        <Upload size={16} /> Importer
                    </button>
                </form>
            </div>
            
            <div style={{ overflow: 'auto', flex: 1, position: 'relative' }}>
                <table style={{ minWidth: '800px' }}>
                    <thead>
                        <tr>
                            <th style={{ width: '80px' }}>N°</th>
                            <th>Titre</th>
                            <th>Date d'Import</th>
                            <th>Importé Par</th>
                            <th style={{ textAlign: 'center' }}>Total</th>
                            <th style={{ textAlign: 'center' }}>Réservées</th>
                            <th style={{ textAlign: 'center' }}>Rapprochées</th>
                            <th style={{ textAlign: 'center' }}>Restantes</th>
                            <th style={{ width: '50px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {releves.map(r => (
                            <tr key={r.id} className="hover-row">
                                <td style={{ color: 'var(--text-secondary)' }}>#{r.id}</td>
                                <td 
                                    style={{ fontWeight: 500, cursor: 'pointer', color: 'var(--accent-primary)', textDecoration: 'underline' }} 
                                    onClick={() => setSelectedReleve(r)}
                                >
                                    {r.titre}
                                </td>
                                <td>{new Date(r.dateImport).toLocaleString('fr-FR')}</td>
                                <td>{r.importePar_UserId}</td>
                                <td style={{ textAlign: 'center', fontWeight: 600 }}>{r.totalLignes}</td>
                                <td style={{ textAlign: 'center', color: '#e67e22', fontWeight: 500 }}>{r.nbReserve > 0 ? r.nbReserve : '-'}</td>
                                <td style={{ textAlign: 'center', color: 'var(--success-color)', fontWeight: 500 }}>{r.nbRapproche > 0 ? r.nbRapproche : '-'}</td>
                                <td style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>{r.nbSansAction > 0 ? r.nbSansAction : '-'}</td>
                                <td style={{ textAlign: 'center' }}>
                                    {(r.nbReserve + r.nbRapproche === 0) && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleDeleteReleve(r.id); }}
                                            className="btn btn-ghost-danger" 
                                            style={{ padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            title="Supprimer le relevé"
                                        >
                                            <Trash2 size={16} color="#dc3545" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                        {releves.length === 0 && (
                            <tr>
                                <td colSpan={9} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                                    {selectedBanqueId ? "Aucun relevé importé pour cette banque." : "Veuillez sélectionner une banque."}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
