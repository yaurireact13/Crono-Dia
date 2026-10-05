// Datos públicos de tu proyecto de Supabase (Project Settings > API).
// La "anon key" es pública por diseño: la seguridad la da RLS en schema.sql.
// NUNCA pegues aquí la "service_role key".
// Si dejas esto vacío, la app funciona en modo local (datos solo en este navegador).
window.CRONODIA_CONFIG = {
  supabaseUrl: "",      // ej. "https://abcdxyz.supabase.co"
  supabaseAnonKey: ""   // ej. "eyJhbGciOi..." o "sb_publishable_..."
};
