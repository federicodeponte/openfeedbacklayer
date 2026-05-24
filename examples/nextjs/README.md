# OpenFeedbackLayer Next.js Example

This is a minimal App Router project that installs the local package and renders `<FeedbackWidget />`.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and use the floating feedback button.

For production deploys use `npm run build && npm start`.

## Environment

Set Supabase credentials before submitting feedback:

```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx
```

Optional values enable AI classification, email, GitHub issue creation, and webhook updates. See `.env.example` for the full list.

## Supabase

Run the migrations from the package root `supabase/migrations` directory in your Supabase SQL editor before using the API route.
