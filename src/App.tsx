
import { useRef, useState } from 'react'
import * as Tone from 'tone'
import './App.css'

function App() {
  const synthRef = useRef<Tone.Synth | null>(null)
  const [status, setStatus] = useState('Ready to play')

  async function playNote() {
    try {
      // Browsers require a user interaction before playing audio.
      await Tone.start()

      // Create our first virtual instrument.
      if (!synthRef.current) {
        synthRef.current = new Tone.Synth().toDestination()
      }

      // Play the musical note C4.
      synthRef.current.triggerAttackRelease('C4', '8n')

      setStatus('Playing C4!')
    } catch (error) {
      console.error(error)
      setStatus('Audio error. Check the browser console.')
    }
  }

  return (
    <main style={{ textAlign: 'center', padding: '60px 20px' }}>
      <h1>🎵 RemixRelay</h1>

      <p>Collaborative Music Studio</p>

      <h2>Our First Instrument</h2>

      <button onClick={() => void playNote()}>
        ▶ Play C4
      </button>

      <p>{status}</p>
    </main>
  )
}

export default App
