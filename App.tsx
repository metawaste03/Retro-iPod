import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { View, Playlist, Song, PlaybackMode, RepeatMode } from './types';
import { getYouTubeId } from './services/youtubeService';
import { PlayIcon, PauseIcon, NextTrackIcon, PrevTrackIcon, ChevronRightIcon, RepeatIcon, RepeatOneIcon, MoonIcon, SunIcon } from './components/icons';

// --- Type definition for YouTube Player API ---
declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

// --- Web Audio and Vibration Helpers ---

const audioContext = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

const playScrollSound = () => {
  if (!audioContext) return;
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(1200, audioContext.currentTime);
  gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
  
  gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.05);
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.05);
};

const triggerVibration = (duration: number | number[] = 50) => {
  if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
    window.navigator.vibrate(duration);
  }
};


// --- Helper Components defined outside App to prevent re-creation on render ---

interface ScreenProps {
  children: React.ReactNode;
  header: string;
}
const Screen: React.FC<ScreenProps> = ({ children, header }) => (
  <div className="w-full h-1/2 bg-black rounded-t-lg p-1 flex flex-col">
    <div className="w-full bg-zinc-100/90 dark:bg-zinc-800/90 backdrop-blur-sm border-b border-zinc-300 dark:border-zinc-700 text-black dark:text-white text-center font-bold py-1.5 rounded-t-md">
      {header}
    </div>
    <div className="w-full flex-grow bg-white dark:bg-black overflow-y-auto text-black dark:text-gray-200">
      {children}
    </div>
  </div>
);

