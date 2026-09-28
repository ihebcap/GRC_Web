import { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Loader2, History, ArrowRight } from 'lucide-react';
import { API_BASE } from './api';
import { formatMoney } from './utils';

interface Reglement {
  no: number;
  reference: string | null;
  date: string;
  montant: number;
  montantDeviseSociete: number;
  clientIntitule: string;
  numero: string | null;
}

interface HistoriqueItem {
  id: number;
  reglementNo: number;
  userId: number;
  userName: string;
  dateModification: string;
  champsModifies: string;
  ancienneDate?: string | null;
  nouvelleDate?: string | null;
  ancienClientNo?: number | null;
  nouveauClientNo?: number | null;
  ancienClientCode?: string | null;
  nouveauClientCode?: string | null;
  ancienClientIntitule?: string | null;
  nouveauClientIntitule?: string | null;
  ancienMontant?: number | null;
  nouveauMontant?: number | null;
  ancienneBanqueNo?: number | null;
  nouvelleBanqueNo?: number | null;
  ancienneReference?: string | null;
  nouvelleReference?: string | null;
  modificationsJson?: string | null;
}

interface HistoriqueReglementModalProps {
  reglement: Reglement;
  banquesMap: Record<number, any>;
  onClose: () => void;
}

export function HistoriqueReglementModal({
  reglement,
  banquesMap,
  onClose
}: HistoriqueReglementModalProps) {
  const [items, setItems] = useState<HistoriqueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    axios
      .get(`${API_BASE}/reglements/${reglement.no}/historique`)
      .then(res => {
        if (isMounted) {
          setItems(res.data || []);
        }
      })
      .catch(err => {
        console.error('Erreur chargement historique', err);
        if (isMounted) {
          const msg = err.response?.data?.message || err.message || "Erreur lors du chargement de l'historique.";
          setError(typeof msg === 'string' ? msg : JSON.stringify(msg));
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [reglement.no]);

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
          width: '760px',
          maxWidth: '94vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          border: '1px solid var(--border-color, #e5e7eb)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ padding: '6px', borderRadius: '8px', backgroundColor: '#f3f4f6', color: '#4b5563' }}>
              <History size={18} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                Historique des modifications
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #6b7280)', marginTop: '2px' }}>
                Règlement n° <strong style={{ color: 'var(--text-primary, #111827)' }}>{reglement.numero || reglement.no}</strong>
                {' '}&bull; {reglement.clientIntitule} &bull; {formatMoney(reglement.montantDeviseSociete || reglement.montant)}
              </div>
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

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', minHeight: '160px' }}>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: 'var(--text-secondary, #6b7280)' }}>
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary, #2563eb)', marginBottom: '8px' }} />
              <span style={{ fontSize: '0.85rem' }}>Chargement de l'historique...</span>
            </div>
          )}

          {error && (
            <div style={{ padding: '1rem', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.85rem' }}>
              {error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-tertiary, #9ca3af)', fontSize: '0.875rem' }}>
              Aucune modification enregistrée pour ce règlement.
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {items.map(item => {
                const dateStr = item.dateModification
                  ? new Date(item.dateModification).toLocaleString('fr-FR', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })
                  : '—';

                return (
                  <div
                    key={item.id}
                    style={{
                      border: '1px solid var(--border-color, #e5e7eb)',
                      borderRadius: '8px',
                      padding: '0.875rem 1rem',
                      backgroundColor: 'var(--bg-secondary, #fafafa)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid #f3f4f6', paddingBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary, #111827)' }}>
                          {item.userName || `Utilisateur #${item.userId}`}
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: '#e0f2fe', color: '#0369a1', fontWeight: 500 }}>
                          {item.champsModifies}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #6b7280)' }}>
                        {dateStr}
                      </span>
                    </div>

                    {/* Diff Details */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '8px', fontSize: '0.8125rem' }}>
                      {/* Date */}
                      {item.ancienneDate && item.nouvelleDate && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)', minWidth: '70px' }}>Date :</span>
                          <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>
                            {item.ancienneDate.slice(0, 10)}
                          </span>
                          <ArrowRight size={12} color="#9ca3af" />
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>
                            {item.nouvelleDate.slice(0, 10)}
                          </span>
                        </div>
                      )}

                      {/* Montant */}
                      {item.ancienMontant !== null && item.ancienMontant !== undefined && item.nouveauMontant !== null && item.nouveauMontant !== undefined && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)', minWidth: '70px' }}>Montant :</span>
                          <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>
                            {formatMoney(item.ancienMontant)}
                          </span>
                          <ArrowRight size={12} color="#9ca3af" />
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>
                            {formatMoney(item.nouveauMontant)}
                          </span>
                        </div>
                      )}

                      {/* Client */}
                      {(item.ancienClientIntitule || item.nouveauClientIntitule) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', gridColumn: '1 / -1' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)', minWidth: '70px' }}>Client :</span>
                          <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>
                            {item.ancienClientIntitule} {item.ancienClientCode ? `(${item.ancienClientCode})` : ''}
                          </span>
                          <ArrowRight size={12} color="#9ca3af" />
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>
                            {item.nouveauClientIntitule} {item.nouveauClientCode ? `(${item.nouveauClientCode})` : ''}
                          </span>
                        </div>
                      )}

                      {/* Banque */}
                      {(item.ancienneBanqueNo !== null && item.ancienneBanqueNo !== undefined) && (item.nouvelleBanqueNo !== null && item.nouvelleBanqueNo !== undefined) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)', minWidth: '70px' }}>Banque :</span>
                          <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>
                            {banquesMap[item.ancienneBanqueNo]?.code || item.ancienneBanqueNo || '(Aucune)'}
                          </span>
                          <ArrowRight size={12} color="#9ca3af" />
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>
                            {banquesMap[item.nouvelleBanqueNo]?.code || item.nouvelleBanqueNo || '(Aucune)'}
                          </span>
                        </div>
                      )}

                      {/* Référence */}
                      {(item.ancienneReference !== null || item.nouvelleReference !== null) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ color: 'var(--text-secondary, #6b7280)', minWidth: '70px' }}>Référence :</span>
                          <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>
                            {item.ancienneReference || '(vide)'}
                          </span>
                          <ArrowRight size={12} color="#9ca3af" />
                          <span style={{ fontWeight: 600, color: '#16a34a' }}>
                            {item.nouvelleReference || '(vide)'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border-color, #e5e7eb)', marginTop: '1rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            style={{ fontSize: '0.8125rem', padding: '0.5rem 1.25rem', cursor: 'pointer' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
