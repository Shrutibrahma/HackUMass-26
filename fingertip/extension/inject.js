// Runs in the meeting page's main world. It mixes approved Fingertip TTS with the browser
// microphone stream when the meeting requests audio. This is experimental and browser-only.
(() => {
  if (window.__fingertipAudioMixer || !navigator.mediaDevices?.getUserMedia) return
  window.__fingertipAudioMixer = true
  const mediaDevices = navigator.mediaDevices
  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices)
  let context = null
  let voiceDestination = null

  mediaDevices.getUserMedia = async (constraints) => {
    const stream = await originalGetUserMedia(constraints)
    if (!constraints?.audio || !stream.getAudioTracks().length) return stream
    context ||= new AudioContext()
    const destination = context.createMediaStreamDestination()
    context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(destination)
    voiceDestination = context.createGain()
    voiceDestination.gain.value = 1
    voiceDestination.connect(destination)
    return new MediaStream([...destination.stream.getAudioTracks(), ...stream.getVideoTracks()])
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.fingertip !== 'play' || !event.data.audio) return
    try {
      context ||= new AudioContext()
      if (context.state === 'suspended') await context.resume()
      const decoded = await context.decodeAudioData(event.data.audio)
      const source = context.createBufferSource()
      source.buffer = decoded
      if (voiceDestination) source.connect(voiceDestination)
      const monitor = context.createGain()
      monitor.gain.value = 0.18
      source.connect(monitor).connect(context.destination)
      source.start()
    } catch (error) {
      console.warn('[Fingertip] meeting voice playback failed', error)
    }
  })
})()
