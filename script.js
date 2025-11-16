// IMPORTANT: Replace this with your own Client ID from the Spotify Developer Dashboard.
const CLIENT_ID = "36232981742840aca3fb864959b3a6f1"; 

const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = ["user-top-read", "playlist-modify-public"];

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const recommendationsView = document.getElementById('recommendations-view');

let accessToken = null;
let currentUserId = null; 
let currentRecommendations = []; 

// --- Helper Functions ---

function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// --- Authentication ---

document.getElementById('login-button').addEventListener('click', async () => {
    try {
        const codeVerifier = generateRandomString(128);
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        window.sessionStorage.setItem('code_verifier', codeVerifier);

        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('response_type', 'code');
        params.append('redirect_uri', REDIRECT_URI);
        params.append('scope', SCOPES.join(' '));
        params.append('code_challenge_method', 'S256');
        params.append('code_challenge', codeChallenge);

        document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
    } catch (error) {
        alert(`Login error: ${error.message}`);
    }
});

window.onload = async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        try {
            accessToken = await getAccessToken(code);
            window.history.pushState({}, '', REDIRECT_URI);
            showDashboard();
        } catch (error) {
            console.error("Auth Error:", error);
            alert("Error during login. Please try again.");
        }
    }
};

async function getAccessToken(code) {
    const codeVerifier = window.sessionStorage.getItem('code_verifier');
    if (!codeVerifier) throw new Error("Code verifier not found.");

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
    if (!result.ok) throw new Error(responseJson.error_description);
    return responseJson.access_token;
}

// --- UI Management ---

function showDashboard() {
    loginView.classList.add('hidden');
    recommendationsView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    fetchUserProfile();
    fetchTopItems('medium_term');
}

function showRecommendationsPage() {
    dashboardView.classList.add('hidden');
    recommendationsView.classList.remove('hidden');
    document.getElementById('recommendations-list').classList.add('hidden');
    document.getElementById('recommendations-loading').classList.remove('hidden');
    fetchRecommendations();
}

// --- Bulletproof API Fetcher ---

async function spotifyFetch(endpoint, method = 'GET', body = null) {
    // 1. CLEANUP: Remove any accidental leading slashes to prevent //v1//error
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = `https://api.spotify.com/v1/${cleanEndpoint}`;

    console.log(`Fetching: ${url}`); // Debug log

    const options = {
        method: method,
        headers: { 'Authorization': `Bearer ${accessToken}` }
    };
    if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    
    if (response.status === 401) {
        alert("Session expired. Please log in again.");
        window.location = REDIRECT_URI;
        return null;
    }
    
    if (!response.ok) {
        console.error('API Error:', response.status, response.statusText);
        // Return detailed error info
        return { error: true, status: response.status, message: response.statusText, url: url };
    }
    return await response.json();
}

async function fetchUserProfile() {
    const data = await spotifyFetch('me');
    if (data && !data.error) {
        currentUserId = data.id;
        document.getElementById('user-display-name').textContent = data.display_name;
        if (data.images?.length > 0) {
            document.getElementById('user-profile-pic').innerHTML = `<img src="${data.images[0].url}" alt="Profile" class="w-full h-full object-cover rounded-full">`;
        }
    }
}

async function fetchTopItems(timeRange) {
    const [artists, tracks] = await Promise.all([
        spotifyFetch(`me/top/artists?time_range=${timeRange}&limit=5`),
        spotifyFetch(`me/top/tracks?time_range=${timeRange}&limit=50`)
    ]);

    if (artists && !artists.error) displayTopArtists(artists.items);
    if (tracks && !tracks.error) {
        displayTopTracks(tracks.items.slice(0, 5));
        displayTopAlbums(tracks.items);
    }
}

// --- Robust Recommendation Logic ---

async function fetchRecommendations() {
    const listEl = document.getElementById('recommendations-list');
    const loadingEl = document.getElementById('recommendations-loading');
    
    try {
        // Attempt to get seeds
        const [artistsData, tracksData] = await Promise.all([
            spotifyFetch('me/top/artists?time_range=long_term&limit=1'),
            spotifyFetch('me/top/tracks?time_range=long_term&limit=1')
        ]);

        let seedArtists = (artistsData?.items?.[0]?.id) || "";
        let seedTracks = (tracksData?.items?.[0]?.id) || "";
        let recData = null;

        // Strategy 1: Try using Artist + Track seeds
        if (seedArtists || seedTracks) {
            let query = 'recommendations?limit=10';
            if (seedArtists) query += `&seed_artists=${seedArtists}`;
            if (seedTracks) query += `&seed_tracks=${seedTracks}`;
            
            recData = await spotifyFetch(query);
        }

        // Strategy 2: Fallback to "Pop" genre if Strategy 1 failed
        if (!recData || recData.error || !recData.tracks || recData.tracks.length === 0) {
            console.log("Fallback to Pop genre");
            // HARDCODED STRING to ensure no variable corruption
            recData = await spotifyFetch('recommendations?limit=10&seed_genres=pop');
        }

        loadingEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        if (recData && !recData.error && recData.tracks?.length > 0) {
            currentRecommendations = recData.tracks;
            displayRecommendations(recData.tracks);
        } else {
            // Display Debug Info on Screen
            const status = recData?.status || "Unknown";
            const msg = recData?.message || "No data";
            const url = recData?.url || "Unknown URL";
            
            listEl.innerHTML = `
                <div class="col-span-full text-center text-red-400 bg-gray-800 p-6 rounded-lg">
                    <h3 class="text-xl font-bold mb-2">Connection Error</h3>
                    <p>We couldn't fetch recommendations.</p>
                    <div class="mt-4 text-left bg-black p-4 rounded text-xs font-mono overflow-auto">
                        <p>Status: ${status}</p>
                        <p>Message: ${msg}</p>
                        <p>Endpoint: ${url}</p>
                    </div>
                    <p class="mt-4 text-sm text-gray-400">If you see a 404, please check if an ad-blocker is active.</p>
                </div>`;
        }

    } catch (e) {
        console.error(e);
        loadingEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        listEl.innerHTML = `<p class="text-red-500 text-center col-span-full">Critical Error: ${e.message}</p>`;
    }
}

