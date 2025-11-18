// This new function will replace your old one in script.js
async function playSong(videoId) {
  // IMPORTANT: Find your <audio> tag in index.html.
  // It might have an id like <audio id="audio-player">. 
  // Replace 'your-audio-element-id' with its actual ID.
  const audioPlayer = document.getElementById('your-audio-element-id'); 
  
  try {
    // This line calls the helper you just created
    const response = await fetch(`/api/get-audio-stream?videoId=${videoId}`);
    
    if (!response.ok) {
      // This will show the error if the helper fails
      alert("Could not get audio for this song. It may be restricted or unavailable.");
      return;
    }

    const data = await response.json();
    const audioStreamUrl = data.audioUrl;

    // Set the audio player's source to the direct link from the helper
    audioPlayer.src = audioStreamUrl;
    audioPlayer.play();

  } catch (error) {
    console.error("Error playing song:", error);
    alert("An error occurred while trying to play the song.");
  }
}
