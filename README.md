# Elizabeth & Angela's OIT MLS Graduation

Static GitHub Pages invitation site with:

- RSVP form
- Public yes/maybe/no totals
- Anonymous message board
- Admin preview login
- Address, hotel, food, weather, and photos
- Confetti celebration animation
- Admin page editor for site text/details
- Optional Supabase storage for the real live site

## Shared Supabase Project

You can use the same Supabase project for Arbolito and this graduation site.

This project uses only prefixed objects:

- `graduation_rsvps`
- `graduation_messages`
- `graduation_rsvp_totals`
- `graduation_site_settings`
- `graduation_admin_config`
- policies whose names start with `graduation`
- password-protected SQL functions whose names start with `graduation_admin`

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

The default admin password created by the SQL is `cats`.

## Private Admin

The preview password is `cats`, but that is not secure if the page is public.

For the real private admin view, deploy `supabase-admin-function.ts` as a Supabase Edge Function and set these function secrets:

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
