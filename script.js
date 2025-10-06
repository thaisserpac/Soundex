// IMPORTANT: Replace this with your own Client ID from the Spotify Developer Dashboard.
const CLIENT_ID = "36232981742840aca3fb864959b3a6f1"; 

// This must match the Redirect URI you set in your Spotify app settings.
const REDIRECT_URI = window.location.origin + window.location.pathname;

// Scopes define the permissions we are asking the user for.
const SCOPES = ["user-top-read"];

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const recommendationsView = document.getElementById('recommendations-view');

let accessToken = null;

// --- PKCE Flow Helper Functions ---

// 1. Generate a random string for the code verifier
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// 2. Hash the code verifier to create the code challenge
async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// --- Core Authentication Flow (Now with PKCE) ---

// When the user clicks login
document.getElementById('login-button').addEventListener('click', async () => {
    try {
        if (!CLIENT_ID || CLIENT_ID === "YOUR_SPOTIFY_CLIENT_ID") {
            alert("Please replace 'YOUR_SPOTIFY_CLIENT_ID' in the script with your actual Spotify Client ID.");
            return;
        }

        console.log("Login button clicked. Starting PKCE flow...");

        const codeVerifier = generateRandomString(128);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        
        console.log("Code verifier and challenge generated.");

        // Save the verifier in the browser's session storage
        window.sessionStorage.setItem('code_verifier', codeVerifier);

        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('response_type', 'code'); // We ask for a 'code' now, not a 'token'
        params.append('redirect_uri', REDIRECT_URI);
        params.append('scope', SCOPES.join(' '));
        params.append('code_challenge_method', 'S256');
        params.append('code_challenge', codeChallenge);

        console.log("Redirecting to Spotify authorization page...");
        // Redirect the user to the Spotify authorization page
        document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
    } catch (error) {
        console.error("Error in login button click handler:", error);
        alert(`A critical error occurred while trying to log in. Please check the console for more details. \nError: ${error.message}`);
    }
});


// On page load, handle the redirect back from Spotify
window.onload = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        // We have a code, now we need to exchange it for an access token
        try {
            accessToken = await getAccessToken(code);
            // Clean the URL
            window.history.pushState({}, '', REDIRECT_URI);
            showDashboard();
        } catch (error) {
            console.error("Error getting access token:", error);
            alert("There was an error during login. Please try again.");
        }
    }
};

// Function to exchange the authorization code for an access token
async function getAccessToken(code) {
    const codeVerifier = window.sessionStorage.getItem('code_verifier');
    if (!codeVerifier) {
        throw new Error("Code verifier not found in session storage.");
    }

    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);
    params.append('code_verifier', codeVerifier);

    const result = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params
    });

    const responseJson = await result.json();

    if (!result.ok) {
        throw new Error(`Error fetching token: ${responseJson.error_description}`);
    }
    
    return responseJson.access_token;
}


// --- The rest of your application logic (UI, API calls) remains mostly the same ---

// --- UI View Management ---

function showDashboard() {
    loginView.classList.add('hidden');
    recommendationsView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    
    fetchUserProfile();
    fetchTopItems('medium_term'); // Default to medium term
}

function showRecommendationsPage() {
    dashboardView.classList.add('hidden');
    recommendationsView.classList.remove('hidden');
    document.getElementById('recommendations-list').classList.add('hidden');
    document.getElementById('recommendations-loading').classList.remove('hidden');
    fetchRecommendations();
}

// --- API Fetching Functions ---

