import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { MongoClient, ObjectId } from 'mongodb';

const app = express();

const port = Number(process.env.PORT || process.env.API_PORT || 3001);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || 'Tracker';
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const omdbApiKey = process.env.OMDB_API_KEY;
const MAX_POSTER_SIZE_BYTES = 20 * 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');

if (!mongoUri) {
  throw new Error('MONGODB_URI is required in .env');
}

const client = new MongoClient(mongoUri);
const db = client.db(databaseName);

app.use(cors({ origin: clientOrigin }));
// Accept larger transport payloads; poster size is validated separately at 20MB.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

type EntryType = 'movie' | 'series';

type BaseEntryPayload = {
  title: string;
  posterUrl: string;
  rating: number;
  userId: string;
};

type SeriesPayload = BaseEntryPayload & {
  currentSeason: number;
  currentEpisode: number;
};

function getCollectionName(type: string): 'movies' | 'series' {
  if (type === 'movie') {
    return 'movies';
  }

  if (type === 'series') {
    return 'series';
  }

  throw new Error('Invalid type. Expected movie or series.');
}

function estimateDataUrlBytes(dataUrl: string): number | null {
  const marker = ';base64,';
  const markerIndex = dataUrl.indexOf(marker);
  if (!dataUrl.startsWith('data:') || markerIndex === -1) {
    return null;
  }

  const base64 = dataUrl.slice(markerIndex + marker.length).replace(/\s/g, '');
  if (!base64) {
    return 0;
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function validateBasePayload(payload: Partial<BaseEntryPayload>): BaseEntryPayload {
  if (!payload.title || !payload.posterUrl || payload.rating === undefined || !payload.userId) {
    throw new Error('title, posterUrl, rating and userId are required');
  }

  const posterUrl = String(payload.posterUrl).trim();
  const posterSizeBytes = estimateDataUrlBytes(posterUrl);
  if (posterSizeBytes !== null && posterSizeBytes > MAX_POSTER_SIZE_BYTES) {
    throw new Error('Poster image exceeds 20MB limit.');
  }

  return {
    title: String(payload.title).trim(),
    posterUrl,
    rating: Number(payload.rating),
    userId: String(payload.userId),
  };
}

function validateSeriesPayload(payload: Partial<SeriesPayload>): SeriesPayload {
  const base = validateBasePayload(payload);

  if (payload.currentSeason === undefined || payload.currentEpisode === undefined) {
    throw new Error('currentSeason and currentEpisode are required for series');
  }

  return {
    ...base,
    currentSeason: Number(payload.currentSeason),
    currentEpisode: Number(payload.currentEpisode),
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: databaseName });
});

app.get('/api/omdb/search', async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();

    if (!query) {
      return res.status(400).json({ message: 'query parameter is required' });
    }

    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('s', query);
    url.searchParams.set('type', 'movie');
    url.searchParams.set('apikey', omdbApiKey);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('OMDb request failed');
    }

    const data = (await response.json()) as {
      Search?: Array<{
        Title: string;
        Year: string;
        imdbID: string;
        Type: string;
        Poster: string;
      }>;
      Response?: string;
      Error?: string;
    };

    if (data.Response === 'False') {
      return res.json({ results: [], totalResults: 0, error: data.Error || 'No results found.' });
    }

    return res.json({
      results: data.Search || [],
      totalResults: data.Search?.length || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search OMDb';
    return res.status(500).json({ message });
  }
});

app.get('/api/entries', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const userId = String(req.query.userId || '');

    if (!userId) {
      return res.status(400).json({ message: 'userId query parameter is required' });
    }

    const collectionName = getCollectionName(type);
    const entries = await db
      .collection(collectionName)
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();

    return res.json(
      entries.map((entry) => ({
        ...entry,
        id: entry._id.toString(),
        _id: undefined,
      })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch entries';
    return res.status(400).json({ message });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const collectionName = getCollectionName(type);

    const payload = type === 'series' ? validateSeriesPayload(req.body) : validateBasePayload(req.body);
    const document = {
      ...payload,
      createdAt: new Date().toISOString(),
    };

    const result = await db.collection(collectionName).insertOne(document);

    return res.status(201).json({ ...document, id: result.insertedId.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create entry';
    return res.status(400).json({ message });
  }
});

app.put('/api/entries/:id', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const id = req.params.id;
    const collectionName = getCollectionName(type);

    const payload = type === 'series' ? validateSeriesPayload(req.body) : validateBasePayload(req.body);

    await db.collection(collectionName).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...payload,
          updatedAt: new Date().toISOString(),
        },
      },
    );

    return res.json({ id, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update entry';
    return res.status(400).json({ message });
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const id = req.params.id;
    const collectionName = getCollectionName(type);

    await db.collection(collectionName).deleteOne({ _id: new ObjectId(id) });

    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete entry';
    return res.status(400).json({ message });
  }
});

app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (error && typeof error === 'object' && 'type' in error && (error as { type?: string }).type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Uploaded poster is too large. Please choose a smaller image (up to 20MB).',
    });
  }

  return next(error);
});

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }

    return res.sendFile(path.join(distPath, 'index.html'));
  });
}

async function start() {
  await client.connect();
  app.listen(port, () => {
    console.log(`MongoDB API server listening on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start API server:', error);
  process.exit(1);
});
