import React from 'react';
import { ShieldOff } from 'lucide-react';

/**
 * TASK-065 — Écran de blocage licence
 * Affiché lorsque l'API répond 403 avec { error: "..." } (middleware GRLicence).
 * Aucun bouton de contournement : l'utilisateur ne peut pas bypasser le blocage.
 */
const LicenceBlockedScreen: React.FC = () => {
  return (
    <div id="licence-blocked-screen" style={{
      position: 'fixed',
      inset: 0,
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary, #0f1117)',
      color: 'var(--text-primary, #e2e8f0)',
      fontFamily: 'Inter, Roboto, sans-serif',
      padding: '2rem',
      textAlign: 'center',
      animation: 'fade-in 0.4s ease-out',
    }}>
      {/* Icon */}
      <div style={{
        width: '96px',
        height: '96px',
        borderRadius: '50%',
        background: 'rgba(239, 68, 68, 0.1)',
        border: '2px solid rgba(239, 68, 68, 0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: '2rem',
        boxShadow: '0 0 40px rgba(239, 68, 68, 0.15)',
      }}>
        <ShieldOff size={44} style={{ color: '#ef4444' }} />
      </div>

      {/* Titre */}
      <h1 style={{
        fontSize: '1.75rem',
        fontWeight: 700,
        marginBottom: '0.75rem',
        color: 'var(--text-primary, #e2e8f0)',
      }}>
        Application indisponible
      </h1>

      {/* Message principal */}
      <p style={{
        fontSize: '1rem',
        color: 'var(--text-secondary, #94a3b8)',
        maxWidth: '420px',
        lineHeight: 1.7,
        marginBottom: '0.5rem',
      }}>
        L'accès à cette application est temporairement bloqué.
      </p>
      <p style={{
        fontSize: '1rem',
        color: 'var(--text-secondary, #94a3b8)',
        maxWidth: '420px',
        lineHeight: 1.7,
        marginBottom: '2.5rem',
      }}>
        La licence n'est pas valide ou a expiré. Veuillez contacter votre administrateur système pour régulariser la situation.
      </p>

      {/* Séparateur visuel */}
      <div style={{
        width: '48px',
        height: '3px',
        borderRadius: '2px',
        background: 'linear-gradient(90deg, rgba(239,68,68,0.6), rgba(239,68,68,0.1))',
        marginBottom: '2rem',
      }} />

      {/* Mention d'aide */}
      <p style={{
        fontSize: '0.8rem',
        color: 'var(--text-tertiary, #64748b)',
        letterSpacing: '0.02em',
      }}>
        Code d'erreur : LICENCE_INVALIDE
      </p>
    </div>
  );
};

export default LicenceBlockedScreen;
