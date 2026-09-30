# Supabase setup (project `kqmihbpjhoymiedjxtsi`)

Nothing secret goes in chat or in git. Two things are needed, and they are handled differently.

## 1. Apply the database migrations (you run this, once per new migration)

The migrations in `supabase/migrations/` are applied to the hosted project with the Supabase CLI, from your own computer, using your own login. That keeps the database password with you.

```bash
npx supabase login
npx supabase link --project-ref kqmihbpjhoymiedjxtsi   # asks for the database password
npx supabase db push
```

Use a **new, empty** project for this. `db push` refuses nothing, so do not run it against a project that already holds data you care about.

After it succeeds, in the dashboard check Table Editor: every table shows "RLS enabled".

## 2. Give the app its keys (environment variables, not chat)

In the Claude session environment settings (cloud environment menu, then Edit), add:

| Variable                               | Value                                                            | Secret?          |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://kqmihbpjhoymiedjxtsi.supabase.co`                       | no               |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Dashboard > Project Settings > API Keys > publishable (anon) key | no, browser-safe |
| `QR_SIGNING_SECRET`                    | output of `openssl rand -base64 48`                              | **yes**          |

Also allow the network host `kqmihbpjhoymiedjxtsi.supabase.co` in the same environment settings (the environment currently blocks it, so the app cannot reach the project from a session).

Never give the service-role key or the database password to the app or to a session. The app does not need them: all access goes through the signed-in user and row-level security.

## 3. Auth settings to check in the dashboard

- Authentication > Providers: enable Email (magic link / OTP). Phone OTP needs an SMS provider and costs money, so start with email.
- Authentication > URL Configuration: Site URL and redirect URLs are set once hosting exists.
