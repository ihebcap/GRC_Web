import axios from 'axios';

// Get API base from runtime config, fallback to env variable, then relative path
export const API_BASE = (window as any).GOCOM_CONFIG?.API_BASE || import.meta.env.VITE_API_BASE || '/api';

const api = axios.create({
    baseURL: API_BASE,
});

// Optionally, you can add interceptors here to append tokens if needed
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// TASK-065 — Intercepteur de réponse : détecte un 403 GRLicence et déclenche
// un événement global pour que App.tsx affiche l'écran de blocage lisible.
// On distingue ce 403 "licence" d'un éventuel 403 métier en vérifiant la présence
// de la clé `error` dans le corps (contrat GRLicence : { error: string }).
// Un 401 (session expirée / JWT invalide) est volontairement laissé passer
// pour être traité séparément par les écrans.
//
// IMPORTANT : L'intercepteur est posé sur l'instance GLOBALE `axios` (pas sur
// l'instance locale `api` créée par axios.create), car tous les écrans de
// l'application (App.tsx, RapprochementBancaire.tsx, ApercuComptabilisation.tsx,
// ReglementGenerationEspece.tsx, RelevesBancaires.tsx) utilisent directement
// `axios.get` / `axios.post` — cohérent avec `axios.defaults.headers.common`
// déjà utilisé globalement dans App.tsx pour l'Authorization.
axios.interceptors.response.use(
    (response) => response,
    (error) => {
        if (
            error.response?.status === 403 &&
            error.response?.data?.error
        ) {
            // Émet un événement DOM custom : App.tsx écoute et bascule l'état de blocage.
            window.dispatchEvent(new CustomEvent('licence-blocked'));
        }
        return Promise.reject(error);
    }
);

export default api;