async function spotifyFetch(endpoint) {
    const response = await fetch(`https://api.spotify.com/v1/${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (response.status === 401) { // Token expired or invalid
        alert("Your session has expired. Please log in again.");
        window.sessionStorage.clear();
        window.location = REDIRECT_URI;
        return;
    }
    if (!response.ok) {
        console.error('API Error:', response.status, response.statusText);
        return null;
    }
    return await response.json();
}

async function fetchUserProfile() {
    const data = await spotifyFetch('me');
    if (data) {
        document.getElementById('user-display-name').textContent = data.display_name;
        if (data.images && data.images.length > 0) {
            document.getElementById('user-profile-pic').innerHTML = `<img src="${data.images[0].url}" alt="${data.display_name}" class="w-full h-full object-cover rounded-full">`;
        }
    }
}

async function fetchTopItems(timeRange) {
    const [artistsData, tracksData] = await Promise.all([
        spotifyFetch(`me/top/artists?time_range=${timeRange}&limit=5`),
        spotifyFetch(`me/top/tracks?time_range=${timeRange}&limit=50`)
    ]);

    if (artistsData) displayTopArtists(artistsData.items);
    if (tracksData) {
        displayTopTracks(tracksData.items.slice(0, 5));
        displayTopAlbums(tracksData.items);
    }
}

async function fetchRecommendations() {
    const [artistsData, tracksData] = await Promise.all([
        spotifyFetch(`me/top/artists?time_range=medium_term&limit=2`),
        spotifyFetch(`me/top/tracks?time_range=medium_term&limit=3`)
    ]);

    if (!artistsData || !tracksData) return;

    const seedArtists = artistsData.items.map(artist => artist.id).join(',');
    const seedTracks = tracksData.items.map(track => track.id).join(',');
    
    const recommendationsData = await spotifyFetch(`recommendations?limit=20&seed_artists=${seedArtists}&seed_tracks=${seedTracks}`);
    
    document.getElementById('recommendations-loading').classList.add('hidden');
    if (recommendationsData) {
         document.getElementById('recommendations-list').classList.remove('hidden');
        displayRecommendations(recommendationsData.tracks);
    }
}

// --- Display Functions ---

function displayTopArtists(artists) {
    const list = document.getElementById('top-artists-list');
    list.innerHTML = artists.map((artist, index) => `
        <li class="flex items-center space-x-4 hover:bg-gray-700 p-2 rounded-md transition duration-200">
            <span class="text-gray-400 font-bold w-6 text-center">${index + 1}</span>
            <img src="${artist.images[2]?.url || 'https://placehold.co/64x64/1f1f1f/ffffff?text=?'}" alt="${artist.name}" class="w-16 h-16 rounded-md object-cover">
            <span class="font-semibold">${artist.name}</span>
        </li>
    `).join('');
}

function displayTopTracks(tracks) {
    const list = document.getElementById('top-tracks-list');
    list.innerHTML = tracks.map((track, index) => `
        <li class="flex items-center space-x-4 hover:bg-gray-700 p-2 rounded-md transition duration-200">
            <span class="text-gray-400 font-bold w-6 text-center">${index + 1}</span>
            <img src="${track.album.images[2]?.url || 'https://placehold.co/64x64/1f1f1f/ffffff?text=?'}" alt="${track.name}" class="w-16 h-16 rounded-md object-cover">
            <div>
                <p class="font-semibold">${track.name}</p>
                <p class="text-sm text-gray-400">${track.artists.map(a => a.name).join(', ')}</p>
            </div>
        </li>
    `).join('');
}

function displayTopAlbums(tracks) {
    const albumCounts = {};
    tracks.forEach(track => {
        const album = track.album;
        if (albumCounts[album.id]) {
            albumCounts[album.id].count++;
        } else {
            albumCounts[album.id] = { ...album, count: 1 };
        }
    });

    const sortedAlbums = Object.values(albumCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const list = document.getElementById('top-albums-list');
    list.innerHTML = sortedAlbums.map((album, index) => `
         <li class="flex items-center space-x-4 hover:bg-gray-700 p-2 rounded-md transition duration-200">
            <span class="text-gray-400 font-bold w-6 text-center">${index + 1}</span>
            <img src="${album.images[2]?.url || 'https://placehold.co/64x64/1f1f1f/ffffff?text=?'}" alt="${album.name}" class="w-16 h-16 rounded-md object-cover">
            <div>
                <p class="font-semibold">${album.name}</p>
                <p class="text-sm text-gray-400">${album.artists.map(a => a.name).join(', ')}</p>
            </div>
        </li>
    `).join('');
}

function displayRecommendations(tracks) {
    const list = document.getElementById('recommendations-list');
    list.innerHTML = tracks.map(track => `
        <a href="${track.external_urls.spotify}" target="_blank" class="bg-gray-800 p-4 rounded-lg hover:bg-gray-700 transition duration-300 group">
            <div class="relative pb-[100%] mb-4">
                <img src="${track.album.images[1]?.url || 'https://placehold.co/300x300/1f1f1f/ffffff?text=?'}" alt="${track.name}" class="absolute top-0 left-0 w-full h-full object-cover rounded-md">
            </div>
            <h3 class="font-bold truncate">${track.name}</h3>
            <p class="text-sm text-gray-400 truncate group-hover:text-white">${track.artists.map(a => a.name).join(', ')}</p>
        </a>
    `).join('');
}

// --- Event Listeners for UI interaction ---

document.getElementById('time-range-select').addEventListener('change', (e) => {
    fetchTopItems(e.target.value);
});

document.getElementById('get-recommendations-button').addEventListener('click', showRecommendationsPage);

document.getElementById('back-to-dashboard-button').addEventListener('click', () => {
    recommendationsView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
});

