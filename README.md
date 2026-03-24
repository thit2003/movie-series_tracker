# Movie and Series Tracker

This project now uses MongoDB as the Tracker database through an Express API.

## Prerequisites

- Node.js 18+
- A MongoDB database (Atlas or local)

## Environment

Create or update `.env` in the project root:

```env
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB=Tracker
API_PORT=3001
CLIENT_ORIGIN=http://localhost:3000
```

## Run locally

1. Install dependencies:
   npm install
2. Start frontend + API together:
   npm run dev
3. Open:
   http://localhost:3000

## API summary

- `GET /api/health`
- `GET /api/entries?type=movie|series&userId=<id>`
- `POST /api/entries?type=movie|series`
- `PUT /api/entries/:id?type=movie|series`
- `DELETE /api/entries/:id?type=movie|series`

## Deploy (single service)

This app can be deployed as one Node service that serves both API and frontend.

### Render deployment

1. Push this project to GitHub.
2. In Render, create a new `Web Service` from the repo.
3. Configure:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`
4. Add environment variables:
   - `MONGODB_URI`
   - `MONGODB_DB=Tracker`
   - `CLIENT_ORIGIN=https://<your-render-domain>`
   - `NODE_ENV=production`
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
5. Deploy and open your Render URL.

Notes:
- The server automatically uses `PORT` provided by the platform.
- In production, Express serves the built frontend from `dist` and API from `/api/*`.

### Firebase Sign-In on Render

If Google Sign-In works locally but fails on Render, verify all of these:

1. Firebase Console -> Authentication -> Sign-in method -> Google is enabled.
2. Firebase Console -> Authentication -> Settings -> Authorized domains includes your Render domain.
3. All `VITE_FIREBASE_*` variables are set in Render environment variables.
4. You trigger a full redeploy after changing any `VITE_` variable, because these are baked into the frontend at build time.
