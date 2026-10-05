# Crono-Dia

Planificador diario para separar **Trabajo** y **Vida personal**: agenda por horas, horario fijo semanal,
marca lo que cumples, ve lo que dejaste pendiente ayer y recibe un aviso para planificar el día siguiente
(por defecto 11 pm) o el mismo día (8 am). Los datos se guardan en **Supabase** y se sincronizan entre celular y computadora.

Es una página estática (HTML, CSS y JavaScript, sin paso de build).

## Poner en marcha con Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor > New query**, pega todo `supabase/schema.sql` y ejecuta. Crea las tablas y deja activa la seguridad por usuario (RLS).
3. En **Project Settings > API** copia la **Project URL** y la clave **anon / publishable**, y pégalas en `config.js`.
   Nunca uses la clave `service_role` en este archivo.
4. En **Authentication > Providers** deja activo *Email*.
   - Para probar rápido, desactiva *Confirm email*; si lo dejas activo, cada cuenta nueva debe confirmar su correo.
   - En **Authentication > URL Configuration** pon la dirección donde publiques la app como *Site URL*.
5. Abre `index.html` (o publícalo) y crea tu cuenta.

Sin completar `config.js`, la app funciona en modo local: los datos quedan solo en ese navegador.

## Probar en tu computadora

```bash
python3 -m http.server 8080   # y abre http://localhost:8080
```

## Publicarla (GitHub Pages)

Repositorio > **Settings > Pages** > *Deploy from a branch* > rama `main`, carpeta `/ (root)`.
Luego agrega esa URL en Supabase como *Site URL* (paso 4).

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css` | Pantallas y estilos (tema claro y oscuro automático) |
| `js/app.js` | Lógica, acceso con correo y capa de datos (Supabase o modo local) |
| `config.js` | URL y clave pública de tu proyecto de Supabase |
| `supabase/schema.sql` | Tablas `tasks`, `routines`, `days`, `settings` con RLS |

## Sobre los avisos

Una página web no puede hacer sonar el celular si está cerrada. El aviso para planificar aparece dentro de la app
cuando la tienes abierta. Para que suene siempre, programa también una alarma o un recordatorio a esa hora.
