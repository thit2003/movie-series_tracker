# Movie & Series Tracker

A full-stack web application for tracking movies and TV series. The app uses a MongoDB database and an Express-based API, with the frontend and backend deployable as a single Node.js service.

**Test my app at https://tracker-353i.onrender.com**

## Features

- Track movies and series entries in a personal list
- Search titles via the OMDb API (with a helper in the add/edit modal to populate title and poster)
- REST API for managing entries
- Single-service deployment (API + frontend)

## Tech stack

- TypeScript
- Node.js + Express
- MongoDB
- Vite (frontend build)

## Prerequisites

- Node.js 18+
- MongoDB (Atlas or local)

## Configuration

Create or update a `.env` file in the project root:

```env
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB=Tracker
API_PORT=3001
CLIENT_ORIGIN=http://localhost:3000
OMDB_API_KEY=b75e2301
```

> Note: In production, the server will use the `PORT` environment variable provided by the hosting platform.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the frontend and API in development mode:
   ```bash
   npm run dev
   ```
3. Open the app:
   - http://localhost:3000

## API endpoints

- `GET /api/health`
- `GET /api/omdb/search?query=<movie title>`
- `GET /api/entries?type=movie|series&userId=<id>`
- `POST /api/entries?type=movie|series`
- `PUT /api/entries/:id?type=movie|series`
- `DELETE /api/entries/:id?type=movie|series`

## Deployment (single service)

This project can be deployed as a single Node.js web service that serves both the API and the built frontend.

### Render deployment

1. Push the project to GitHub.
2. In Render, create a new **Web Service** from the repository.
3. Configure:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm run start`
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

### Firebase Google Sign-In on Render

If Google Sign-In works locally but fails on Render, verify the following:

1. Firebase Console → **Authentication** → **Sign-in method**: Google is enabled.
2. Firebase Console → **Authentication** → **Settings** → **Authorized domains** includes your Render domain.
3. All `VITE_FIREBASE_*` variables are set in Render environment variables.
4. Trigger a full redeploy after changing any `VITE_` variables (they are baked into the frontend at build time).