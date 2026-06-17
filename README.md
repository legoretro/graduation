# Elizabeth & Angela's OIT MLS Graduation

Static GitHub Pages invitation site with:

- RSVP form
- Public yes/maybe/no totals
- Anonymous pastel message board
- Guest memory-strip photo uploads
- Admin login
- Address, hotel, food, weather, and photos
- Confetti celebration animation
- Admin page editor for site text/details
- Supabase-backed live data for the real site

## Shared Supabase Project

You can use the same Supabase project for Arbolito and this graduation site.

This project uses only prefixed objects:

- `graduation_rsvps`
- `graduation_messages`
- `graduation_memories`
- `graduation_rsvp_totals`
- `graduation_site_settings`
- `graduation_admin_config`
- policies whose names start with `graduation`
- SQL functions whose names start with `graduation`

That keeps it separate from Arbolito as long as Arbolito uses different table names.

## Setup Supabase

1. Open your existing Supabase project.
2. Go to SQL Editor.
3. Run `supabase-schema.sql`.
4. In `config.js`, set:

```js
supabase: {
  enabled: true,
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_PUBLIC_ANON_KEY",
  tablePrefix: "graduation_",
  adminEndpoint: ""
}
```

The anon key is okay to put in GitHub Pages. Do not put the service role key in GitHub.

Set the admin password only in Supabase. Do not put it in `config.js`.

Guest photo uploads are compressed in the browser and saved to `graduation_memories`.
Each phone gets a private browser token so guests can delete only the memories they
uploaded from that same phone. Admin can delete any memory from the dashboard.

## Private Admin

The admin password is stored as a hash in Supabase by the SQL setup. The site does not show it or store it in `config.js`.

Optional advanced path: deploy `supabase-admin-function.ts` as a Supabase Edge Function and set these function secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GRADUATION_ADMIN_PASSWORD`

Then paste the deployed function URL into `config.js`:

```js
adminEndpoint: "https://YOUR_PROJECT.functions.supabase.co/graduation-admin"
```

## Editing Content

Most visible text is in `config.js`.

- Add the final date and time there.
- Put Canva invitation/photo files in `assets/`.
- Set `invitationImage: "assets/canva-invitation.png"`.
- Add your real GitHub Pages URL to `links.liveSiteUrl` if it ever changes.

## GitHub Pages

Because this is a no-build static site, publish from the repository root:

Settings -> Pages -> Deploy from branch -> `main` -> `/root`
