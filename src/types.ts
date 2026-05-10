export interface Movie {
  id: string;
  title: string;
  posterUrl: string;
  rating: number;
  userId: string;
  listId?: string;
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
  listId?: string;
  createdAt: string;
}

export type EntryType = 'movie' | 'series';
export type SharePermission = 'view' | 'edit';

export interface Share {
  id: string;
  listId: string;
  listName: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  recipientEmail: string;
  permission: SharePermission;
  createdAt: string;
  updatedAt?: string;
}

export interface SharedList {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  permission: 'owner' | SharePermission;
  isDefault?: boolean;
}

export interface WatchList {
  id: string;
  name: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt?: string;
}
