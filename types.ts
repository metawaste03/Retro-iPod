export interface Song {
  id: string; // YouTube video ID
  title: string;
}

export interface Playlist {
  id: string; // UUID
  name: string;
  songs: Song[];
}

export type View = 
  | 'main-menu' 
  | 'playlists' 
  | 'playlist-view' 
  | 'add-song' 
  | 'now-playing'
  | 'select-playlist-for-song'
  | 'create-playlist-input'
  | 'song-menu'
  | 'delete-song-confirm'
  | 'delete-playlist-confirm'
  | 'shuffle-confirm'
  | 'edit-song-title';

export type PlaybackMode = 'audio' | 'video';

export type RepeatMode = 'off' | 'one' | 'all';