interface ClickWheelProps {
  onMenuClick: () => void;
  onCenterClick: () => void;
  onCenterLongPress?: () => void;
  onNextClick: () => void;
  onPrevClick: () => void;
  onPlayPauseClick: () => void;
  isPlaying: boolean;
}
const ClickWheel: React.FC<ClickWheelProps> = ({ onMenuClick, onCenterClick, onCenterLongPress, onNextClick, onPrevClick, onPlayPauseClick, isPlaying }) => {
    const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isLongPress = useRef(false);

    const handleMouseDown = () => {
        isLongPress.current = false;
        longPressTimeout.current = setTimeout(() => {
            isLongPress.current = true;
            triggerVibration(100);
            onCenterLongPress?.();
        }, 700);
    };

    const handleMouseUp = () => {
        if (longPressTimeout.current) {
            clearTimeout(longPressTimeout.current);
        }
    };
    
    const handleClick = (e: React.MouseEvent) => {
        if (isLongPress.current) {
            e.preventDefault();
            return;
        }
        onCenterClick();
    };

    return (
      <div className="w-full h-1/2 bg-zinc-100 dark:bg-zinc-950 rounded-b-lg flex justify-center items-center">
        <div className="relative w-48 h-48 md:w-56 md:h-56 rounded-full bg-gradient-to-br from-zinc-300 to-zinc-200 dark:from-zinc-800 dark:to-zinc-700 flex justify-center items-center shadow-inner">
          <button onClick={onMenuClick} className="absolute top-2 text-gray-600 dark:text-gray-300 font-bold uppercase text-sm">Menu</button>
          <button onClick={onPrevClick} className="absolute left-2 text-gray-600 dark:text-gray-300"><PrevTrackIcon className="w-8 h-8" /></button>
          <button onClick={onNextClick} className="absolute right-2 text-gray-600 dark:text-gray-300"><NextTrackIcon className="w-8 h-8" /></button>
          <button onClick={onPlayPauseClick} className="absolute bottom-2 text-gray-600 dark:text-gray-300">
            {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
          </button>
          <button 
             onMouseDown={handleMouseDown}
             onMouseUp={handleMouseUp}
             onMouseLeave={handleMouseUp}
             onTouchStart={handleMouseDown}
             onTouchEnd={handleMouseUp}
             onClick={handleClick}
             className="w-20 h-20 md:w-24 md:h-24 bg-zinc-400 dark:bg-zinc-600 rounded-full shadow-lg border-2 border-zinc-500 dark:border-zinc-500 transition-transform active:scale-95"
          ></button>
        </div>
      </div>
    );
};

// --- Main App Component ---

const getInitialPlaylists = (): Playlist[] => {
  try {
    const savedPlaylists = localStorage.getItem('playlists');
    return savedPlaylists ? JSON.parse(savedPlaylists) : [];
  } catch (error) {
    console.error("Failed to parse playlists from localStorage", error);
    return [];
  }
};
const initialPlaylists = getInitialPlaylists();


const App: React.FC = () => {
  const [playlists, setPlaylists] = useState<Playlist[]>(initialPlaylists);
  const [view, setView] = useState<View>(initialPlaylists.length > 0 && initialPlaylists.some(p => p.songs.length > 0) ? 'main-menu' : 'add-song');
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<{ playlistId: string; songIndex: number } | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>('video');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isPlaying, setIsPlaying] = useState(false);
  
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [urlInput, setUrlInput] = useState('');
  const [tempSong, setTempSong] = useState<Song | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [selectedSongIndex, setSelectedSongIndex] = useState<number | null>(null);
  const [playlistToDeleteId, setPlaylistToDeleteId] = useState<string | null>(null);
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const savedTheme = localStorage.getItem('theme');
    return (savedTheme === 'dark' || savedTheme === 'light') ? savedTheme : 'light';
  });

  const ytPlayer = useRef<any>(null);
  const isPlayerReady = useRef(false);
  
  useEffect(() => {
    localStorage.setItem('playlists', JSON.stringify(playlists));
  }, [playlists]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);
  
  useEffect(() => {
    if (view === 'playlists') {
      setSelectedIndex(0);
    }
  }, [playlistSearchQuery, view]);

  const menuItems = ['Playlists', 'Add YouTube URL', 'Now Playing'];
  const nowPlayingMenuItems = ['prev', 'play-pause', 'next', 'playback-mode', 'repeat-mode'];
  
  const playlistItems = playlistSearchQuery
    ? playlists.filter(p => p.name.toLowerCase().includes(playlistSearchQuery.toLowerCase()))
    : playlists;
  const playlistMenuItems = [...playlistItems, {id: 'CREATE_NEW', name: '+ Create New Playlist', songs:[]}];

  const activePlaylist = playlists.find(p => p.id === activePlaylistId);
  const currentSong = nowPlaying ? playlists.find(p => p.id === nowPlaying.playlistId)?.songs[nowPlaying.songIndex] : null;

  const getPlaylistViewItems = () => {
    if (!activePlaylist) return [];
    const items: {id: string; title: string;}[] = [];
    if (activePlaylist.songs.length > 0) {
      items.push({ id: 'SHUFFLE_PLAYLIST', title: 'Shuffle Playlist' });
      items.push(...activePlaylist.songs);
    }
    items.push({ id: 'DELETE_PLAYLIST', title: 'Delete This Playlist' });
    return items;
  };
  const playlistViewItems = getPlaylistViewItems();

  const navigate = useCallback(<T,>(items: T[], direction: 'next' | 'prev') => {
    setSelectedIndex(prev => {
      if (direction === 'next') return (prev + 1) % items.length;
      return (prev - 1 + items.length) % items.length;
    });
  }, []);

  const handleNextTrack = useCallback(() => {
    if (!nowPlaying) return;
    triggerVibration();
    const playlist = playlists.find(p => p.id === nowPlaying.playlistId);
    if (!playlist) return;

    const nextIndex = nowPlaying.songIndex + 1;
    if (nextIndex < playlist.songs.length) {
        setNowPlaying({ ...nowPlaying, songIndex: nextIndex });
    } else if (repeatMode === 'all') {
        setNowPlaying({ ...nowPlaying, songIndex: 0 });
    }
  }, [nowPlaying, playlists, repeatMode]);

  const handlePrevTrack = useCallback(() => {
    if (!nowPlaying) return;
    triggerVibration();
    
    const playerTime = ytPlayer.current?.getCurrentTime ? ytPlayer.current.getCurrentTime() : 0;

    if (playerTime > 3) {
      ytPlayer.current?.seekTo(0);
    } else if (nowPlaying.songIndex > 0) {
      setNowPlaying({ ...nowPlaying, songIndex: nowPlaying.songIndex - 1 });
    } else {
      const playlist = playlists.find(p => p.id === nowPlaying.playlistId);
      if (repeatMode === 'all' && playlist && playlist.songs.length > 0) {
        setNowPlaying({ ...nowPlaying, songIndex: playlist.songs.length - 1});
      } else {
        ytPlayer.current?.seekTo(0);
      }
    }
  }, [nowPlaying, playlists, repeatMode]);
  
  const handleSongEnd = useCallback(() => {
    if (!nowPlaying) return;
    const playlist = playlists.find(p => p.id === nowPlaying.playlistId);
    if (!playlist || playlist.songs.length === 0) {
        setIsPlaying(false);
        return;
    }

    if (repeatMode === 'one') {
        ytPlayer.current?.seekTo(0);
        ytPlayer.current?.playVideo();
        return;
    }

    const nextIndex = nowPlaying.songIndex + 1;

    if (repeatMode === 'all') {
        setNowPlaying({ ...nowPlaying, songIndex: nextIndex % playlist.songs.length });
        return;
    }

    // Default 'off' behavior
    if (nextIndex < playlist.songs.length) {
        setNowPlaying({ ...nowPlaying, songIndex: nextIndex });
    } else {
        setIsPlaying(false); // Stop at the end
    }
  }, [nowPlaying, playlists, repeatMode]);

  useEffect(() => {
    const setupPlayer = () => {
      if (!currentSong || !document.getElementById('youtube-player')) return;
      
      const onPlayerStateChange = (event: any) => {
        if (event.data === window.YT.PlayerState.ENDED) {
          handleSongEnd();
        }
        if (event.data === window.YT.PlayerState.PLAYING) {
          setIsPlaying(true);
        }
        if (event.data === window.YT.PlayerState.PAUSED) {
          setIsPlaying(false);
        }
      };

      if (ytPlayer.current) {
         ytPlayer.current.loadVideoById(currentSong.id);
      } else {
        ytPlayer.current = new window.YT.Player('youtube-player', {
          height: '150',
          width: '100%',
          videoId: currentSong.id,
          playerVars: { 'autoplay': 1, 'controls': 0 },
          events: {
            'onReady': () => isPlayerReady.current = true,
            'onStateChange': onPlayerStateChange
          }
        });
      }
    };

    if (view === 'now-playing') {
      if (!window.YT) {
        window.onYouTubeIframeAPIReady = setupPlayer;
      } else {
        setupPlayer();
      }
    }

    return () => {
        if (view !== 'now-playing' && ytPlayer.current && typeof ytPlayer.current.stopVideo === 'function') {
            ytPlayer.current.stopVideo();
        }
    }
  }, [view, currentSong, handleSongEnd]);


  const handleNext = () => {
    playScrollSound();
    triggerVibration();
    switch (view) {
      case 'main-menu': navigate(menuItems, 'next'); break;
      case 'playlists': navigate(playlistMenuItems, 'next'); break;
      case 'playlist-view': navigate(playlistViewItems, 'next'); break;
      case 'select-playlist-for-song': navigate([...playlists, {id: 'new', name: 'Create New Playlist', songs:[]}], 'next'); break;
      case 'song-menu': navigate(['Play'], 'next'); break;
      case 'delete-song-confirm':
      case 'delete-playlist-confirm':
      case 'shuffle-confirm':
          navigate(['No', 'Yes'], 'next'); break;
      case 'now-playing': navigate(nowPlayingMenuItems, 'next'); break;
    }
  };

  const handlePrev = () => {
     playScrollSound();
     triggerVibration();
     switch (view) {
      case 'main-menu': navigate(menuItems, 'prev'); break;
      case 'playlists': navigate(playlistMenuItems, 'prev'); break;
      case 'playlist-view': navigate(playlistViewItems, 'prev'); break;
      case 'select-playlist-for-song': navigate([...playlists, {id: 'new', name: 'Create New Playlist', songs:[]}], 'prev'); break;
      case 'song-menu': navigate(['Play'], 'prev'); break;
      case 'delete-song-confirm':
      case 'delete-playlist-confirm':
      case 'shuffle-confirm':
          navigate(['No', 'Yes'], 'prev'); break;
      case 'now-playing': navigate(nowPlayingMenuItems, 'prev'); break;
    }
  };

  const handleMenu = () => {
    triggerVibration();
    setSelectedIndex(0);
    
    switch (view) {
      case 'playlists': setView('main-menu'); setPlaylistSearchQuery(''); break;
      case 'playlist-view': setView('playlists'); setActivePlaylistId(null); break;
      case 'add-song': if (playlists.length > 0) setView('main-menu'); setUrlInput(''); break;
      case 'now-playing': setView(activePlaylistId ? 'playlist-view' : 'main-menu'); break;
      case 'select-playlist-for-song': setView('add-song'); setTempSong(null); break;
      case 'create-playlist-input':
        setView(tempSong ? 'select-playlist-for-song' : 'playlists');
        setNewPlaylistName('');
        break;
      case 'song-menu': setView('playlist-view'); setSelectedSongIndex(null); break;
      case 'delete-song-confirm': setView('song-menu'); break;
      case 'delete-playlist-confirm': setView('playlist-view'); setPlaylistToDeleteId(null); break;
      case 'shuffle-confirm': setView('playlist-view'); break;
      default:
        if (playlists.length > 0 && view !== 'main-menu') {
            setView('main-menu');
        }
        break;
    }
  };

  const handlePlayPause = useCallback(() => {
      triggerVibration();
      if (ytPlayer.current && isPlayerReady.current) {
        const playerState = ytPlayer.current.getPlayerState();
        if (playerState === window.YT.PlayerState.PLAYING) {
          ytPlayer.current.pauseVideo();
        } else {
          ytPlayer.current.playVideo();
        }
      } else if (currentSong) {
        setIsPlaying(!isPlaying);
      } else if (playlists.length > 0 && playlists[0].songs.length > 0) {
        setNowPlaying({ playlistId: playlists[0].id, songIndex: 0 });
        setView('now-playing');
      }
  }, [currentSong, isPlaying, playlists]);

  const handleCenterClick = () => {
    triggerVibration();
    switch (view) {
      case 'main-menu': handleMainMenuSelection(selectedIndex); break;
      case 'playlists': handlePlaylistsSelection(selectedIndex); break;
      case 'playlist-view': handlePlaylistViewSelection(selectedIndex); break;
      case 'song-menu': handleSongMenuSelection(selectedIndex); break;
      case 'delete-song-confirm': handleConfirmation(selectedIndex); break;
      case 'delete-playlist-confirm': handleConfirmation(selectedIndex); break;
      case 'shuffle-confirm': handleConfirmation(selectedIndex); break;
      case 'add-song': handleAddSongUrl(); break;
      case 'select-playlist-for-song': handleSelectPlaylistForSongSelection(selectedIndex); break;
      case 'create-playlist-input': handleCreatePlaylist(); break;
      case 'now-playing': handleNowPlayingSelection(selectedIndex); break;
    }
  };

  const handleMainMenuSelection = (index: number) => {
    setSelectedIndex(index);
    const selectedMenu = menuItems[index];
    if (selectedMenu === 'Playlists') setView('playlists');
    if (selectedMenu === 'Add YouTube URL') setView('add-song');
    if (selectedMenu === 'Now Playing' && currentSong) setView('now-playing');
    setSelectedIndex(0);
  };
  
  const handlePlaylistsSelection = (index: number) => {
    setSelectedIndex(index);
    const selectedPlaylistItem = playlistMenuItems[index];
    if (selectedPlaylistItem.id === 'CREATE_NEW') {
      setView('create-playlist-input');
    } else {
        setActivePlaylistId(selectedPlaylistItem.id);
        setView('playlist-view');
    }
    setSelectedIndex(0);
    setPlaylistSearchQuery('');
  };

  const handlePlaylistViewSelection = (index: number) => {
    setSelectedIndex(index);
    const selectedItem = playlistViewItems[index];
    if (!selectedItem) return;

    if (selectedItem.id === 'SHUFFLE_PLAYLIST') {
        setView('shuffle-confirm');
    } else if (selectedItem.id === 'DELETE_PLAYLIST') {
        setPlaylistToDeleteId(activePlaylistId);
        setView('delete-playlist-confirm');
    } else { // It's a song
        const songIndex = activePlaylist?.songs.findIndex(s => s.id === selectedItem.id) ?? -1;
        if(songIndex > -1){
            setSelectedSongIndex(songIndex);
            setView('song-menu');
        }
    }
    setSelectedIndex(0);
  };

  const handleSongMenuSelection = (index: number) => {
    setSelectedIndex(index);
    if (index === 0) { // Play
        setNowPlaying({ playlistId: activePlaylistId!, songIndex: selectedSongIndex! });
        setView('now-playing');
    }
    setSelectedIndex(0);
  };
  
  const handleConfirmation = (index: number) => {
    setSelectedIndex(index);
    if (index === 1) { // Yes
      if (view === 'delete-song-confirm') handleDeleteSong();
      if (view === 'delete-playlist-confirm') handleDeletePlaylist();
      if (view === 'shuffle-confirm') handleShufflePlaylist();
    } else { // No
      if (view === 'delete-song-confirm') setView('song-menu');
      if (view === 'delete-playlist-confirm') {
          setView('playlist-view');
          setPlaylistToDeleteId(null);
      }
      if (view === 'shuffle-confirm') setView('playlist-view');
      setSelectedIndex(0);
    }
  };
  
  const handleSelectPlaylistForSongSelection = (index: number) => {
    setSelectedIndex(index);
    const selection = [...playlists, {id: 'new', name: 'Create New Playlist', songs:[]}][index];
    if (selection.id === 'new') {
        setView('create-playlist-input');
    } else if (tempSong) {
        addSongToPlaylist(selection.id, tempSong);
    }
  };

  const handleNowPlayingSelection = (index: number) => {
    setSelectedIndex(index);
    const selectedAction = nowPlayingMenuItems[index];
    switch(selectedAction) {
        case 'prev': handlePrevTrack(); break;
        case 'play-pause': handlePlayPause(); break;
        case 'next': handleNextTrack(); break;
        case 'playback-mode':
            setPlaybackMode(prev => prev === 'video' ? 'audio' : 'video');
            break;
        case 'repeat-mode':
            setRepeatMode(prev => {
                if (prev === 'off') return 'all';
                if (prev === 'all') return 'one';
                return 'off';
            });
            break;
    }
  };
  
  const handleCenterLongPress = () => {
    if (view === 'playlist-view' && activePlaylist) {
        const selectedItem = playlistViewItems[selectedIndex];
        if (selectedItem && selectedItem.id !== 'SHUFFLE_PLAYLIST' && selectedItem.id !== 'DELETE_PLAYLIST') {
            const songIndex = activePlaylist.songs.findIndex(s => s.id === selectedItem.id);
            if (songIndex !== -1) {
                setSelectedSongIndex(songIndex);
                setView('delete-song-confirm');
                setSelectedIndex(0);
            }
        }
    }
  };
  
  const handleAddSongUrl = () => {
    const videoId = getYouTubeId(urlInput);
    if (videoId) {
      triggerVibration(100);
      const newSong: Song = { id: videoId, title: `Song: ${videoId}` };
      setTempSong(newSong);
      setView('select-playlist-for-song');
      setUrlInput('');
      setSelectedIndex(0);
    } else {
      triggerVibration([100, 50, 100]);
      alert('Invalid YouTube URL');
    }
  };
  
  const addSongToPlaylist = (playlistId: string, song: Song) => {
    triggerVibration(100);
    setPlaylists(prev => prev.map(p => p.id === playlistId ? { ...p, songs: [...p.songs, song] } : p));
    setTempSong(null);
    setActivePlaylistId(playlistId);
    setView('playlist-view');
    setSelectedIndex(playlists.find(p => p.id === playlistId)?.songs.length || 0);
  }

  const handleCreatePlaylist = () => {
    if (newPlaylistName.trim()) {
        triggerVibration(100);
        const newPlaylist: Playlist = {
            id: Date.now().toString(),
            name: newPlaylistName,
            songs: tempSong ? [tempSong] : []
        };
        
        const updatedPlaylists = [...playlists, newPlaylist].sort((a, b) => 
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        );
        setPlaylists(updatedPlaylists);
        
        setNewPlaylistName('');
        setTempSong(null);

        if (tempSong) {
            setActivePlaylistId(newPlaylist.id);
            setView('playlist-view');
            setSelectedIndex(0);
        } else {
            setView('playlists');
            const newIndex = updatedPlaylists.findIndex(p => p.id === newPlaylist.id);
            setSelectedIndex(newIndex >= 0 ? newIndex : 0);
        }
    }
  };

  const handleDeleteSong = () => {
      if (activePlaylistId === null || selectedSongIndex === null) return;
      triggerVibration(100);
      setPlaylists(prev => prev.map(p => {
          if (p.id === activePlaylistId) {
              const newSongs = [...p.songs];
              newSongs.splice(selectedSongIndex, 1);
              return { ...p, songs: newSongs };
          }
          return p;
      }));
      setView('playlist-view');
      setSelectedSongIndex(null);
      setSelectedIndex(0);
  }

  const handleDeletePlaylist = () => {
      if (!playlistToDeleteId) return;
      triggerVibration(100);
      setPlaylists(prev => prev.filter(p => p.id !== playlistToDeleteId));
      setView('playlists');
      setPlaylistToDeleteId(null);
      setSelectedIndex(0);
  }

  const handleShufflePlaylist = () => {
    if (!activePlaylistId) return;
    triggerVibration(100);
    
    setPlaylists(prev => {
        return prev.map(p => {
            if (p.id === activePlaylistId) {
                const songsToShuffle = [...p.songs];
                // Fisher-Yates shuffle algorithm
                for (let i = songsToShuffle.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [songsToShuffle[i], songsToShuffle[j]] = [songsToShuffle[j], songsToShuffle[i]];
                }
                return { ...p, songs: songsToShuffle };
            }
            return p;
        });
    });

    setNowPlaying({ playlistId: activePlaylistId, songIndex: 0 });
    setView('now-playing');
  };

  const handleDragStart = (itemIndexInView: number) => {
    const songIndex = itemIndexInView - (activePlaylist && activePlaylist.songs.length > 0 ? 1 : 0);
    setDraggedItemIndex(songIndex);
  };
  
  const handleDragEnter = (itemIndexInView: number) => {
    if (draggedItemIndex === null || !activePlaylist) return;
    const songIndex = itemIndexInView - (activePlaylist && activePlaylist.songs.length > 0 ? 1 : 0);

    if (songIndex < 0 || songIndex >= activePlaylist.songs.length) {
      setDragOverIndex(null);
      return;
    }
    setDragOverIndex(songIndex);

    if (draggedItemIndex === songIndex) return;
    
    const newSongs = [...activePlaylist.songs];
    const [removed] = newSongs.splice(draggedItemIndex, 1);
    newSongs.splice(songIndex, 0, removed);

    setPlaylists(playlists.map(p => p.id === activePlaylistId ? {...p, songs: newSongs} : p));
    setDraggedItemIndex(songIndex);
  };

  const handleDragEnd = () => {
    setDraggedItemIndex(null);
    setDragOverIndex(null);
  };

  const renderView = () => {
    switch (view) {
      case 'main-menu':
        return (
          <Screen header="FLEX">
            <ul className="p-1 space-y-1">{menuItems.map((item, i) => <li key={item} onClick={() => handleMainMenuSelection(i)} className={`px-3 py-2 font-semibold transition-colors cursor-pointer rounded-md ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{item}</li>)}</ul>
          </Screen>
        );
      case 'playlists':
        return (
          <Screen header="Playlists">
            <div className="p-2 border-b border-zinc-200 dark:border-zinc-800">
                <input
                    type="text"
                    placeholder="Search playlists..."
                    value={playlistSearchQuery}
                    onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                    className="w-full p-1.5 border rounded-md bg-white dark:bg-zinc-700 dark:text-white dark:border-zinc-600 text-black text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
                    aria-label="Search playlists"
                />
            </div>
            <ul className="p-1 space-y-1">
              {playlistMenuItems.map((p, i) => <li key={p.id} onClick={() => handlePlaylistsSelection(i)} className={`px-3 py-2 font-semibold transition-colors cursor-pointer rounded-md flex justify-between items-center ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}><span>{p.name}</span> <ChevronRightIcon className="w-5 h-5"/></li>)}
              {playlistMenuItems.length === 1 && <li className="p-4 text-gray-500 text-center">No playlists found.</li>}
            </ul>
          </Screen>
        );
      case 'playlist-view':
        if (!activePlaylist) return <Screen header="Error">Playlist not found</Screen>;
        const hasSongs = activePlaylist.songs.length > 0;
        return (
          <Screen header={activePlaylist.name}>
             <ul className="p-1 space-y-1" onDragLeave={() => setDragOverIndex(null)}>
                {playlistViewItems.map((item, i) => {
                  const isSong = item.id !== 'SHUFFLE_PLAYLIST' && item.id !== 'DELETE_PLAYLIST';
                  const songIndex = hasSongs ? i - 1 : -1;
                  
                  const isDraggable = isSong && hasSongs && activePlaylist.songs.length > 1;
                  const isBeingDragged = isSong && draggedItemIndex === songIndex;
                  const isDropTarget = isSong && dragOverIndex === songIndex && draggedItemIndex !== null && !isBeingDragged;

                  const classes = [
                    'px-3 py-2', 'transition-all', 'duration-200', 'rounded-md',
                    'cursor-pointer',
                    item.id === 'DELETE_PLAYLIST' ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/50' : '',
                    item.id === 'SHUFFLE_PLAYLIST' ? 'text-blue-600 font-bold hover:bg-blue-50 dark:hover:bg-blue-900/50' : '',
                    selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                    isDraggable ? 'cursor-move' : '',
                    isBeingDragged ? 'opacity-30 bg-gray-200' : '',
                    isDropTarget ? 'border-t-4 border-blue-600' : 'border-t-transparent',
                  ].filter(Boolean).join(' ');

                  return (
                    <li 
                      key={`${item.id}-${i}`}
                      onClick={() => handlePlaylistViewSelection(i)}
                      draggable={isDraggable}
                      onDragStart={() => handleDragStart(i)}
                      onDragEnter={() => handleDragEnter(i)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => e.preventDefault()}
                      className={classes}
                    >
                      {item.title}
                    </li>
                  );
                })}
                 {playlistViewItems.length <= 1 && (
                     <li className="p-4 text-gray-500 text-center">This playlist is empty.</li>
                 )}
              </ul>
          </Screen>
        );
      case 'song-menu':
        const songForMenu = activePlaylist?.songs[selectedSongIndex!];
        if (!songForMenu) return <Screen header="Error">Song not found.</Screen>;
        return (
            <Screen header={songForMenu.title}>
                 <ul className="p-1 space-y-1 cursor-pointer">{['Play'].map((item, i) => <li key={item} onClick={() => handleSongMenuSelection(i)} className={`px-3 py-2 font-semibold transition-colors rounded-md ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{item}</li>)}</ul>
            </Screen>
        );
      case 'delete-song-confirm':
      case 'delete-playlist-confirm':
        const confirmItems = ['No', 'Yes'];
        const isSongDelete = view === 'delete-song-confirm';
        const itemNameToDelete = isSongDelete ? activePlaylist?.songs[selectedSongIndex!].title : playlists.find(p => p.id === playlistToDeleteId)?.name;
        return (
            <Screen header={`Delete ${isSongDelete ? 'Song' : 'Playlist'}?`}>
                <div className="p-4 text-center">
                    <p className="mb-4">Are you sure you want to delete "{itemNameToDelete}"?</p>
                    <ul className="cursor-pointer p-1 space-y-1">{confirmItems.map((item, i) => <li key={item} onClick={() => handleConfirmation(i)} className={`px-3 py-2 font-semibold rounded-md ${item === 'Yes' ? 'text-red-500': ''} ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{item}</li>)}</ul>
                </div>
            </Screen>
        );
      case 'shuffle-confirm':
         const shuffleConfirmItems = ['No', 'Yes'];
         return (
            <Screen header="Shuffle Playlist?">
                <div className="p-4 text-center">
                    <p className="mb-4">Are you sure you want to shuffle and play this playlist?</p>
                    <ul className="cursor-pointer p-1 space-y-1">{shuffleConfirmItems.map((item, i) => <li key={item} onClick={() => handleConfirmation(i)} className={`px-3 py-2 font-semibold rounded-md ${item === 'Yes' ? 'text-blue-600': ''} ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>{item}</li>)}</ul>
                </div>
            </Screen>
        );
      case 'add-song':
        return (
            <Screen header="Add YouTube URL">
                <div className="p-4 space-y-4 flex flex-col h-full">
                    <label htmlFor="url-input" className="text-sm text-gray-700 dark:text-gray-300">Paste a YouTube URL below.</label>
                    <textarea 
                      id="url-input"
                      value={urlInput} 
                      onChange={e => setUrlInput(e.target.value)} 
                      className="w-full flex-grow p-2 border rounded-md resize-none bg-white dark:bg-zinc-700 dark:text-white dark:border-zinc-600 text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors" 
                      placeholder="e.g. https://www.youtube.com/watch?v=..." 
                      aria-label="YouTube URL Input"
                    />
                    <p className="text-xs text-center text-gray-500 pt-2">Press the center button to add.</p>
                </div>
            </Screen>
        );
      case 'select-playlist-for-song':
        return (
            <Screen header="Add to...">
                <ul className="cursor-pointer p-1 space-y-1">
                    {[...playlists, {id: 'new', name: 'Create New Playlist', songs:[]}].map((p, i) => (
                        <li key={p.id} onClick={() => handleSelectPlaylistForSongSelection(i)} className={`px-3 py-2 font-semibold transition-colors rounded-md flex justify-between items-center ${selectedIndex === i ? 'bg-blue-600 text-white' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}>
                            <span>{p.name}</span> <ChevronRightIcon className="w-5 h-5"/>
                        </li>
                    ))}
                </ul>
            </Screen>
        );
       case 'create-playlist-input':
        return (
            <Screen header="New Playlist">
                <div className="p-4 space-y-4">
                    <p className="text-sm text-gray-700 dark:text-gray-300">Enter a name for the new playlist.</p>
                    <input type="text" value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} className="w-full p-2 border rounded-md bg-white dark:bg-zinc-700 dark:text-white dark:border-zinc-600 text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors" placeholder="Playlist Name" autoFocus/>
                    <p className="text-xs text-center text-gray-500">Press the center button to save.</p>
                </div>
            </Screen>
        );
      case 'now-playing':
        if (!currentSong) return <Screen header="Now Playing"><p className="p-4 text-center text-gray-500">No song selected.</p></Screen>;

        const controls = [
            { id: 'prev', icon: <PrevTrackIcon className="w-6 h-6" /> },
            { id: 'play-pause', icon: isPlaying ? <PauseIcon className="w-6 h-6" /> : <PlayIcon className="w-6 h-6" /> },
            { id: 'next', icon: <NextTrackIcon className="w-6 h-6" /> },
        ];
        
        const isTrackControlSelected = selectedIndex >= 0 && selectedIndex <= 2;
        const isPlaybackSelected = selectedIndex === 3;
        const isRepeatSelected = selectedIndex === 4;

        return (
            <Screen header="Now Playing">
                <div className="p-2 flex flex-col items-center justify-between h-full text-center">
                    <div className="w-full">
                        <h2 className="font-bold text-xl mb-2 truncate">{currentSong.title}</h2>
                        <div id="youtube-player-container" className={`${playbackMode === 'audio' ? 'hidden' : ''}`}>
                            <div id="youtube-player"></div>
                        </div>
                        {playbackMode === 'audio' && (
                             <div className="flex-grow flex items-center justify-center my-2">
                                <div className="w-56 h-56 mx-auto shadow-2xl rounded-md overflow-hidden bg-gray-200 dark:bg-gray-700">
                                    <img 
                                        src={`https://img.youtube.com/vi/${currentSong.id}/hqdefault.jpg`} 
                                        alt="video thumbnail" 
                                        className="w-full h-full object-cover" 
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="w-full space-y-2 mt-auto">
                        <div onClick={() => isTrackControlSelected && handleNowPlayingSelection(selectedIndex)} className={`flex justify-around items-center p-1 rounded-md transition-colors ${isTrackControlSelected ? 'bg-blue-600/30' : ''}`}>
                            {controls.map((control, i) => (
                                <div key={control.id} onClick={(e) => { e.stopPropagation(); handleNowPlayingSelection(i); }} className={`p-2 rounded-full cursor-pointer ${selectedIndex === i ? 'bg-blue-600 text-white' : 'text-black dark:text-white'}`}>
                                    {control.icon}
                                </div>
                            ))}
                        </div>
                        <div onClick={() => handleNowPlayingSelection(3)} className={`p-1 rounded-md transition-colors cursor-pointer ${isPlaybackSelected ? 'bg-blue-600 text-white' : ''}`}>
                            <label className="flex items-center justify-center cursor-pointer">
                                <span className="mr-3 text-sm font-medium">Audio</span>
                                <div className="relative">
                                    <div className={`w-10 h-5 rounded-full transition-colors ${playbackMode === 'video' ? 'bg-blue-600' : 'bg-zinc-400 dark:bg-zinc-600'}`}>
                                      <div className={`absolute top-[2px] left-[2px] bg-white border-gray-300 border rounded-full h-4 w-4 transition-transform ${playbackMode === 'video' ? 'translate-x-5' : ''}`}></div>
                                    </div>
                                </div>
                                <span className="ml-3 text-sm font-medium">Video</span>
                            </label>
                        </div>
                         <div onClick={() => handleNowPlayingSelection(4)} className={`p-1 rounded-md transition-colors text-center cursor-pointer ${isRepeatSelected ? 'bg-blue-600 text-white' : ''}`}>
                            <div className="flex items-center justify-center space-x-2">
                                {repeatMode === 'off' && <RepeatIcon className={`w-5 h-5 ${isRepeatSelected ? 'text-white' : 'text-gray-500'}`} />}
                                {repeatMode === 'all' && <RepeatIcon className="w-5 h-5" />}
                                {repeatMode === 'one' && <RepeatOneIcon className="w-5 h-5" />}
                                <span className="text-sm">Repeat: <span className="font-bold uppercase">{repeatMode}</span></span>
                            </div>
                        </div>
                    </div>
                </div>
            </Screen>
        );
      default: return <Screen header="FLEX">Loading...</Screen>;
    }
  };

  return (
    <div className={`bg-black min-h-screen w-full flex justify-center items-center p-4 ${theme}`}>
      <div className="relative w-full max-w-sm h-[85vh] max-h-[700px] bg-zinc-200 dark:bg-zinc-900 rounded-3xl shadow-2xl flex flex-col p-2.5 border border-zinc-400 dark:border-zinc-700">
        {renderView()}
        <ClickWheel
          onMenuClick={handleMenu}
          onCenterClick={handleCenterClick}
          onCenterLongPress={handleCenterLongPress}
          onNextClick={handleNext}
          onPrevClick={handlePrev}
          onPlayPauseClick={handlePlayPause}
          isPlaying={isPlaying}
        />
        <button
          onClick={() => {
              triggerVibration();
              setTheme(t => t === 'light' ? 'dark' : 'light')
          }}
          className="absolute bottom-4 right-4 text-gray-600 dark:text-gray-300 p-2 rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors shadow-md"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
};

export default App;
