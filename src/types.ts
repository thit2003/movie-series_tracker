export interface Movie {
  id: string;
  title: string;
  posterUrl: string;
  rating: number;
  userId: string;
  createdAt: string;
}

export interface Series {
  id: string;
  title: string;
  posterUrl: string;
  rating: number;
  currentSeason: number;
  currentEpisode: number;
  userId: string;
  createdAt: string;
}

export type EntryType = 'movie' | 'series';
