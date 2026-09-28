import { useState, useEffect, useRef, type FormEvent } from 'react';
import axios from 'axios';
import { X, Loader2, Save, Search, User, Calendar, DollarSign, Building2, FileText, Check } from 'lucide-react';
import { API_BASE } from './api';

interface Reglement {
  no: number;
  reference: string | null;
  date: string;
  dateEcheance: string;
  montant: number;
  montantDeviseSociete: number;
  etat: number;
  clientNo?: number;
  clientCode?: string | null;
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
  isAffecte?: boolean;
  pieceNumero: string | null;
  extraitNum: string | null;
  numero: string | null;
  libelle: string | null;
  soldeDeviseSociete: number;
}

interface ModifierReglementModalProps {
  reglement: Reglement;
  banquesMap: Record<number, any>;
  caissesMap: Record<number, any>;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function ModifierReglementModal({
  reglement,
  banquesMap,
  caissesMap,
  onClose,
  onSuccess,
  onError
}: ModifierReglementModalProps) {
  // Initial values
  const initialDate = reglement.date ? reglement.date.slice(0, 10) : '';
  const initialMontant = reglement.montant ?? reglement.montantDeviseSociete ?? 0;
  const initialBanqueNo = reglement.banqueNo ?? '';
  const initialRef = reglement.reference ?? '';
  const initialClientNo = reglement.clientNo ?? 0;
  const initialClientCode = reglement.clientCode ?? '';
  const initialClientIntitule = reglement.clientIntitule ?? '';

  // Form states
  const [date, setDate] = useState(initialDate);
  const [montant, setMontant] = useState<number | string>(initialMontant);
  const [banqueNo, setBanqueNo] = useState<number | ''>(initialBanqueNo);
  const [reference, setReference] = useState(initialRef);

  // Client states
  const [clientNo, setClientNo] = useState<number>(initialClientNo);
  const [clientCode, setClientCode] = useState<string>(initialClientCode);
  const [clientIntitule, setClientIntitule] = useState<string>(initialClientIntitule);

  // Client search states
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<any>(null);

  // Submission state
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Client search debounce
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_BASE}/reference/clients/search`, {
          params: { q: searchTerm.trim(), max: 30 }
        });
        setSuggestions(res.data || []);
      } catch (err) {
        console.error('Erreur recherche clients', err);
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchTerm]);

  const handleSelectClient = (c: any) => {
    setClientNo(c.no || c.No || c.id || c.Id);
    setClientCode(c.code || c.Code || '');
    setClientIntitule(c.intitule || c.Intitule || '');
    setSearchTerm('');
    setShowDropdown(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const numMontant = Number(montant);
    if (isNaN(numMontant) || numMontant <= 0) {
      setErrorMessage('Le montant doit être un nombre strictement supérieur à 0.');
      return;
    }

    if (!date) {
      setErrorMessage('La date est obligatoire.');
      return;
    }

    // Détection des changements réels
    const dateChanged = initialDate !== date;
    const montantChanged = Math.abs(Number(initialMontant) - numMontant) > 0.0001;
    const banqueChanged = (Number(initialBanqueNo) || 0) !== (Number(banqueNo) || 0);
    const refChanged = (initialRef || '').trim() !== (reference || '').trim();
    const clientChanged = (clientNo !== 0 && clientNo !== initialClientNo) ||
      (clientCode && clientCode.trim() !== (initialClientCode || '').trim());

    if (!dateChanged && !montantChanged && !banqueChanged && !refChanged && !clientChanged) {
      onSuccess('Aucune modification détectée.');
      onClose();
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        date: date ? new Date(date).toISOString() : null,
        montant: numMontant,
        banqueNo: banqueNo !== '' ? Number(banqueNo) : null,
        reference: reference ? reference.trim() : '',
        clientNo: clientNo || undefined,
        clientCode: clientCode || undefined,
        clientIntitule: clientIntitule || undefined
      };

      const res = await axios.put(`${API_BASE}/reglements/${reglement.no}`, payload);
      const msg = res.data?.message || `Règlement ${reglement.numero || reglement.no} modifié avec succès.`;
      onSuccess(msg);
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.title || err.message || 'Erreur lors de la modification du règlement.';
      setErrorMessage(typeof msg === 'string' ? msg : JSON.stringify(msg));
      onError(typeof msg === 'string' ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(2px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-primary, #ffffff)',
          borderRadius: '12px',
          padding: '1.75rem',
          width: '560px',
          maxWidth: '92vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid var(--border-color, #e5e7eb)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
              Modifier le règlement
            </h3>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', marginTop: '2px' }}>
              Règlement n° <strong style={{ color: 'var(--text-primary, #111827)' }}>{reglement.numero || reglement.no}</strong>
              {' '}&bull; Caisse : {caissesMap[reglement.caisseNo]?.code || reglement.caisseNo}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost"
            style={{ padding: '6px', borderRadius: '50%', color: 'var(--text-tertiary, #9ca3af)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: '0.75rem 1rem',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: '8px',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              border: '1px solid #f87171'
            }}
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Champ Client */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
              <User size={14} color="#3b82f6" />
              Client
            </label>

            {/* Client sélectionné actuel */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'var(--bg-secondary, #f9fafb)',
                border: '1px solid var(--border-color, #e5e7eb)',
                borderRadius: '6px',
                marginBottom: '6px'
              }}
            >
              <div style={{ fontSize: '0.875rem' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                  {clientIntitule || 'Client inconnu'}
                </span>
                {clientCode && (
                  <span style={{ marginLeft: '6px', fontSize: '0.75rem', padding: '1px 6px', backgroundColor: '#e0e7ff', color: '#4338ca', borderRadius: '4px' }}>
                    {clientCode}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #9ca3af)' }}>
                N° {clientNo || '—'}
              </span>
            </div>

            {/* Recherche nouveau client */}
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Rechercher pour changer de client (code ou intitulé)..."
                  value={searchTerm}
                  onChange={e => {
                    setSearchTerm(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  style={{ paddingLeft: '32px', fontSize: '0.8125rem' }}
                />
                <Search size={14} style={{ position: 'absolute', left: '10px', color: 'var(--text-tertiary, #9ca3af)' }} />
                {searching && (
                  <Loader2 size={14} className="animate-spin" style={{ position: 'absolute', right: '10px', color: 'var(--accent-primary, #2563eb)' }} />
                )}
              </div>

              {/* Dropdown suggestions */}
              {showDropdown && suggestions.length > 0 && (
                <ul
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    backgroundColor: 'var(--bg-primary, #ffffff)',
                    border: '1px solid var(--border-color, #e5e7eb)',
                    borderRadius: '8px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    zIndex: 20,
                    listStyle: 'none',
                    padding: 0,
                    margin: '4px 0 0 0'
                  }}
                >
                  {suggestions.map((c: any) => {
                    const cNo = c.no || c.No || c.id || c.Id;
                    const cCode = c.code || c.Code || '';
                    const cIntitule = c.intitule || c.Intitule || '';
                    const isCurrent = cNo === clientNo;

                    return (
                      <li
                        key={cNo}
                        onClick={() => handleSelectClient(c)}
                        style={{
                          padding: '8px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          backgroundColor: isCurrent ? '#eff6ff' : 'transparent',
                          fontSize: '0.8125rem',
                          borderBottom: '1px solid var(--border-color, #f3f4f6)'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = isCurrent ? '#eff6ff' : '#f9fafb')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = isCurrent ? '#eff6ff' : 'transparent')}
                      >
                        <div>
                          <strong style={{ color: 'var(--text-primary, #111827)' }}>{cIntitule}</strong>
                          <span style={{ marginLeft: '8px', color: 'var(--text-secondary, #6b7280)', fontSize: '0.75rem' }}>
                            ({cCode})
                          </span>
                        </div>
                        {isCurrent && <Check size={14} color="#2563eb" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            {/* Champ Date */}
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <Calendar size={14} color="#3b82f6" />
                Date
              </label>
              <input
                type="date"
                className="form-input"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                style={{ fontSize: '0.8125rem' }}
              />
            </div>

            {/* Champ Montant */}
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <DollarSign size={14} color="#3b82f6" />
                Montant
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="form-input"
                value={montant}
                onChange={e => setMontant(e.target.value)}
                required
                style={{ fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            {/* Champ Banque */}
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <Building2 size={14} color="#3b82f6" />
                Banque
              </label>
              <select
                className="form-input"
                value={banqueNo}
                onChange={e => setBanqueNo(e.target.value === '' ? '' : Number(e.target.value))}
                style={{ fontSize: '0.8125rem' }}
              >
                <option value="">(Aucune / Non spécifiée)</option>
                {Object.values(banquesMap).map((b: any) => (
                  <option key={b.id} value={b.id}>
                    {b.code ? `${b.code} - ${b.intitule || ''}` : (b.intitule || b.id)}
                  </option>
                ))}
              </select>
            </div>

            {/* Champ Référence */}
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                <FileText size={14} color="#3b82f6" />
                Référence
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Ex. CHQ 123456, VIR..."
                value={reference}
                onChange={e => setReference(e.target.value)}
                maxLength={50}
                style={{ fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Footer buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={loading}
              style={{ fontSize: '0.8125rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
            >
              Annuler
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{
                fontSize: '0.8125rem',
                padding: '0.5rem 1.25rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              <span>Enregistrer</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
