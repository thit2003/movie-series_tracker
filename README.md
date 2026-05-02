# Movie & Series Tracker

A full-stack watch tracker for saving movies and TV series, rating them, and keeping track of current season and episode progress. The app uses Google sign-in, stores each user's watchlist in MongoDB, and uses TMDb search to fill movie and series titles/posters automatically.

## Live Demo

[https://tracker-353i.onrender.com](https://tracker-353i.onrender.com)

## Features

- Google authentication with Firebase
- Separate movie and TV series tabs
- TMDb search for both movies and series
- Automatic poster selection from TMDb
- Manual poster upload fallback
- Movie and series ratings from 0 to 10
- Series progress tracking by season and episode
- Search, sort, edit, and delete saved entries
- Express API with MongoDB persistence

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Express
- MongoDB
- Firebase Authentication
- TMDb API

## Prerequisites

- Node.js 18+
- npm
- MongoDB database, either local or MongoDB Atlas
- Firebase project with Google sign-in enabled
- TMDb API key or TMDb access token

## Environment Variables

Create a `.env` file in the project root:

```env
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB=Tracker
API_PORT=3001
CLIENT_ORIGIN=http://localhost:3000

TMDB_API_KEY=your_tmdb_v3_api_key
# Or use this instead of TMDB_API_KEY:
# TMDB_ACCESS_TOKEN=your_tmdb_access_token

VITE_FIREBASE_API_KEY=your_firebase_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start the Vite client and Express API together:

```bash
npm run dev
```

Open the app:

[http://localhost:3000](http://localhost:3000)

The API runs on:

[http://localhost:3001](http://localhost:3001)

## Test Locally

Run the TypeScript check:

```bash
npm run lint
```

Build the production frontend:

```bash
npm run build
```

Test the API health route:

```bash
curl http://localhost:3001/api/health
```

Test TMDb movie search:

```bash
curl "http://localhost:3001/api/tmdb/search?type=movie&query=inception"
```

Test TMDb series search:

```bash
curl "http://localhost:3001/api/tmdb/search?type=series&query=breaking%20bad"
```

## API Summary

- `GET /api/health`
- `GET /api/tmdb/search?type=movie|series&query=<title>`
- `GET /api/entries?type=movie|series&userId=<id>`
- `POST /api/entries?type=movie|series`
- `PUT /api/entries/:id?type=movie|series`
- `DELETE /api/entries/:id?type=movie|series`

## Deployment

The app is deployed as a single Node service. Express serves the API from `/api/*` and serves the built Vite frontend from `dist` in production.

For Render:

1. Create a new Web Service from the GitHub repository.
2. Use `npm install && npm run build` as the build command.
3. Use `npm run start` as the start command.
4. Add the same environment variables used locally.
5. Set `CLIENT_ORIGIN` to your Render URL.
6. Add the Render domain to Firebase Authentication authorized domains.

## Firebase Notes

If Google sign-in fails after deployment:

1. Make sure Google sign-in is enabled in Firebase Authentication.
2. Add your Render domain to Firebase authorized domains.
3. Confirm all `VITE_FIREBASE_*` variables are set in Render.
4. Redeploy after changing any `VITE_` variable because Vite embeds them during build.