// --- Playlist Creation ---

async function createPlaylist() {
    if (!currentUserId || currentRecommendations.length === 0) return;
    const btn = document.getElementById('save-playlist-btn');
    const oldText = btn.innerHTML;
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        const playlist = await spotifyFetch(`users/${currentUserId}/playlists`, 'POST', {
            name: `Statify Recommendations ${new Date().toLocaleDateString()}`,
            description: "Generated by Statify"
        });

        if (playlist && !playlist.error) {
            const uris = currentRecommendations.map(t => t.uri);
            await spotifyFetch(`playlists/${playlist.id}/tracks`, 'POST', { uris });
            alert("Playlist saved to your library!");
            btn.textContent = "Saved!";
        } else {
            throw new Error("Playlist creation failed");
        }
    } catch (e) {
        alert("Error saving playlist");
        btn.innerHTML = oldText;
        btn.disabled = false;
    }
}

// --- UI Rendering ---

function displayTopArtists(artists) {
    document.getElementById('top-artists-list').innerHTML = artists.map((artist, i) => `
        <li class="flex items-center space-x-4 bg-gray-800 p-3 rounded-lg">
            <span class="text-green-400 font-bold w-6">${i + 1}</span>
            <img src="${artist.images[0]?.url}" class="w-12 h-12 rounded-full object-cover">
            <span class="font-semibold truncate">${artist.name}</span>
        </li>`).join('');
}

function displayTopTracks(tracks) {
    document.getElementById('top-tracks-list').innerHTML = tracks.map((track, i) => `
        <li class="flex items-center space-x-4 bg-gray-800 p-3 rounded-lg">
            <span class="text-green-400 font-bold w-6">${i + 1}</span>
            <img src="${track.album.images[0]?.url}" class="w-12 h-12 rounded object-cover">
            <div class="min-w-0">
                <p class="font-semibold truncate">${track.name}</p>
                <p class="text-sm text-gray-400 truncate">${track.artists[0].name}</p>
            </div>
        </li>`).join('');
}

function displayTopAlbums(tracks) {
    // Simple de-duplication for albums
    const seen = new Set();
    const albums = [];
    for (const t of tracks) {
        if (!seen.has(t.album.id)) {
            seen.add(t.album.id);
            albums.push(t.album);
        }
        if (albums.length >= 5) break;
    }

    document.getElementById('top-albums-list').innerHTML = albums.map((album, i) => `
        <li class="flex items-center space-x-4 bg-gray-800 p-3 rounded-lg">
            <span class="text-green-400 font-bold w-6">${i + 1}</span>
            <img src="${album.images[0]?.url}" class="w-12 h-12 rounded object-cover">
            <div class="min-w-0">
                <p class="font-semibold truncate">${album.name}</p>
                <p class="text-sm text-gray-400 truncate">${album.artists[0].name}</p>
            </div>
        </li>`).join('');
}

function displayRecommendations(tracks) {
    const list = document.getElementById('recommendations-list');
    const btnHtml = `
        <div class="col-span-full text-center mb-6">
            <button id="save-playlist-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:scale-105">
                Save to Spotify Library
            </button>
        </div>`;
        
    const cardsHtml = tracks.map(t => `
        <a href="${t.external_urls.spotify}" target="_blank" class="bg-gray-800 p-4 rounded-xl hover:bg-gray-700 transition group block">
            <img src="${t.album.images[0]?.url}" class="w-full aspect-square object-cover rounded-lg mb-4 shadow-lg">
            <h3 class="font-bold truncate text-white">${t.name}</h3>
            <p class="text-sm text-gray-400 truncate">${t.artists.map(a => a.name).join(', ')}</p>
        </a>`).join('');

    list.innerHTML = btnHtml + cardsHtml;
    document.getElementById('save-playlist-btn').addEventListener('click', createPlaylist);
}

// --- Events ---

document.getElementById('time-range-select').addEventListener('change', (e) => fetchTopItems(e.target.value));
document.getElementById('get-recommendations-button').addEventListener('click', showRecommendationsPage);
document.getElementById('back-to-dashboard-button').addEventListener('click', () => {
    recommendationsView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
});