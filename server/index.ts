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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');

if (!mongoUri) {
  throw new Error('MONGODB_URI is required in .env');
}

const client = new MongoClient(mongoUri);
const db = client.db(databaseName);

app.use(cors({ origin: clientOrigin }));
app.use(express.json());

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

function validateBasePayload(payload: Partial<BaseEntryPayload>): BaseEntryPayload {
  if (!payload.title || !payload.posterUrl || payload.rating === undefined || !payload.userId) {
    throw new Error('title, posterUrl, rating and userId are required');
  }

  return {
    title: String(payload.title).trim(),
    posterUrl: String(payload.posterUrl).trim(),
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
