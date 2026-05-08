// ===================================================================
// Sistema de Bonos · Tinto Banquetería · config
// ===================================================================
// API_URL: deployment Web App del Apps Script Centralizado.
// Es el MISMO deploymentId que sirve el WebApp.html legacy — el
// backend routea por presencia de ?action= o body POST con action.
// Si action está presente, devuelve JSON. Si no, devuelve el HTML viejo.
window.API_URL = 'https://script.google.com/macros/s/AKfycbxzoKo6_ogpb_U7sBPu2qrkXKBmd9qVJuKzjke_JWNQZBi3E0FgARUViluQJxwZOD2H/exec';

// CURRENT_USER_EMAIL: lo llena app.js al iniciar leyendo
// /cdn-cgi/access/get-identity (Cloudflare Access) cuando esté en producción.
// Mientras tanto se mantiene vacío y el backend usa el deployer como autor.
window.CURRENT_USER_EMAIL = '';
