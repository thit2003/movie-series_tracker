import { useState, useEffect, useMemo, useCallback } from 'react';
import { Movie, Series, EntryType, Share, SharedList, SharePermission, WatchList } from './types';
import { 
  Plus, 
  Film, 
  Tv, 
  Star, 
  Trash2, 
  Edit2, 
  Search, 
  X,
  Loader2,
  LogOut,
  Share2,
  Users,
  Eye,
  Pencil
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, logout } from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_POSTER_FALLBACK = 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=800';

type TmdbSearchResult = {
  id: number;
  title: string;
  year: string;
  mediaType: EntryType;
  posterUrl: string;
  overview: string;
  voteAverage: number;
};

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<EntryType>('movie');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'rating' | 'title' | 'newest'>('newest');
  const [tmdbSearchQuery, setTmdbSearchQuery] = useState('');
  const [tmdbSearchResults, setTmdbSearchResults] = useState<TmdbSearchResult[]>([]);
  const [tmdbSearchLoading, setTmdbSearchLoading] = useState(false);
  const [tmdbSearchError, setTmdbSearchError] = useState('');
  const [tmdbSearchLocked, setTmdbSearchLocked] = useState(false);
  const [ownedLists, setOwnedLists] = useState<WatchList[]>([]);
  const [ownedShares, setOwnedShares] = useState<Share[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<Share[]>([]);
  const [activeListId, setActiveListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [renameListName, setRenameListName] = useState('');
  const [listSaving, setListSaving] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<SharePermission>('view');
  const [shareSaving, setShareSaving] = useState(false);
  
  // Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Movie | Series | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    posterUrl: '',
    rating: 5,
    currentSeason: 1,
    currentEpisode: 1
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setActiveListId('');
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const fetchLists = useCallback(async () => {
    if (!user?.uid || !user.email) {
      setOwnedLists([]);
      setOwnedShares([]);
      setSharedWithMe([]);
      return;
    }

    try {
      await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.uid,
          email: user.email,
          displayName: user.displayName || '',
          photoUrl: user.photoURL || '',
        }),
      });

      const response = await fetch(`/api/lists?userId=${encodeURIComponent(user.uid)}&email=${encodeURIComponent(user.email)}&displayName=${encodeURIComponent(user.displayName || '')}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to fetch lists');
      }

      const nextOwnedLists = (data?.ownedLists as WatchList[] | undefined) || [];
      setOwnedLists(nextOwnedLists);
      setSharedWithMe((data?.sharedWithMe as Share[] | undefined) || []);

      if (!activeListId && nextOwnedLists[0]?.id) {
        setActiveListId(nextOwnedLists[0].id);
      }
    } catch (error) {
      console.error('List fetch error:', error);
      toast.error('Failed to load watching lists.');
    }
  }, [activeListId, user]);

  const fetchShares = useCallback(async (listId = activeListId) => {
    if (!user?.uid || !user.email || !listId) {
      setOwnedShares([]);
      return;
    }

    try {
      const response = await fetch(`/api/shares?userId=${encodeURIComponent(user.uid)}&email=${encodeURIComponent(user.email)}&listId=${encodeURIComponent(listId)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Failed to fetch shares');
      }

      setOwnedShares((data?.ownedShares as Share[] | undefined) || []);
    } catch (error) {
      console.error('Share fetch error:', error);
      toast.error('Failed to load sharing settings.');
    }
  }, [activeListId, user?.email, user?.uid]);

  useEffect(() => {
    void fetchLists();
  }, [fetchLists]);

  useEffect(() => {
    void fetchShares();
  }, [fetchShares]);

  const handlePosterFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast.error('Please select a valid image file.');
      event.target.value = '';
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      toast.error('Image is too large. Please choose one under 20MB.');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setFormData((prev) => ({ ...prev, posterUrl: result }));
      }
    };
    reader.onerror = () => {
      toast.error('Failed to read selected image. Please try another file.');
    };

    reader.readAsDataURL(file);
  };

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      if (!user?.uid || !activeListId) {
        setMovies([]);
        setSeries([]);
        setLoading(false);
        return;
      }

      const entryQuery = new URLSearchParams({
        userId: user.uid,
        userEmail: user.email || '',
        listId: activeListId,
      });

      const [moviesResponse, seriesResponse] = await Promise.all([
        fetch(`/api/entries?type=movie&${entryQuery.toString()}`),
        fetch(`/api/entries?type=series&${entryQuery.toString()}`),
      ]);

      if (!moviesResponse.ok || !seriesResponse.ok) {
        throw new Error('Request failed');
      }

      const [moviesData, seriesData] = await Promise.all([
        moviesResponse.json(),
        seriesResponse.json(),
      ]);

      setMovies(moviesData as Movie[]);
      setSeries(seriesData as Series[]);
    } catch (error) {
      console.error('Fetch error:', error);
      toast.error('Failed to fetch tracker entries.');
    } finally {
      setLoading(false);
    }
  }, [activeListId, user?.email, user?.uid]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-entry-card="true"]')) {
        setActiveEntryId(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const sharedLists = useMemo<SharedList[]>(() => {
    return [
      ...ownedLists.map((list) => ({
        id: list.id,
        name: list.name,
        ownerUserId: list.ownerUserId,
        ownerEmail: list.ownerEmail,
        ownerName: list.ownerName || 'My List',
        permission: 'owner',
        isDefault: list.isDefault,
      }) as SharedList),
      ...sharedWithMe.map((share) => ({
        id: share.listId,
        name: share.listName || 'Shared List',
        ownerUserId: share.ownerUserId,
        ownerEmail: share.ownerEmail,
        ownerName: share.ownerName || share.ownerEmail,
        permission: share.permission,
      })),
    ];
  }, [ownedLists, sharedWithMe]);

  const activeList = useMemo(() => {
    return sharedLists.find((list) => list.id === activeListId) || sharedLists[0];
  }, [activeListId, sharedLists]);

  const canEditActiveList = activeList?.permission === 'owner' || activeList?.permission === 'edit';

  useEffect(() => {
    if (!sharedLists.length) {
      return;
    }

    if (!sharedLists.some((list) => list.id === activeListId)) {
      setActiveListId(sharedLists[0].id);
    }
  }, [activeListId, sharedLists]);

  useEffect(() => {
    setRenameListName(activeList?.permission === 'owner' ? activeList.name : '');
  }, [activeList?.id, activeList?.name, activeList?.permission]);

  const filteredEntries = useMemo(() => {
    const list = activeTab === 'movie' ? movies : series;
    let result = list.filter(item => 
      item.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (sortBy === 'rating') {
      result.sort((a, b) => b.rating - a.rating);
    } else if (sortBy === 'title') {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === 'newest') {
      // Already sorted by createdAt desc in query, but good to have as fallback
    }

    return result;
  }, [activeTab, movies, series, searchQuery, sortBy]);

  const handleOpenModal = (entry?: Movie | Series) => {
    if (!canEditActiveList) {
      toast.error('You only have view access to this list.');
      return;
    }

    if (entry) {
      setEditingEntry(entry);
      setFormData({
        title: entry.title,
        posterUrl: entry.posterUrl,
        rating: entry.rating,
        currentSeason: (entry as Series).currentSeason || 1,
        currentEpisode: (entry as Series).currentEpisode || 1
      });
      setTmdbSearchQuery(entry.title);
      setTmdbSearchLocked(true);
    } else {
      setEditingEntry(null);
      setFormData({
        title: '',
        posterUrl: '',
        rating: 5,
        currentSeason: 1,
        currentEpisode: 1
      });
      setTmdbSearchQuery('');
      setTmdbSearchLocked(false);
    }
    setTmdbSearchResults([]);
    setTmdbSearchError('');
    setIsModalOpen(true);
  };

  const handleTmdbSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setTmdbSearchResults([]);
      setTmdbSearchError('');
      return;
    }

    setTmdbSearchLoading(true);
    setTmdbSearchError('');

    try {
      const response = await fetch(`/api/tmdb/search?type=${activeTab}&query=${encodeURIComponent(trimmedQuery)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Search failed');
      }

      if (data?.error) {
        setTmdbSearchResults([]);
        setTmdbSearchError(data.error);
        return;
      }

      setTmdbSearchResults((data?.results as TmdbSearchResult[] | undefined) || []);
      if (!data?.results?.length) {
        setTmdbSearchError(`No ${activeTab === 'movie' ? 'movies' : 'series'} matched your search.`);
      }
    } catch (error) {
      console.error('TMDb search error:', error);
      setTmdbSearchResults([]);
      setTmdbSearchError(`Failed to search ${activeTab === 'movie' ? 'movies' : 'series'}.`);
    } finally {
      setTmdbSearchLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isModalOpen || tmdbSearchLocked) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void handleTmdbSearch(tmdbSearchQuery);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [handleTmdbSearch, isModalOpen, tmdbSearchLocked, tmdbSearchQuery]);

  const handleSelectTmdbResult = (result: TmdbSearchResult) => {
    setFormData((prev) => ({
      ...prev,
      title: result.title,
      posterUrl: result.posterUrl || DEFAULT_POSTER_FALLBACK,
    }));
    setTmdbSearchQuery(result.title);
    setTmdbSearchLocked(true);
    setTmdbSearchResults([]);
    setTmdbSearchError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.uid) {
      toast.error('You must be signed in to save entries.');
      return;
    }

    if (!canEditActiveList || !activeList?.id) {
      toast.error('You only have view access to this list.');
      return;
    }

    if (!formData.posterUrl) {
      toast.error(`Please select a ${activeTab === 'movie' ? 'movie' : 'series'} from TMDb search or add a poster image.`);
      return;
    }

    try {
      const data = {
        title: formData.title,
        posterUrl: formData.posterUrl,
        rating: Number(formData.rating),
        userId: user.uid,
        userEmail: user.email || '',
        listId: activeList.id,
        ...(activeTab === 'series' ? {
          currentSeason: Number(formData.currentSeason),
          currentEpisode: Number(formData.currentEpisode)
        } : {})
      };

      if (editingEntry) {
        const response = await fetch(`/api/entries/${editingEntry.id}?type=${activeTab}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error('Update failed');
        }

        toast.success(`${activeTab === 'movie' ? 'Movie' : 'Series'} updated!`);
      } else {
        const response = await fetch(`/api/entries?type=${activeTab}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error('Create failed');
        }

        toast.success(`${activeTab === 'movie' ? 'Movie' : 'Series'} added!`);
      }
      setIsModalOpen(false);
      await fetchEntries();
    } catch (error) {
      console.error("Submit error:", error);
      toast.error("Failed to save entry.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user?.uid || !canEditActiveList) {
      toast.error('You only have view access to this list.');
      return;
    }

    if (!window.confirm("Are you sure you want to delete this entry?")) return;
    try {
      const deleteQuery = new URLSearchParams({
        type: activeTab,
        userId: user.uid,
        userEmail: user.email || '',
        listId: activeList?.id || '',
      });
      const response = await fetch(`/api/entries/${id}?${deleteQuery.toString()}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Delete failed');
      }

      toast.success("Entry deleted!");
      await fetchEntries();
    } catch (error) {
      console.error("Delete error:", error);
      toast.error("Failed to delete entry.");
    }
  };

  const handleShareSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user?.uid || !user.email || !activeList?.id || activeList.permission !== 'owner') {
      toast.error('Only the list owner can share this list.');
      return;
    }

    const trimmedEmail = shareEmail.trim().toLowerCase();
    if (!trimmedEmail) {
      toast.error('Enter an email address to share with.');
      return;
    }

    setShareSaving(true);
    try {
      const response = await fetch('/api/shares', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId: user.uid,
          ownerEmail: user.email,
          ownerName: user.displayName || user.email,
          listId: activeList.id,
          recipientEmail: trimmedEmail,
          permission: sharePermission,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Share failed');
      }

      setShareEmail('');
      setSharePermission('view');
      toast.success('Sharing access saved.');
      await fetchShares(activeList.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to share list.';
      toast.error(message);
    } finally {
      setShareSaving(false);
    }
  };

  const handleCreateList = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user?.uid || !user.email) {
      toast.error('You must be signed in to create lists.');
      return;
    }

    const name = newListName.trim();
    if (!name) {
      toast.error('Enter a list name.');
      return;
    }

    setListSaving(true);
    try {
      const response = await fetch('/api/lists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId: user.uid,
          ownerEmail: user.email,
          ownerName: user.displayName || user.email,
          name,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Create list failed');
      }

      setNewListName('');
      await fetchLists();
      setActiveListId(data.id);
      toast.success('List created.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create list.';
      toast.error(message);
    } finally {
      setListSaving(false);
    }
  };

  const handleRenameList = async () => {
    if (!user?.uid || !activeList?.id || activeList.permission !== 'owner') {
      toast.error('Only the list owner can rename this list.');
      return;
    }

    const name = renameListName.trim();
    if (!name) {
      toast.error('Enter a list name.');
      return;
    }

    setListSaving(true);
    try {
      const response = await fetch(`/api/lists/${activeList.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId: user.uid,
          name,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Rename list failed');
      }

      await fetchLists();
      await fetchShares(activeList.id);
      toast.success('List renamed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename list.';
      toast.error(message);
    } finally {
      setListSaving(false);
    }
  };

  const handleDeleteList = async () => {
    if (!user?.uid || !activeList?.id || activeList.permission !== 'owner') {
      toast.error('Only the list owner can delete this list.');
      return;
    }

    if (!window.confirm(`Delete "${activeList.name}" and all entries in it?`)) {
      return;
    }

    setListSaving(true);
    try {
      const response = await fetch(`/api/lists/${activeList.id}?ownerUserId=${encodeURIComponent(user.uid)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || 'Delete list failed');
      }

      setActiveListId('');
      await fetchLists();
      toast.success('List deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete list.';
      toast.error(message);
    } finally {
      setListSaving(false);
    }
  };

  const handleUpdateSharePermission = async (share: Share, permission: SharePermission) => {
    if (!user?.uid) {
      return;
    }

    try {
      const response = await fetch(`/api/shares/${share.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId: user.uid,
          permission,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || 'Update failed');
      }

      await fetchShares();
      toast.success('Access updated.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update access.';
      toast.error(message);
    }
  };

  const handleRemoveShare = async (share: Share) => {
    if (!user?.uid) {
      return;
    }

    try {
      const response = await fetch(`/api/shares/${share.id}?ownerUserId=${encodeURIComponent(user.uid)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || 'Remove failed');
      }

      await fetchShares();
      toast.success('Access removed.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove access.';
      toast.error(message);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      const firebaseCode =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: string }).code)
          : '';

      if (firebaseCode === 'auth/unauthorized-domain') {
        toast.error('Sign-in blocked: add this Render domain to Firebase Auth authorized domains.');
      } else if (firebaseCode === 'auth/operation-not-allowed') {
        toast.error('Google Sign-In is disabled in Firebase. Enable it in Authentication > Sign-in method.');
      } else if (firebaseCode === 'auth/popup-blocked') {
        toast.error('Popup blocked by browser. Allow popups and try again.');
      } else {
        toast.error('Google sign-in failed. Check Firebase config and authorized domains.');
      }

      console.error('Google sign-in error:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 text-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          <div className="w-20 h-20 bg-sky-400/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-sky-400/20">
            <Film className="w-10 h-10 text-sky-400" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">Movie & Series Tracker</h1>
          <p className="text-neutral-400 mb-10 text-lg">Keep track of everything you watch. Rate your favorites and never lose your place in a series.</p>
          <button 
            onClick={handleGoogleSignIn}
            className="w-full py-4 px-6 bg-white text-black font-semibold rounded-2xl flex items-center justify-center gap-3 hover:bg-neutral-200 transition-all active:scale-95"
          >
            Sign in with Google
          </button>
        </motion.div>
        <footer className="absolute bottom-0 left-0 w-full border-t border-neutral-800/50 py-6 text-center text-sm text-neutral-500">
          © 2026 Created by Thit Lwin Win Thant.
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-950 text-white font-sans selection:bg-sky-400/30">
      <Toaster position="top-center" theme="dark" />
      
      {/* Header */}
      <header className="sticky top-0 z-30 bg-neutral-950/80 backdrop-blur-xl border-b border-neutral-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-sky-400 rounded-xl flex items-center justify-center">
                <Film className="w-6 h-6 text-black" />
              </div>
              <span className="text-xl font-bold tracking-tight hidden sm:block">Tracker</span>
            </div>

            <div className="flex-1 max-w-md mx-4 sm:mx-8">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 group-focus-within:text-sky-400 transition-colors" />
                <input 
                  type="text" 
                  placeholder={`Search ${activeTab}s...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400/20 focus:border-sky-400 transition-all"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-medium">{user.displayName}</span>
                <button onClick={logout} className="text-xs text-neutral-500 hover:text-sky-400 transition-colors">Sign Out</button>
              </div>
              <img src={user.photoURL || ''} alt="Profile" className="w-10 h-10 rounded-full border border-neutral-800" referrerPolicy="no-referrer" />
              <button onClick={logout} className="sm:hidden p-2 text-neutral-500 hover:text-sky-400">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-sky-400">
                <Users className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-neutral-500">Watching List</p>
                <p className="truncate text-sm font-semibold text-white">
                  {activeList?.permission === 'owner' ? activeList?.name : `${activeList?.ownerName || activeList?.ownerEmail} / ${activeList?.name}`}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <select
                value={activeListId}
                onChange={(event) => setActiveListId(event.target.value)}
                className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400"
              >
                {sharedLists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.permission === 'owner' ? list.name : `${list.ownerName || list.ownerEmail} / ${list.name} (${list.permission})`}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs font-semibold text-neutral-300">
                {canEditActiveList ? <Pencil className="h-4 w-4 text-sky-400" /> : <Eye className="h-4 w-4 text-neutral-500" />}
                {canEditActiveList ? 'Can edit' : 'View only'}
              </div>

              <button
                type="button"
                onClick={() => setIsShareModalOpen(true)}
                disabled={activeList?.permission !== 'owner'}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-sky-400/60",
                  activeList?.permission !== 'owner' && "cursor-not-allowed opacity-50"
                )}
              >
                <Share2 className="h-4 w-4" />
                Share
              </button>
            </div>
          </div>

          <div className="grid gap-3 border-t border-neutral-800 pt-4 lg:grid-cols-[1fr_1fr_auto]">
            <form onSubmit={handleCreateList} className="flex gap-2">
              <input
                type="text"
                value={newListName}
                onChange={(event) => setNewListName(event.target.value)}
                placeholder="New list name"
                className="min-w-0 flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400"
              />
              <button
                type="submit"
                disabled={listSaving}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Create
              </button>
            </form>

            <div className="flex gap-2">
              <input
                type="text"
                value={renameListName}
                onChange={(event) => setRenameListName(event.target.value)}
                disabled={activeList?.permission !== 'owner'}
                placeholder="Rename selected list"
                className="min-w-0 flex-1 bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => void handleRenameList()}
                disabled={listSaving || activeList?.permission !== 'owner'}
                className="rounded-xl border border-neutral-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:border-sky-400/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Rename
              </button>
            </div>

            <button
              type="button"
              onClick={() => void handleDeleteList()}
              disabled={listSaving || activeList?.permission !== 'owner'}
              className="rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete List
            </button>
          </div>
        </div>

        {/* Navigation & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-10">
          <div className="flex p-1 bg-neutral-900 rounded-2xl w-fit border border-neutral-800">
            <button 
              onClick={() => setActiveTab('movie')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all",
                activeTab === 'movie' ? "bg-sky-400 text-black shadow-lg shadow-sky-400/20" : "text-neutral-400 hover:text-white"
              )}
            >
              <Film className="w-4 h-4" />
              Movies
            </button>
            <button 
              onClick={() => setActiveTab('series')}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all",
                activeTab === 'series' ? "bg-sky-400 text-black shadow-lg shadow-sky-400/20" : "text-neutral-400 hover:text-white"
              )}
            >
              <Tv className="w-4 h-4" />
              TV Series
            </button>
          </div>

          <div className="flex items-center gap-4">
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400"
            >
              <option value="newest">Newest First</option>
              <option value="rating">Highest Rated</option>
              <option value="title">Alphabetical</option>
            </select>
            <button 
              onClick={() => handleOpenModal()}
              disabled={!canEditActiveList}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg shadow-white/5",
                canEditActiveList ? "bg-white text-black hover:bg-neutral-200" : "cursor-not-allowed bg-neutral-800 text-neutral-500"
              )}
            >
              <Plus className="w-4 h-4" />
              Add {activeTab === 'movie' ? 'Movie' : 'Series'}
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 sm:gap-8">
          <AnimatePresence mode="popLayout">
            {filteredEntries.map((item) => (
              <motion.div 
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                key={item.id}
                data-entry-card="true"
                className="group relative flex flex-col"
              >
                <div
                  onClick={() =>
                    setActiveEntryId((currentId) => (currentId === item.id ? null : item.id))
                  }
                  className="relative aspect-[2/3] rounded-2xl overflow-hidden bg-neutral-900 border border-neutral-800 mb-4 group-hover:border-sky-400/50 transition-colors"
                >
                  <img 
                    src={item.posterUrl} 
                    alt={item.title} 
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=400';
                    }}
                  />
                  
                  {/* Overlay Actions */}
                  {canEditActiveList && (
                    <div
                      className={cn(
                        'absolute inset-0 bg-black/60 transition-opacity flex flex-col items-center justify-center gap-3',
                        activeEntryId === item.id ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'
                      )}
                    >
                      <button 
                        onClick={(event) => {
                          event.stopPropagation();
                          handleOpenModal(item);
                        }}
                        className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(item.id);
                        }}
                        className="w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* Rating Badge */}
                  <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg flex items-center gap-1 border border-white/10">
                    <Star className="w-3 h-3 text-sky-400 fill-sky-400" />
                    <span className="text-xs font-bold">{item.rating}</span>
                  </div>
                </div>

                <h3 className="font-bold text-sm sm:text-base line-clamp-1 mb-1">{item.title}</h3>
                
                {activeTab === 'series' && (
                  <div className="flex items-center justify-between mt-auto">
                    <span className="text-xs text-neutral-500 font-medium">
                      S{(item as Series).currentSeason} E{(item as Series).currentEpisode}
                    </span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filteredEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 bg-neutral-900 rounded-full flex items-center justify-center mb-6 border border-neutral-800">
              <Search className="w-8 h-8 text-neutral-700" />
            </div>
            <h3 className="text-xl font-bold mb-2">No {activeTab} found</h3>
            <p className="text-neutral-500">Try adjusting your search or add a new entry.</p>
          </div>
        )}
      </main>

      <footer className="mt-auto border-t border-neutral-800/50 py-6 text-center text-sm text-neutral-500">
        © 2026 Created by Thit Lwin Win Thant.
      </footer>

      <AnimatePresence>
        {isShareModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsShareModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                <h2 className="text-xl font-bold">Share My List</h2>
                <button onClick={() => setIsShareModalOpen(false)} className="p-2 text-neutral-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <form onSubmit={handleShareSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                  <input
                    required
                    type="email"
                    value={shareEmail}
                    onChange={(event) => setShareEmail(event.target.value)}
                    placeholder="friend@example.com"
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 transition-colors"
                  />
                  <select
                    value={sharePermission}
                    onChange={(event) => setSharePermission(event.target.value as SharePermission)}
                    className="bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400"
                  >
                    <option value="view">View only</option>
                    <option value="edit">Can edit</option>
                  </select>
                  <button
                    type="submit"
                    disabled={shareSaving}
                    className="rounded-xl bg-sky-400 px-5 py-3 text-sm font-bold text-black transition-all hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {shareSaving ? 'Sharing...' : 'Share'}
                  </button>
                </form>

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-neutral-300">People with access</h3>
                  {ownedShares.length === 0 ? (
                    <p className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-500">
                      No one has access yet.
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                      {ownedShares.map((share) => (
                        <div key={share.id} className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{share.recipientEmail}</p>
                            <p className="text-xs text-neutral-500">{share.permission === 'edit' ? 'Can edit your list' : 'Can view your list'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              value={share.permission}
                              onChange={(event) => void handleUpdateSharePermission(share, event.target.value as SharePermission)}
                              className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-sky-400"
                            >
                              <option value="view">View only</option>
                              <option value="edit">Can edit</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => void handleRemoveShare(share)}
                              className="rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-500/10"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-neutral-800 flex items-center justify-between">
                <h2 className="text-xl font-bold">
                  {editingEntry ? 'Edit' : 'Add'} {activeTab === 'movie' ? 'Movie' : 'Series'}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 text-neutral-500 hover:text-white transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Title</label>
                  <input 
                    required
                    type="text" 
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="Inception, Breaking Bad..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 transition-colors"
                  />
                </div>

                <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">
                      Search TMDb
                    </label>
                    <div className="flex gap-3">
                      <input
                        type="text"
                        value={tmdbSearchQuery}
                        onChange={(e) => {
                          setTmdbSearchLocked(false);
                          setTmdbSearchQuery(e.target.value);
                        }}
                        placeholder={`Search for a ${activeTab === 'movie' ? 'movie' : 'series'} title...`}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => void handleTmdbSearch(tmdbSearchQuery)}
                        className="shrink-0 rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-black transition-all hover:bg-sky-300 active:scale-95"
                      >
                        Search
                      </button>
                    </div>
                  </div>

                  {tmdbSearchLoading && (
                    <p className="text-xs text-neutral-500">Searching TMDb...</p>
                  )}

                  {!tmdbSearchLoading && tmdbSearchError && (
                    <p className="text-xs text-neutral-500">{tmdbSearchError}</p>
                  )}

                  {tmdbSearchResults.length > 0 && (
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                      {tmdbSearchResults.map((result) => (
                        <button
                          key={`${result.mediaType}-${result.id}`}
                          type="button"
                          onClick={() => handleSelectTmdbResult(result)}
                          className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors hover:border-sky-400/50 hover:bg-neutral-800"
                        >
                          <img
                            src={result.posterUrl || DEFAULT_POSTER_FALLBACK}
                            alt={result.title}
                            className="h-16 w-11 rounded-lg object-cover"
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                              (event.target as HTMLImageElement).src = DEFAULT_POSTER_FALLBACK;
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white">{result.title}</p>
                            <p className="text-xs text-neutral-500">{result.year || 'Unknown year'}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-neutral-400">Poster</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePosterFileChange}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-sky-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-sky-300 focus:outline-none focus:border-sky-400 transition-colors"
                  />
                  <p className="text-xs text-neutral-500">TMDb fills this automatically when a poster is available. You can upload one instead.</p>
                  {formData.posterUrl && (
                    <div className="mt-2">
                      <img
                        src={formData.posterUrl}
                        alt="Poster preview"
                        className="h-36 w-24 rounded-lg object-cover border border-neutral-800"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Rating (0-10)</label>
                    <div className="flex items-center gap-3">
                      <input 
                        type="range" 
                        min="0" 
                        max="10" 
                        step="0.1"
                        value={formData.rating}
                        onChange={(e) => setFormData({ ...formData, rating: Number(e.target.value) })}
                        className="flex-1 accent-sky-400"
                      />
                      <span className="w-8 text-center font-bold text-sky-400">{formData.rating}</span>
                    </div>
                  </div>

                  {activeTab === 'series' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-neutral-400">Season</label>
                        <input 
                          type="number" 
                          min="1"
                          value={formData.currentSeason}
                          onChange={(e) => setFormData({ ...formData, currentSeason: Number(e.target.value) })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-neutral-400">Episode</label>
                        <input 
                          type="number" 
                          min="1"
                          value={formData.currentEpisode}
                          onChange={(e) => setFormData({ ...formData, currentEpisode: Number(e.target.value) })}
                          className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  type="submit"
                  className="w-full py-4 bg-sky-400 text-black font-bold rounded-2xl hover:bg-sky-300 transition-all active:scale-95 shadow-lg shadow-sky-400/20"
                >
                  {editingEntry ? 'Save Changes' : `Add ${activeTab === 'movie' ? 'Movie' : 'Series'}`}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
