document.addEventListener('DOMContentLoaded', () => {
    const API_URL = window.location.origin;
    const AUTH_TOKEN_KEY = 'authToken';
    const AUTH_USER_KEY = 'authUser';

    const playerNameInput = document.getElementById('playerName');
    const createRoomBtn = document.getElementById('createRoom');
    const joinRoomBtn = document.getElementById('joinRoom');
    const roomCodeInput = document.getElementById('roomCode');

    const authStatus = document.getElementById('authStatus');
    const loginPanel = document.getElementById('loginPanel');
    const registerPanel = document.getElementById('registerPanel');
    const showLoginTab = document.getElementById('showLoginTab');
    const showRegisterTab = document.getElementById('showRegisterTab');
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const logoutBtn = document.getElementById('logoutBtn');

    const loginUsernameInput = document.getElementById('loginUsername');
    const loginPasswordInput = document.getElementById('loginPassword');

    const registerDisplayNameInput = document.getElementById('registerDisplayName');
    const registerUsernameInput = document.getElementById('registerUsername');
    const registerPasswordInput = document.getElementById('registerPassword');

    function showError(message) {
        const errorElement = document.createElement('div');
        errorElement.className = 'notification error';
        errorElement.textContent = message;
        document.body.appendChild(errorElement);

        setTimeout(() => {
            errorElement.remove();
        }, 3000);
    }

    function showSuccess(message) {
        const successElement = document.createElement('div');
        successElement.className = 'notification success';
        successElement.textContent = message;
        document.body.appendChild(successElement);

        setTimeout(() => {
            successElement.remove();
        }, 3000);
    }

    function setButtonLoading(button, isLoading, loadingText, idleText) {
        button.disabled = isLoading;
        button.textContent = isLoading ? loadingText : idleText;
    }

    function getAuthToken() {
        return localStorage.getItem(AUTH_TOKEN_KEY);
    }

    function getAuthUser() {
        const raw = localStorage.getItem(AUTH_USER_KEY);
        if (!raw) return null;

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function saveAuth(token, user) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
        updateAuthUI(user);
    }

    function clearAuth() {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        updateAuthUI(null);
    }

    function updateAuthUI(user) {
        const isLoggedIn = !!user;

        authStatus.textContent = isLoggedIn
            ? `Sesión iniciada como ${user.displayName} (@${user.username})`
            : 'No has iniciado sesión.';

        logoutBtn.style.display = isLoggedIn ? 'flex' : 'none';

        if (isLoggedIn && user.displayName) {
            playerNameInput.value = user.displayName;
        }
    }

    function switchAuthTab(type) {
        const isLogin = type === 'login';

        showLoginTab.classList.toggle('active', isLogin);
        showRegisterTab.classList.toggle('active', !isLogin);

        loginPanel.classList.toggle('active', isLogin);
        registerPanel.classList.toggle('active', !isLogin);
    }

    function validatePlayerName(name) {
        if (!name || name.trim() === '') {
            showError('Ingresa tu nombre');
            return false;
        }
        if (name.length > 20) {
            showError('El nombre no puede tener más de 20 caracteres');
            return false;
        }
        return true;
    }

    function validateRoomCode(code) {
        if (!code || code.trim() === '') {
            showError('Ingresa el código de sala');
            return false;
        }
        if (!/^\d{4}$/.test(code)) {
            showError('El código debe tener 4 dígitos');
            return false;
        }
        return true;
    }

    function validateCredentials(username, password) {
        if (!username || username.trim() === '') {
            showError('El usuario es obligatorio');
            return false;
        }

        if (!password || password === '') {
            showError('La contraseña es obligatoria');
            return false;
        }

        return true;
    }

    function validateAuthDisplayName(displayName) {
        if (!displayName || displayName.trim() === '') {
            showError('El nombre visible es obligatorio');
            return false;
        }

        return true;
    }

    async function fetchWithAuth(url, options = {}) {
        const token = getAuthToken();
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return fetch(url, {
            ...options,
            headers
        });
    }

    async function hydrateSession() {
        const token = getAuthToken();
        const cachedUser = getAuthUser();

        if (!token) {
            updateAuthUI(null);
            return;
        }

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/me`, { method: 'GET' });
            if (!response.ok) {
                clearAuth();
                return;
            }

            const data = await response.json();
            if (data.success && data.user) {
                const normalizedUser = {
                    id: data.user.id,
                    username: data.user.username,
                    displayName: data.user.displayName
                };
                saveAuth(token, normalizedUser);
            } else {
                clearAuth();
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
            updateAuthUI(cachedUser);
        }
    }

    loginBtn.addEventListener('click', async () => {
        const username = loginUsernameInput.value.trim();
        const password = loginPasswordInput.value;

        if (!validateCredentials(username, password)) return;

        setButtonLoading(loginBtn, true, 'Ingresando...', 'Iniciar sesión');

        try {
            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                showError(data.message || 'No se pudo iniciar sesión');
                return;
            }

            saveAuth(data.token, data.user);
            showSuccess('Sesión iniciada correctamente');
            loginPasswordInput.value = '';
        } catch (error) {
            console.error('Error en login:', error);
            showError('Error al conectar con el servidor');
        } finally {
            setButtonLoading(loginBtn, false, 'Ingresando...', 'Iniciar sesión');
        }
    });

    registerBtn.addEventListener('click', async () => {
        const displayName = registerDisplayNameInput.value.trim();
        const username = registerUsernameInput.value.trim();
        const password = registerPasswordInput.value;

        if (!validateAuthDisplayName(displayName)) return;
        if (!validateCredentials(username, password)) return;

        setButtonLoading(registerBtn, true, 'Creando...', 'Crear usuario');

        try {
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ username, password, displayName })
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                showError(data.message || 'No se pudo crear el usuario');
                return;
            }

            saveAuth(data.token, data.user);
            showSuccess('Usuario creado correctamente');
            registerPasswordInput.value = '';
            switchAuthTab('login');
        } catch (error) {
            console.error('Error en registro:', error);
            showError('Error al conectar con el servidor');
        } finally {
            setButtonLoading(registerBtn, false, 'Creando...', 'Crear usuario');
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await fetchWithAuth(`${API_URL}/auth/logout`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
        } finally {
            clearAuth();
            showSuccess('Sesión cerrada');
        }
    });

    showLoginTab.addEventListener('click', () => switchAuthTab('login'));
    showRegisterTab.addEventListener('click', () => switchAuthTab('register'));

    createRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();

        if (!validatePlayerName(playerName)) return;

        createRoomBtn.disabled = true;
        createRoomBtn.textContent = 'Creando...';

        try {
            const response = await fetchWithAuth(`${API_URL}/create-room`, {
                method: 'POST',
                body: JSON.stringify({ playerName })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('playerId', data.playerId);
                sessionStorage.setItem('roomId', data.roomId);
                sessionStorage.setItem('isHost', 'true');
                window.location.href = 'sala.html';
            } else {
                showError(data.message || 'Error al crear la sala');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error al conectar con el servidor');
        } finally {
            createRoomBtn.disabled = false;
            createRoomBtn.textContent = 'Crear Sala';
        }
    });

    joinRoomBtn.addEventListener('click', async () => {
        const playerName = playerNameInput.value.trim();
        const roomCode = roomCodeInput.value.trim();

        if (!validatePlayerName(playerName)) return;
        if (!validateRoomCode(roomCode)) return;

        joinRoomBtn.disabled = true;
        joinRoomBtn.textContent = 'Uniendo...';

        try {
            const response = await fetchWithAuth(`${API_URL}/join-room`, {
                method: 'POST',
                body: JSON.stringify({
                    playerName,
                    roomId: roomCode
                })
            });

            if (!response.ok) {
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            if (data.success) {
                sessionStorage.setItem('playerName', playerName);
                sessionStorage.setItem('playerId', data.playerId);
                sessionStorage.setItem('roomId', roomCode);
                sessionStorage.setItem('isHost', 'false');
                window.location.href = 'sala.html';
            } else {
                showError(data.message || 'Error al unirse a la sala');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error al conectar con el servidor');
        } finally {
            joinRoomBtn.disabled = false;
            joinRoomBtn.textContent = 'Unirse';
        }
    });

    playerNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createRoomBtn.click();
        }
    });

    roomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            joinRoomBtn.click();
        }
    });

    hydrateSession();
});
