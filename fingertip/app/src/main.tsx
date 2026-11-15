import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './ios.css'
import './ios-call.css'
import App from './App'
import Gallery from './Gallery'
import { MeetLive } from './screens/Meet'
import { SharedShow } from './screens/Show'
import { SignsLab } from './screens/SignsLab'
import { TrackBench } from './TrackBench'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash.startsWith('#s/') ? <SharedShow token={location.hash.slice(3)} />
      : location.hash === '#gallery' ? <Gallery />
      : location.hash === '#meet' ? <MeetLive />
      : location.hash === '#trackbench' ? <TrackBench />
      : location.hash === '#signs-lab' ? <SignsLab onDone={() => { location.hash = ''; location.reload() }} />
      : <App />}
  </StrictMode>,
)

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}


