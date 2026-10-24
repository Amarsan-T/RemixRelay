import { useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { HomeScreen } from './screens/HomeScreen'
import { PlaylistScreen } from './screens/PlaylistScreen'
import { PianoRollScreen } from './screens/PianoRollScreen'
import { SONG_COLORS, createSong, loadSongs, saveSongs } from './music/songs'
import type { Pattern, Song } from './music/types'

// Which screen is showing. Home -> Playlist (one song) -> Piano Roll (one pattern).
type Route =
  | { screen: 'home' }
  | { screen: 'playlist'; songId: string }
  | { screen: 'pianoRoll'; songId: string; patternId: string }

function App() {
  const [songs, setSongs] = useState<Song[]>(loadSongs)
  const [route, setRoute] = useState<Route>({ screen: 'home' })

  // Save every change so songs survive a page refresh.
  useEffect(() => saveSongs(songs), [songs])

  const goHome = () => setRoute({ screen: 'home' })
  const openSong = (songId: string) => setRoute({ screen: 'playlist', songId })

  /** Applies a change to one song and stamps it as just edited. */
  function updateSong(songId: string, change: (song: Song) => Song) {
    setSongs((all) =>
      all.map((s) => (s.id === songId ? { ...change(s), updatedAt: Date.now() } : s)),
    )
  }

  function newSong() {
    const song = createSong(
      `Untitled song ${songs.length + 1}`,
      SONG_COLORS[songs.length % SONG_COLORS.length],
    )
    setSongs([song, ...songs])
    openSong(song.id)
  }

  const song = route.screen === 'home' ? undefined : songs.find((s) => s.id === route.songId)
  const pattern =
    route.screen === 'pianoRoll' ? song?.patterns.find((p) => p.id === route.patternId) : undefined

  let screen
  if (song && pattern) {
    screen = (
      <PianoRollScreen
        key={pattern.id}
        song={song}
        pattern={pattern}
        onChangeSong={(change) => updateSong(song.id, change)}
        onChangePattern={(change: (p: Pattern) => Pattern) =>
          updateSong(song.id, (s) => ({
            ...s,
            patterns: s.patterns.map((p) => (p.id === pattern.id ? change(p) : p)),
          }))
        }
        onHome={goHome}
        onBack={() => openSong(song.id)}
      />
    )
  } else if (song) {
    screen = (
      <PlaylistScreen
        key={song.id}
        song={song}
        onChange={(change) => updateSong(song.id, change)}
        onHome={goHome}
        onOpenPattern={(patternId) =>
          setRoute({ screen: 'pianoRoll', songId: song.id, patternId })
        }
      />
    )
  } else {
    screen = <HomeScreen songs={songs} onOpenSong={openSong} onNewSong={newSong} />
  }

  return (
    <div className="min-h-svh">
      <Sidebar
        songs={songs}
        activeSongId={song?.id ?? null}
        onHome={goHome}
        onOpenSong={openSong}
      />
      <main className="md:pl-[248px]">{screen}</main>
    </div>
  )
}

export default App
