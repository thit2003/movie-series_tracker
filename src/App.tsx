import { useState, useEffect, useMemo, useCallback } from 'react';
import { Movie, Series, EntryType } from './types';
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
  LogOut
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, logout } from './firebase';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster, toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

const DEFAULT_POSTER_FALLBACK = 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&q=80&w=800';

type OmdbSearchResult = {
  Title: string;
  Year: string;
  imdbID: string;
  Type: string;
  Poster: string;
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
  const [movieSearchQuery, setMovieSearchQuery] = useState('');
  const [movieSearchResults, setMovieSearchResults] = useState<OmdbSearchResult[]>([]);
  const [movieSearchLoading, setMovieSearchLoading] = useState(false);
  const [movieSearchError, setMovieSearchError] = useState('');
  const [movieSearchLocked, setMovieSearchLocked] = useState(false);
  
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
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
      if (!user?.uid) {
        setMovies([]);
        setSeries([]);
        setLoading(false);
        return;
      }

      const [moviesResponse, seriesResponse] = await Promise.all([
        fetch(`/api/entries?type=movie&userId=${encodeURIComponent(user.uid)}`),
        fetch(`/api/entries?type=series&userId=${encodeURIComponent(user.uid)}`),
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
  }, [user?.uid]);

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
    if (entry) {
      setEditingEntry(entry);
      setFormData({
        title: entry.title,
        posterUrl: entry.posterUrl,
        rating: entry.rating,
        currentSeason: (entry as Series).currentSeason || 1,
        currentEpisode: (entry as Series).currentEpisode || 1
      });
      setMovieSearchQuery(entry.title);
      setMovieSearchLocked(true);
    } else {
      setEditingEntry(null);
      setFormData({
        title: '',
        posterUrl: '',
        rating: 5,
        currentSeason: 1,
        currentEpisode: 1
      });
      setMovieSearchQuery('');
      setMovieSearchLocked(false);
    }
    setMovieSearchResults([]);
    setMovieSearchError('');
    setIsModalOpen(true);
  };

  const handleMovieSearch = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setMovieSearchResults([]);
      setMovieSearchError('');
      return;
    }

    setMovieSearchLoading(true);
    setMovieSearchError('');

    try {
      const response = await fetch(`/api/omdb/search?query=${encodeURIComponent(trimmedQuery)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.message || 'Search failed');
      }

      if (data?.error) {
        setMovieSearchResults([]);
        setMovieSearchError(data.error);
        return;
      }

      setMovieSearchResults((data?.results as OmdbSearchResult[] | undefined) || []);
      if (!data?.results?.length) {
        setMovieSearchError('No movies matched your search.');
      }
    } catch (error) {
      console.error('OMDb search error:', error);
      setMovieSearchResults([]);
      setMovieSearchError('Failed to search movies.');
    } finally {
      setMovieSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isModalOpen || activeTab !== 'movie' || movieSearchLocked) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void handleMovieSearch(movieSearchQuery);
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [activeTab, handleMovieSearch, isModalOpen, movieSearchLocked, movieSearchQuery]);

  const handleSelectMovieResult = (result: OmdbSearchResult) => {
    setFormData((prev) => ({
      ...prev,
      title: result.Title,
      posterUrl: result.Poster && result.Poster !== 'N/A' ? result.Poster : DEFAULT_POSTER_FALLBACK,
    }));
    setMovieSearchQuery(result.Title);
    setMovieSearchLocked(true);
    setMovieSearchResults([]);
    setMovieSearchError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user?.uid) {
      toast.error('You must be signed in to save entries.');
      return;
    }

    if (!formData.posterUrl) {
      toast.error('Please add a poster image or select a movie from OMDb search.');
      return;
    }

    try {
      const data = {
        title: formData.title,
        posterUrl: formData.posterUrl,
        rating: Number(formData.rating),
        userId: user.uid,
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
    if (!window.confirm("Are you sure you want to delete this entry?")) return;
    try {
      const response = await fetch(`/api/entries/${id}?type=${activeTab}`, {
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
    <div className="min-h-screen bg-neutral-950 text-white font-sans selection:bg-sky-400/30">
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
              className="flex items-center gap-2 bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-neutral-200 transition-all active:scale-95 shadow-lg shadow-white/5"
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

      <footer className="border-t border-neutral-800/50 py-6 text-center text-sm text-neutral-500">
        © 2026 Created by Thit Lwin Win Thant.
      </footer>

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

                {activeTab === 'movie' && (
                  <div className="space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950/60 p-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-neutral-400">Search OMDb</label>
                      <div className="flex gap-3">
                        <input
                          type="text"
                          value={movieSearchQuery}
                          onChange={(e) => {
                            setMovieSearchLocked(false);
                            setMovieSearchQuery(e.target.value);
                          }}
                          placeholder="Search for a movie title..."
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-400 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => void handleMovieSearch(movieSearchQuery)}
                          className="shrink-0 rounded-xl bg-sky-400 px-4 py-3 text-sm font-bold text-black transition-all hover:bg-sky-300 active:scale-95"
                        >
                          Search
                        </button>
                      </div>
                    </div>

                    {movieSearchLoading && (
                      <p className="text-xs text-neutral-500">Searching OMDb...</p>
                    )}

                    {!movieSearchLoading && movieSearchError && (
                      <p className="text-xs text-neutral-500">{movieSearchError}</p>
                    )}

                    {movieSearchResults.length > 0 && (
                      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                        {movieSearchResults.map((result) => (
                          <button
                            key={result.imdbID}
                            type="button"
                            onClick={() => handleSelectMovieResult(result)}
                            className="flex w-full items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-2 text-left transition-colors hover:border-sky-400/50 hover:bg-neutral-800"
                          >
                            <img
                              src={result.Poster !== 'N/A' ? result.Poster : DEFAULT_POSTER_FALLBACK}
                              alt={result.Title}
                              className="h-16 w-11 rounded-lg object-cover"
                              referrerPolicy="no-referrer"
                              onError={(event) => {
                                (event.target as HTMLImageElement).src = DEFAULT_POSTER_FALLBACK;
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-white">{result.Title}</p>
                              <p className="text-xs text-neutral-500">{result.Year}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'movie' ? (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Poster</label>
                    <p className="text-xs text-neutral-500">Use OMDb search to populate the poster automatically.</p>
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
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-neutral-400">Poster Image</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePosterFileChange}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-sky-400 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black hover:file:bg-sky-300 focus:outline-none focus:border-sky-400 transition-colors"
                    />
                    <p className="text-xs text-neutral-500">Upload from gallery (max 20MB).</p>
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
                )}

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
