document.addEventListener('DOMContentLoaded', () => {
    const API_URL = window.location.origin;
    const AUTH_TOKEN_KEY = 'authToken';
    const AUTH_USER_KEY = 'authUser';
    const GUEST_USER_KEY = 'guestUser';

    const createRoomBtn = document.getElementById('createRoom');
    const joinRoomBtn = document.getElementById('joinRoom');
    const joinRoomModal = document.getElementById('joinRoomModal');
    const joinRoomBackdrop = document.getElementById('joinRoomBackdrop');
    const joinRoomCodeInput = document.getElementById('joinRoomCodeInput');
    const confirmJoinRoomBtn = document.getElementById('confirmJoinRoomBtn');
    const cancelJoinRoomBtn = document.getElementById('cancelJoinRoomBtn');

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

    const guestNameInput = document.getElementById('guestName');
    const acceptGuestBtn = document.getElementById('acceptGuestBtn');

    const authOptionsContainer = document.getElementById('authOptionsContainer');
    const activeUserContainer = document.getElementById('activeUserContainer');
    const activeUserLabel = document.getElementById('activeUserLabel');

    const myAccountBtn = document.getElementById('myAccountBtn');
    const myAccountPanel = document.getElementById('myAccountPanel');
    const backToMenuBtn = document.getElementById('backToMenuBtn');
    const mainActions = document.getElementById('mainActions');
    const accountDisplayNameInput = document.getElementById('accountDisplayName');
    const saveDisplayNameBtn = document.getElementById('saveDisplayNameBtn');
    const currentPasswordInput = document.getElementById('currentPassword');
    const newPasswordInput = document.getElementById('newPassword');
    const changePasswordBtn = document.getElementById('changePasswordBtn');

    const statGamesPlayed = document.getElementById('statGamesPlayed');
    const statWins = document.getElementById('statWins');
    const statWinStreak = document.getElementById('statWinStreak');

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

    function getGuestUser() {
        const raw = localStorage.getItem(GUEST_USER_KEY);
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
        localStorage.removeItem(GUEST_USER_KEY);
        refreshIdentityUI();
    }

    function saveGuestUser(name) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.setItem(GUEST_USER_KEY, JSON.stringify({
            displayName: name,
            username: `guest_${name}`,
            isGuest: true
        }));
        refreshIdentityUI();
    }

    function clearIdentity() {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.removeItem(GUEST_USER_KEY);
        closeJoinRoomModal();
        toggleAccountView(false);
        refreshIdentityUI();
    }

    function getCurrentIdentity() {
        const authUser = getAuthUser();
        if (authUser) return { ...authUser, isGuest: false };

        const guestUser = getGuestUser();
        if (guestUser) return guestUser;

        return null;
    }

    function toggleAccountView(showAccount) {
        myAccountPanel.style.display = showAccount ? 'block' : 'none';
        if (mainActions) {
            mainActions.style.display = showAccount ? 'none' : 'flex';
        }
    }

    function refreshIdentityUI() {
        const identity = getCurrentIdentity();
        const isLoggedIn = !!identity;

        authStatus.textContent = isLoggedIn
            ? `Sesión iniciada como ${identity.displayName}${identity.isGuest ? ' (invitado)' : ` (@${identity.username})`}`
            : 'No has iniciado sesión.';

        authOptionsContainer.style.display = isLoggedIn ? 'none' : 'block';
        activeUserContainer.style.display = isLoggedIn ? 'block' : 'none';

        if (isLoggedIn) {
            activeUserLabel.textContent = identity.displayName;
            myAccountBtn.style.display = identity.isGuest ? 'none' : 'flex';
        } else {
            activeUserLabel.textContent = '-';
            myAccountBtn.style.display = 'none';
            toggleAccountView(false);
        }
    }

    function switchAuthTab(type) {
        const isLogin = type === 'login';

        showLoginTab.classList.toggle('active', isLogin);
        showRegisterTab.classList.toggle('active', !isLogin);

        loginPanel.classList.toggle('active', isLogin);
        registerPanel.classList.toggle('active', !isLogin);
    }

    function openJoinRoomModal() {
        if (!joinRoomModal) return;
        joinRoomModal.style.display = 'flex';
        if (joinRoomCodeInput) {
            joinRoomCodeInput.value = '';
            joinRoomCodeInput.focus();
        }
    }

    function closeJoinRoomModal() {
        if (!joinRoomModal) return;
        joinRoomModal.style.display = 'none';
        if (confirmJoinRoomBtn) {
            confirmJoinRoomBtn.disabled = false;
            confirmJoinRoomBtn.textContent = 'Unirse';
        }
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

    async function loadMyAccount() {
        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, { method: 'GET' });
            const data = await response.json();

            if (!response.ok || !data.success || !data.account) {
                showError(data.message || 'No se pudo cargar Mi cuenta');
                return;
            }

            const account = data.account;
            accountDisplayNameInput.value = account.displayName || '';
            statGamesPlayed.textContent = String(account.stats?.gamesPlayed || 0);
            statWins.textContent = String(account.stats?.wins || 0);
            statWinStreak.textContent = String(account.stats?.winStreak || 0);
        } catch (error) {
            console.error('Error cargando cuenta:', error);
            showError('Error cargando Mi cuenta');
        }
    }

    async function hydrateSession() {
        const token = getAuthToken();

        if (!token) {
            refreshIdentityUI();
            return;
        }

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/me`, { method: 'GET' });
            if (!response.ok) {
                localStorage.removeItem(AUTH_TOKEN_KEY);
                localStorage.removeItem(AUTH_USER_KEY);
                refreshIdentityUI();
                return;
            }

            const data = await response.json();
            if (data.success && data.user) {
                const normalizedUser = {
                    id: data.user.id,
                    username: data.user.username,
                    displayName: data.user.displayName
                };
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(normalizedUser));
            } else {
                localStorage.removeItem(AUTH_TOKEN_KEY);
                localStorage.removeItem(AUTH_USER_KEY);
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
        } finally {
            refreshIdentityUI();
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

            if (!response.ok || !data.success || !data.token || !data.user) {
                showError(data.message || 'No se pudo iniciar sesión');
                return;
            }

            saveAuth(data.token, data.user);
            loginPasswordInput.value = '';
            showSuccess('Sesión iniciada');
        } catch (error) {
            console.error('Error en login:', error);
            showError('Error de conexión al iniciar sesión');
        } finally {
            setButtonLoading(loginBtn, false, 'Ingresando...', 'Iniciar sesión');
        }
    });

    registerBtn.addEventListener('click', async () => {
        const displayName = registerDisplayNameInput.value.trim();
        const username = registerUsernameInput.value.trim();
        const password = registerPasswordInput.value;

        if (!validateAuthDisplayName(displayName) || !validateCredentials(username, password)) return;

        setButtonLoading(registerBtn, true, 'Creando...', 'Crear usuario');

        try {
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ displayName, username, password })
            });

            const data = await response.json();

            if (!response.ok || !data.success || !data.token || !data.user) {
                showError(data.message || 'No se pudo crear la cuenta');
                return;
            }

            saveAuth(data.token, data.user);
            registerPasswordInput.value = '';
            showSuccess('Cuenta creada correctamente');
        } catch (error) {
            console.error('Error en registro:', error);
            showError('Error de conexión al registrar');
        } finally {
            setButtonLoading(registerBtn, false, 'Creando...', 'Crear usuario');
        }
    });

    acceptGuestBtn.addEventListener('click', () => {
        const guestName = guestNameInput.value.trim();

        if (!validateAuthDisplayName(guestName)) return;

        saveGuestUser(guestName);
        showSuccess(`Entraste como invitado: ${guestName}`);
    });

    myAccountBtn.addEventListener('click', async () => {
        toggleAccountView(true);
        await loadMyAccount();
    });

    backToMenuBtn.addEventListener('click', () => {
        toggleAccountView(false);
    });

    saveDisplayNameBtn.addEventListener('click', async () => {
        const displayName = accountDisplayNameInput.value.trim();
        if (!displayName) {
            showError('Ingresa un nombre visible');
            return;
        }

        setButtonLoading(saveDisplayNameBtn, true, 'Guardando...', 'Guardar nombre');

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, {
                method: 'PATCH',
                body: JSON.stringify({ displayName })
            });

            const data = await response.json();

            if (!response.ok || !data.success || !data.account) {
                showError(data.message || 'No se pudo actualizar el nombre');
                return;
            }

            const currentUser = getAuthUser();
            if (currentUser) {
                const updatedUser = { ...currentUser, displayName: data.account.displayName };
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(updatedUser));
            }
            refreshIdentityUI();
            showSuccess('Nombre visible actualizado');
        } catch (error) {
            console.error('Error actualizando nombre:', error);
            showError('Error actualizando nombre');
        } finally {
            setButtonLoading(saveDisplayNameBtn, false, 'Guardando...', 'Guardar nombre');
        }
    });

    changePasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentPasswordInput.value;
        const newPassword = newPasswordInput.value;

        if (!currentPassword || !newPassword) {
            showError('Completa contraseña actual y nueva');
            return;
        }

        setButtonLoading(changePasswordBtn, true, 'Cambiando...', 'Cambiar contraseña');

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, {
                method: 'PATCH',
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                showError(data.message || 'No se pudo cambiar la contraseña');
                return;
            }

            currentPasswordInput.value = '';
            newPasswordInput.value = '';
            showSuccess('Contraseña actualizada correctamente');
        } catch (error) {
            console.error('Error cambiando contraseña:', error);
            showError('Error cambiando contraseña');
        } finally {
            setButtonLoading(changePasswordBtn, false, 'Cambiando...', 'Cambiar contraseña');
        }
    });

    logoutBtn.addEventListener('click', async () => {
        const token = getAuthToken();
        if (token) {
            try {
                await fetchWithAuth(`${API_URL}/auth/logout`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Error al cerrar sesión:', error);
            }
        }

        clearIdentity();
        showSuccess('Sesión cerrada');
    });

    showLoginTab.addEventListener('click', () => switchAuthTab('login'));
    showRegisterTab.addEventListener('click', () => switchAuthTab('register'));

    createRoomBtn.addEventListener('click', async () => {
        const identity = getCurrentIdentity();
        if (!identity || !identity.displayName) {
            showError('Primero inicia sesión, crea usuario o usa invitado');
            return;
        }

        const playerName = identity.displayName;

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
                sessionStorage.removeItem('isSpectator');
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

    joinRoomBtn.addEventListener('click', () => {
        const identity = getCurrentIdentity();
        if (!identity || !identity.displayName) {
            showError('Primero inicia sesión, crea usuario o usa invitado');
            return;
        }

        openJoinRoomModal();
    });

    confirmJoinRoomBtn.addEventListener('click', async () => {
        const identity = getCurrentIdentity();
        if (!identity || !identity.displayName) {
            showError('Primero inicia sesión, crea usuario o usa invitado');
            return;
        }

        const playerName = identity.displayName;
        const roomCode = joinRoomCodeInput.value.trim();

        if (!validateRoomCode(roomCode)) return;

        setButtonLoading(confirmJoinRoomBtn, true, 'Uniendo...', 'Unirse');

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

                if (data.isSpectator) {
                    sessionStorage.setItem('isSpectator', 'true');
                    window.location.href = 'game.html';
                } else {
                    sessionStorage.removeItem('isSpectator');
                    window.location.href = 'sala.html';
                }
            } else {
                showError(data.message || 'Error al unirse a la sala');
            }
        } catch (error) {
            console.error('Error:', error);
            showError('Error al conectar con el servidor');
        } finally {
            setButtonLoading(confirmJoinRoomBtn, false, 'Uniendo...', 'Unirse');
        }
    });

    cancelJoinRoomBtn.addEventListener('click', closeJoinRoomModal);
    joinRoomBackdrop.addEventListener('click', closeJoinRoomModal);

    joinRoomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmJoinRoomBtn.click();
        }
        if (e.key === 'Escape') {
            closeJoinRoomModal();
        }
    });

    guestNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            acceptGuestBtn.click();
        }
    });

    toggleAccountView(false);
    hydrateSession();
});
