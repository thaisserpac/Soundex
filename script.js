const clientId = 'YOUR_SPOTIFY_CLIENT_ID'; 
const clientSecret = 'YOUR_SPOTIFY_CLIENT_SECRET';

async function getAccessToken() {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + btoa(clientId + ':' + clientSecret)
        },
        body: 'grant_type=client_credentials'
    });
    const data = await response.json();
    return data.access_token;
}

async function searchTrack() {
    const trackName = document.getElementById('trackInput').value;
    if (!trackName) {
        alert("Please enter a song name!");
        return;
    }

    const accessToken = await getAccessToken();
    const response = await fetch(`https://api.spotify.com/v1/search?q=${trackName}&type=track&limit=5`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const data = await response.json();
    displayResults(data.tracks.items);
}

function displayResults(tracks) {
    const resultsDiv = document.getElementById('trackResults');
    resultsDiv.innerHTML = '';

    if (tracks.length === 0) {
        resultsDiv.innerHTML = '<p>No tracks found.</p>';
        return;
    }

    tracks.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.classList.add('track');

        trackDiv.innerHTML = `
            <img src="${track.album.images[0].url}" width="50">
            <p><strong>${track.name}</strong> by ${track.artists.map(artist => artist.name).join(', ')}</p>
            <a href="${track.external_urls.spotify}" target="_blank">🎧 Listen</a>
        `;

        resultsDiv.appendChild(trackDiv);
    });
}
