import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { MongoClient, ObjectId, type Document } from 'mongodb';

const app = express();

const port = Number(process.env.PORT || process.env.API_PORT || 3001);
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || 'Tracker';
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';
const tmdbApiKey = process.env.TMDB_API_KEY;
const tmdbAccessToken = process.env.TMDB_ACCESS_TOKEN;
const MAX_POSTER_SIZE_BYTES = 20 * 1024 * 1024;
const TMDB_POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
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
type SharePermission = 'view' | 'edit';

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
  vote_average?: number;
};

type BaseEntryPayload = {
  title: string;
  posterUrl: string;
  rating: number;
};

type SeriesPayload = BaseEntryPayload & {
  currentSeason: number;
  currentEpisode: number;
};

type ShareDocument = {
  listId: string;
  listName: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  recipientEmail: string;
  permission: SharePermission;
  createdAt: string;
  updatedAt?: string;
};

type WatchListDocument = {
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validatePermission(permission: string): SharePermission {
  if (permission === 'view' || permission === 'edit') {
    return permission;
  }

  throw new Error('permission must be view or edit');
}

async function getListAccess(ownerUserId: string, currentUserId: string, currentUserEmail: string): Promise<'owner' | SharePermission | null> {
  if (ownerUserId === currentUserId) {
    return 'owner';
  }

  const email = normalizeEmail(currentUserEmail);
  if (!email) {
    return null;
  }

  const share = await db.collection<ShareDocument>('shares').findOne({
    ownerUserId,
    recipientEmail: email,
  });

  return share?.permission || null;
}

async function getOrCreateDefaultList(userId: string, email = '', displayName = ''): Promise<Document> {
  const existingList = await db.collection<WatchListDocument>('watchLists').findOne({
    ownerUserId: userId,
    isDefault: true,
  });

  if (existingList) {
    return existingList;
  }

  const now = new Date().toISOString();
  const document: WatchListDocument = {
    name: 'My List',
    ownerUserId: userId,
    ownerEmail: normalizeEmail(email),
    ownerName: displayName || email || 'My List',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  const result = await db.collection<WatchListDocument>('watchLists').insertOne(document);
  return { ...document, _id: result.insertedId };
}

async function getListById(listId: string): Promise<Document | null> {
  if (!ObjectId.isValid(listId)) {
    return null;
  }

  return db.collection<WatchListDocument>('watchLists').findOne({ _id: new ObjectId(listId) });
}

async function getListAccessById(listId: string, currentUserId: string, currentUserEmail: string): Promise<{
  access: 'owner' | SharePermission | null;
  list: Document | null;
}> {
  const list = await getListById(listId);
  if (!list) {
    return { access: null, list: null };
  }

  if (String(list.ownerUserId || '') === currentUserId) {
    return { access: 'owner', list };
  }

  const email = normalizeEmail(currentUserEmail);
  if (!email) {
    return { access: null, list };
  }

  const share = await db.collection<ShareDocument>('shares').findOne({
    listId,
    recipientEmail: email,
  });

  return { access: share?.permission || null, list };
}

function buildLegacyEntryQuery(ownerUserId: string, list: Document): Document {
  if (list.isDefault) {
    return {
      userId: ownerUserId,
      $or: [{ listId: String(list._id) }, { listId: { $exists: false } }, { listId: '' }, { listId: null }],
    };
  }

  return {
    userId: ownerUserId,
    listId: String(list._id),
  };
}

function canEditAccess(access: 'owner' | SharePermission | null): boolean {
  return access === 'owner' || access === 'edit';
}

function serializeDocument(entry: Document) {
  return {
    ...entry,
    id: entry._id.toString(),
    _id: undefined,
  };
}

function validateBasePayload(payload: Partial<BaseEntryPayload>): BaseEntryPayload {
  if (!payload.title || !payload.posterUrl || payload.rating === undefined) {
    throw new Error('title, posterUrl and rating are required');
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

app.post('/api/users', async (req, res) => {
  try {
    const userId = String(req.body.userId || '').trim();
    const email = normalizeEmail(String(req.body.email || ''));
    const displayName = String(req.body.displayName || '').trim();
    const photoUrl = String(req.body.photoUrl || '').trim();

    if (!userId || !email) {
      return res.status(400).json({ message: 'userId and email are required' });
    }

    const document = {
      userId,
      email,
      displayName,
      photoUrl,
      updatedAt: new Date().toISOString(),
    };

    await db.collection('users').updateOne(
      { userId },
      {
        $set: document,
        $setOnInsert: { createdAt: new Date().toISOString() },
      },
      { upsert: true },
    );

    await getOrCreateDefaultList(userId, email, displayName);

    return res.json(document);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save user profile';
    return res.status(400).json({ message });
  }
});

app.get('/api/lists', async (req, res) => {
  try {
    const userId = String(req.query.userId || '').trim();
    const email = normalizeEmail(String(req.query.email || ''));
    const displayName = String(req.query.displayName || '').trim();

    if (!userId || !email) {
      return res.status(400).json({ message: 'userId and email query parameters are required' });
    }

    await getOrCreateDefaultList(userId, email, displayName);

    const [ownedLists, sharedWithMe] = await Promise.all([
      db.collection<WatchListDocument>('watchLists').find({ ownerUserId: userId }).sort({ isDefault: -1, updatedAt: -1, createdAt: -1 }).toArray(),
      db.collection<ShareDocument>('shares').find({ recipientEmail: email }).sort({ updatedAt: -1, createdAt: -1 }).toArray(),
    ]);

    return res.json({
      ownedLists: ownedLists.map(serializeDocument),
      sharedWithMe: sharedWithMe.map(serializeDocument),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch lists';
    return res.status(400).json({ message });
  }
});

app.post('/api/lists', async (req, res) => {
  try {
    const ownerUserId = String(req.body.ownerUserId || '').trim();
    const ownerEmail = normalizeEmail(String(req.body.ownerEmail || ''));
    const ownerName = String(req.body.ownerName || '').trim();
    const name = String(req.body.name || '').trim();

    if (!ownerUserId || !ownerEmail || !name) {
      return res.status(400).json({ message: 'ownerUserId, ownerEmail and name are required' });
    }

    const now = new Date().toISOString();
    const document: WatchListDocument = {
      name,
      ownerUserId,
      ownerEmail,
      ownerName,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };

    const result = await db.collection<WatchListDocument>('watchLists').insertOne(document);
    return res.status(201).json({ ...document, id: result.insertedId.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create list';
    return res.status(400).json({ message });
  }
});

app.put('/api/lists/:id', async (req, res) => {
  try {
    const ownerUserId = String(req.body.ownerUserId || '').trim();
    const name = String(req.body.name || '').trim();

    if (!ownerUserId || !name) {
      return res.status(400).json({ message: 'ownerUserId and name are required' });
    }

    const result = await db.collection<WatchListDocument>('watchLists').findOneAndUpdate(
      { _id: new ObjectId(req.params.id), ownerUserId },
      { $set: { name, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'List not found' });
    }

    await db.collection<ShareDocument>('shares').updateMany(
      { listId: req.params.id, ownerUserId },
      { $set: { listName: name, updatedAt: new Date().toISOString() } },
    );

    return res.json(serializeDocument(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to rename list';
    return res.status(400).json({ message });
  }
});

app.delete('/api/lists/:id', async (req, res) => {
  try {
    const ownerUserId = String(req.query.ownerUserId || '').trim();

    if (!ownerUserId) {
      return res.status(400).json({ message: 'ownerUserId query parameter is required' });
    }

    const list = await getListById(req.params.id);
    if (!list || String(list.ownerUserId || '') !== ownerUserId) {
      return res.status(404).json({ message: 'List not found' });
    }

    const ownedListCount = await db.collection<WatchListDocument>('watchLists').countDocuments({ ownerUserId });
    if (ownedListCount <= 1) {
      return res.status(400).json({ message: 'You must keep at least one list.' });
    }

    await Promise.all([
      db.collection('movies').deleteMany(buildLegacyEntryQuery(ownerUserId, list)),
      db.collection('series').deleteMany(buildLegacyEntryQuery(ownerUserId, list)),
      db.collection<ShareDocument>('shares').deleteMany({ listId: req.params.id, ownerUserId }),
      db.collection<WatchListDocument>('watchLists').deleteOne({ _id: new ObjectId(req.params.id), ownerUserId }),
    ]);

    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete list';
    return res.status(400).json({ message });
  }
});

app.get('/api/shares', async (req, res) => {
  try {
    const userId = String(req.query.userId || '').trim();
    const email = normalizeEmail(String(req.query.email || ''));

    if (!userId || !email) {
      return res.status(400).json({ message: 'userId and email query parameters are required' });
    }

    const listId = String(req.query.listId || '').trim();
    const ownedShareQuery = listId ? { ownerUserId: userId, listId } : { ownerUserId: userId };

    const [ownedShares, sharedWithMe] = await Promise.all([
      db.collection<ShareDocument>('shares').find(ownedShareQuery).sort({ updatedAt: -1, createdAt: -1 }).toArray(),
      db.collection<ShareDocument>('shares').find({ recipientEmail: email }).sort({ updatedAt: -1, createdAt: -1 }).toArray(),
    ]);

    return res.json({
      ownedShares: ownedShares.map(serializeDocument),
      sharedWithMe: sharedWithMe.map(serializeDocument),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch shares';
    return res.status(400).json({ message });
  }
});

app.post('/api/shares', async (req, res) => {
  try {
    const listId = String(req.body.listId || '').trim();
    const ownerUserId = String(req.body.ownerUserId || '').trim();
    const ownerEmail = normalizeEmail(String(req.body.ownerEmail || ''));
    const ownerName = String(req.body.ownerName || '').trim();
    const recipientEmail = normalizeEmail(String(req.body.recipientEmail || ''));
    const permission = validatePermission(String(req.body.permission || ''));

    if (!listId || !ownerUserId || !ownerEmail || !recipientEmail) {
      return res.status(400).json({ message: 'listId, ownerUserId, ownerEmail and recipientEmail are required' });
    }

    if (ownerEmail === recipientEmail) {
      return res.status(400).json({ message: 'You cannot share your list with yourself.' });
    }

    const list = await getListById(listId);
    if (!list || String(list.ownerUserId || '') !== ownerUserId) {
      return res.status(404).json({ message: 'List not found' });
    }

    const now = new Date().toISOString();
    await db.collection<ShareDocument>('shares').updateOne(
      { listId, recipientEmail },
      {
        $set: {
          listId,
          listName: String(list.name || 'My List'),
          ownerUserId,
          ownerEmail,
          ownerName,
          recipientEmail,
          permission,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );

    const share = await db.collection<ShareDocument>('shares').findOne({ listId, recipientEmail });
    return res.status(201).json(share ? serializeDocument(share) : null);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save share';
    return res.status(400).json({ message });
  }
});

app.put('/api/shares/:id', async (req, res) => {
  try {
    const ownerUserId = String(req.body.ownerUserId || '').trim();
    const permission = validatePermission(String(req.body.permission || ''));
    const id = new ObjectId(req.params.id);

    if (!ownerUserId) {
      return res.status(400).json({ message: 'ownerUserId is required' });
    }

    const result = await db.collection<ShareDocument>('shares').findOneAndUpdate(
      { _id: id, ownerUserId },
      { $set: { permission, updatedAt: new Date().toISOString() } },
      { returnDocument: 'after' },
    );

    if (!result) {
      return res.status(404).json({ message: 'Share not found' });
    }

    return res.json(serializeDocument(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update share';
    return res.status(400).json({ message });
  }
});

app.delete('/api/shares/:id', async (req, res) => {
  try {
    const ownerUserId = String(req.query.ownerUserId || '').trim();

    if (!ownerUserId) {
      return res.status(400).json({ message: 'ownerUserId query parameter is required' });
    }

    await db.collection<ShareDocument>('shares').deleteOne({
      _id: new ObjectId(req.params.id),
      ownerUserId,
    });

    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove share';
    return res.status(400).json({ message });
  }
});

app.get('/api/tmdb/search', async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();
    const type = String(req.query.type || '');

    if (!query) {
      return res.status(400).json({ message: 'query parameter is required' });
    }

    if (type !== 'movie' && type !== 'series') {
      return res.status(400).json({ message: 'type query parameter must be movie or series' });
    }

    if (!tmdbApiKey && !tmdbAccessToken) {
      return res.status(500).json({ message: 'TMDB_API_KEY or TMDB_ACCESS_TOKEN is required in .env' });
    }

    const tmdbType = type === 'series' ? 'tv' : 'movie';
    const url = new URL(`https://api.themoviedb.org/3/search/${tmdbType}`);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('page', '1');

    const headers: HeadersInit = {};
    if (tmdbAccessToken) {
      headers.Authorization = `Bearer ${tmdbAccessToken}`;
    } else if (tmdbApiKey) {
      url.searchParams.set('api_key', tmdbApiKey);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error('TMDb request failed');
    }

    const data = (await response.json()) as {
      results?: TmdbSearchResult[];
      total_results?: number;
    };

    return res.json({
      results: (data.results || []).map((result) => {
        const title = type === 'series' ? result.name : result.title;
        const date = type === 'series' ? result.first_air_date : result.release_date;

        return {
          id: result.id,
          title: title || 'Untitled',
          year: date ? date.slice(0, 4) : '',
          mediaType: type,
          posterUrl: result.poster_path ? `${TMDB_POSTER_BASE_URL}${result.poster_path}` : '',
          overview: result.overview || '',
          voteAverage: result.vote_average ?? 0,
        };
      }),
      totalResults: data.total_results || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to search TMDb';
    return res.status(500).json({ message });
  }
});

app.get('/api/entries', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const userId = String(req.query.userId || '').trim();
    const userEmail = String(req.query.userEmail || '');
    const listId = String(req.query.listId || '').trim();

    if (!userId || !listId) {
      return res.status(400).json({ message: 'userId and listId query parameters are required' });
    }

    const { access, list } = await getListAccessById(listId, userId, userEmail);
    if (!access) {
      return res.status(403).json({ message: 'You do not have access to this list.' });
    }

    if (!list) {
      return res.status(404).json({ message: 'List not found' });
    }

    const collectionName = getCollectionName(type);
    const entries = await db
      .collection(collectionName)
      .find(buildLegacyEntryQuery(String(list.ownerUserId || ''), list))
      .sort({ createdAt: -1 })
      .toArray();

    return res.json(entries.map(serializeDocument));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch entries';
    return res.status(400).json({ message });
  }
});

app.post('/api/entries', async (req, res) => {
  try {
    const type = String(req.query.type || '') as EntryType;
    const collectionName = getCollectionName(type);
    const currentUserId = String(req.body.userId || '').trim();
    const currentUserEmail = String(req.body.userEmail || '');
    const listId = String(req.body.listId || '').trim();

    if (!currentUserId || !listId) {
      return res.status(400).json({ message: 'userId and listId are required' });
    }

    const { access, list } = await getListAccessById(listId, currentUserId, currentUserEmail);
    if (!canEditAccess(access)) {
      return res.status(403).json({ message: 'You only have view access to this list.' });
    }

    if (!list) {
      return res.status(404).json({ message: 'List not found' });
    }

    const payload = type === 'series' ? validateSeriesPayload(req.body) : validateBasePayload(req.body);
    const document = {
      ...payload,
      userId: String(list.ownerUserId || ''),
      listId,
      createdByUserId: currentUserId,
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
    const currentUserId = String(req.body.userId || '').trim();
    const currentUserEmail = String(req.body.userEmail || '');

    if (!currentUserId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const existingEntry = await db.collection(collectionName).findOne({ _id: new ObjectId(id) });
    if (!existingEntry) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const ownerUserId = String(existingEntry.userId || '');
    const entryListId = String(existingEntry.listId || req.body.listId || '');
    const { access, list } = entryListId
      ? await getListAccessById(entryListId, currentUserId, currentUserEmail)
      : { access: await getListAccess(ownerUserId, currentUserId, currentUserEmail), list: null };
    if (!canEditAccess(access)) {
      return res.status(403).json({ message: 'You only have view access to this list.' });
    }

    const payload = type === 'series' ? validateSeriesPayload(req.body) : validateBasePayload(req.body);

    await db.collection(collectionName).updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...payload,
          userId: ownerUserId,
          ...(entryListId ? { listId: entryListId } : {}),
          updatedByUserId: currentUserId,
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
    const currentUserId = String(req.query.userId || '').trim();
    const currentUserEmail = String(req.query.userEmail || '');
    const collectionName = getCollectionName(type);

    if (!currentUserId) {
      return res.status(400).json({ message: 'userId query parameter is required' });
    }

    const existingEntry = await db.collection(collectionName).findOne({ _id: new ObjectId(id) });
    if (!existingEntry) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const entryListId = String(existingEntry.listId || req.query.listId || '');
    const { access } = entryListId
      ? await getListAccessById(entryListId, currentUserId, currentUserEmail)
      : { access: await getListAccess(String(existingEntry.userId || ''), currentUserId, currentUserEmail) };
    if (!canEditAccess(access)) {
      return res.status(403).json({ message: 'You only have view access to this list.' });
    }

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
