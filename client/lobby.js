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
    const closeJoinRoomBtn = document.getElementById('closeJoinRoomBtn');

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

    const registerDisplayNameInput = document.getElementById(
        'registerDisplayName'
    );
    const registerUsernameInput = document.getElementById('registerUsername');
    const registerPasswordInput = document.getElementById('registerPassword');

    const guestNameInput = document.getElementById('guestName');
    const acceptGuestBtn = document.getElementById('acceptGuestBtn');

    const authOptionsContainer = document.getElementById(
        'authOptionsContainer'
    );
    const activeUserContainer = document.getElementById('activeUserContainer');
    const activeUserLabel = document.getElementById('activeUserLabel');

    const myAccountBtn = document.getElementById('myAccountBtn');
    const myAccountPanel = document.getElementById('myAccountPanel');
    const backToMenuBtn = document.getElementById('backToMenuBtn');
    const mainActions = document.getElementById('mainActions');
    const accountDisplayNameInput =
        document.getElementById('accountDisplayName');
    const saveDisplayNameBtn = document.getElementById('saveDisplayNameBtn');
    const currentPasswordInput = document.getElementById('currentPassword');
    const newPasswordInput = document.getElementById('newPassword');
    const changePasswordBtn = document.getElementById('changePasswordBtn');

    const statGamesPlayed = document.getElementById('statGamesPlayed');
    const statWins = document.getElementById('statWins');
    const statWinStreak = document.getElementById('statWinStreak');

    // ---- estado y lógica de amigos ----
    let friends = [];
    let lobbyWs = null;

    // modal elements for lobby
    const friendModal = document.getElementById('friendModal');
    const modalFriendName = document.getElementById('modalFriendName');
    const modalGamesPlayed = document.getElementById('modalGamesPlayed');
    const modalWins = document.getElementById('modalWins');
    const modalWinStreak = document.getElementById('modalWinStreak');
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    const closeFriendModalBtn = document.querySelector(
        '[data-close-friend-modal]'
    );

    async function loadFriends() {
        friends = [];
        try {
            const response = await fetchWithAuth(`${API_URL}/friends`, {
                method: 'GET',
            });
            const data = await response.json();
            if (response.ok && data.success) {
                friends = data.friends || [];
            }
        } catch (err) {
            console.error('Error cargando amigos:', err);
        }
        renderFriendList();
    }

    function renderFriendList() {
        const container = document.getElementById('friendList');
        if (!container) return;
        const isMain =
            window.location.pathname === '/' ||
            window.location.pathname.endsWith('index.html');

        if (friends.length === 0) {
            container.innerHTML = '<li>(sin amigos)</li>';
            return;
        }

        if (isMain) {
            // En la pantalla principal NO mostrar botones de invitar
            container.innerHTML = friends
                .map((f) => `<li data-friend-id="${f.id}"><span class="friend-name" data-friend-id="${f.id}">${f.displayName}</span></li>`)
                .join('');

            // allow opening friend modal by clicking the row
            container.querySelectorAll('li[data-friend-id]').forEach((li) => {
                li.addEventListener('click', () => {
                    const fid = li.dataset.friendId;
                    if (fid) showFriendModal(fid);
                });
            });
            return;
        }

        // En otras páginas (ej. sala) mostrar botón de invitar
        container.innerHTML = friends
            .map((f) => {
                const inviteBtn = `<button class="invite-friend-btn" data-friend-id="${f.id}">Invitar</button>`;
                return `<li data-friend-id="${f.id}"><span class="friend-name" data-friend-id="${f.id}">${f.displayName}</span> ${inviteBtn}</li>`;
            })
            .join('');

        // attach click handlers for invite buttons
        container.querySelectorAll('.invite-friend-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const fid = btn.dataset.friendId;
                attemptInvite(fid);
            });
        });

        // event delegation: handle click on any row
        container.querySelectorAll('li[data-friend-id]').forEach((li) => {
            li.addEventListener('click', (e) => {
                const fid = li.dataset.friendId;
                if (fid) showFriendModal(fid);
            });
        });
    }

    // friend modal functions
    function showFriendModal(friendId) {
        // find displayName from local list as fallback
        const friendData = friends.find((f) => String(f.id) === String(friendId));
        const name = friendData ? friendData.displayName : '';

        // attempt to fetch full account info if authenticated
        const identity = getCurrentIdentity();
        if (identity && !identity.isGuest) {
            fetchWithAuth(`${API_URL}/users/${friendId}`)
                .then((resp) => resp.json())
                .then((data) => {
                    if (data.success && data.account) {
                        const stats = data.account.stats || {};
                        modalFriendName.textContent = data.account.displayName;
                        modalGamesPlayed.textContent = stats.gamesPlayed ?? '-';
                        modalWins.textContent = stats.wins ?? '-';
                        modalWinStreak.textContent = stats.winStreak ?? '-';
                        friendModal.classList.remove('hidden');
                        friendModal.dataset.currentId = friendId;
                    } else {
                        showError('No se pudo cargar información del amigo');
                    }
                })
                .catch((err) => {
                    console.error('Error fetching friend info', err);
                    modalFriendName.textContent = name || 'Amigo';
                    modalGamesPlayed.textContent = '-';
                    modalWins.textContent = '-';
                    modalWinStreak.textContent = '-';
                    friendModal.classList.remove('hidden');
                    friendModal.dataset.currentId = friendId;
                });
        } else {
            modalFriendName.textContent = name || 'Amigo';
            modalGamesPlayed.textContent = '-';
            modalWins.textContent = '-';
            modalWinStreak.textContent = '-';
            if (removeFriendBtn) removeFriendBtn.style.display = 'none';
            friendModal.classList.remove('hidden');
            friendModal.dataset.currentId = friendId;
        }
    }

    function closeFriendModal() {
        friendModal.classList.add('hidden');
        delete friendModal.dataset.currentId;
        if (removeFriendBtn) removeFriendBtn.style.display = '';
    }

    if (removeFriendBtn) {
        removeFriendBtn.addEventListener('click', () => {
            const fid = friendModal.dataset.currentId;
            if (!fid) return;
            fetchWithAuth(`${API_URL}/friends/${fid}`, { method: 'DELETE' })
                .then((resp) => resp.json())
                .then((json) => {
                    if (json.success) {
                        showSuccess('Amigo eliminado');
                        closeFriendModal();
                        loadFriends();
                    } else {
                        showError('Error eliminando amigo');
                    }
                })
                .catch((err) => {
                    console.error('Error deleting friend', err);
                    showError('Error eliminando amigo');
                });
        });
    }

    friendModal.addEventListener('click', (e) => {
        if (e.target === friendModal) {
            closeFriendModal();
        }
    });

    if (closeFriendModalBtn) {
        closeFriendModalBtn.addEventListener('click', closeFriendModal);
    }

    function setupLobbyWebSocket() {
        if (lobbyWs) {
            lobbyWs.close();
            lobbyWs = null;
        }
        const identity = getCurrentIdentity();
        if (!identity) return;
        const wsUrl = new URL(API_URL.replace(/^http/, 'ws'));
        wsUrl.searchParams.set('lobby', 'true');
        if (!identity.isGuest && identity.id) {
            // send userId so server can look up display name and map lobby client
            wsUrl.searchParams.set('userId', identity.id);
        } else {
            let lobbyId = sessionStorage.getItem('lobbyId');
            if (!lobbyId) {
                lobbyId = crypto.randomUUID
                    ? crypto.randomUUID()
                    : Math.random().toString(36).substring(2);
                sessionStorage.setItem('lobbyId', lobbyId);
            }
            wsUrl.searchParams.set('lobbyId', lobbyId);
            wsUrl.searchParams.set('displayName', identity.displayName);
        }

        lobbyWs = new WebSocket(wsUrl);
        lobbyWs.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                if (msg.type === 'friend_invite') {
                    displayInvite(msg);
                }
            } catch (e) {
                console.error('WS lobby parse error', e);
            }
        };
        lobbyWs.onopen = () => {
            // re-render so invite buttons become enabled if needed
            renderFriendList();
        };
        lobbyWs.onclose = () => {
            // nothing special
        };
    }

    function attemptInvite(friendId) {
        // Invitar requiere estar dentro de una sala (operación realizada desde sala.js).
        const roomId = sessionStorage.getItem('roomId');
        if (!roomId) {
            showError('Debes estar en una sala para invitar amigos');
            return;
        }
        showError('Invitaciones desde el lobby no están disponibles', true);
    }

    function displayInvite(invite) {
        const existingInvite = document.querySelector('.invite-modal');
        if (existingInvite) {
            existingInvite.remove();
        }

        const modal = document.createElement('div');
        modal.className = 'invite-modal';
        modal.innerHTML = `
            <div class="invite-modal__backdrop"></div>
            <section class="invite-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="inviteModalTitle">
                <div class="invite-modal__badge">Invitacion a partida</div>
                <h3 id="inviteModalTitle">Unete a la sala de ${invite.fromDisplayName}</h3>
                <p class="invite-modal__message">
                    <strong>${invite.fromDisplayName}</strong> quiere que te sumes ahora mismo.
                </p>
                <div class="invite-modal__meta">
                    <span class="invite-modal__room">Sala ${invite.roomId}</span>
                    <span class="invite-modal__timer" data-invite-countdown>Expira en 10s</span>
                </div>
                <div class="invite-modal__progress">
                    <span class="invite-modal__progress-bar" data-invite-progress></span>
                </div>
                <div class="invite-modal__actions">
                    <button type="button" class="invite-modal__button invite-modal__button--primary" data-action="accept">Aceptar</button>
                    <button type="button" class="invite-modal__button invite-modal__button--ghost" data-action="decline">Declinar</button>
                </div>
            </section>
        `;
        document.body.appendChild(modal);

        const remove = () => modal.remove();
        const countdownElement = modal.querySelector('[data-invite-countdown]');
        const progressElement = modal.querySelector('[data-invite-progress]');
        const durationMs = 10000;
        const startedAt = Date.now();

        const countdownInterval = setInterval(() => {
            const elapsed = Date.now() - startedAt;
            const remainingMs = Math.max(durationMs - elapsed, 0);
            const remainingSeconds = Math.ceil(remainingMs / 1000);

            if (countdownElement) {
                countdownElement.textContent = `Expira en ${remainingSeconds}s`;
            }

            if (progressElement) {
                const progress = Math.max(
                    100 - (elapsed / durationMs) * 100,
                    0
                );
                progressElement.style.width = `${progress}%`;
            }

            if (remainingMs <= 0) {
                clearInterval(countdownInterval);
            }
        }, 250);

        const timer = setTimeout(() => {
            clearInterval(countdownInterval);
            remove();
        }, durationMs);

        modal
            .querySelector('[data-action="accept"]')
            .addEventListener('click', async () => {
                clearTimeout(timer);
                clearInterval(countdownInterval);
                remove();
                const identity = getCurrentIdentity();
                if (!identity || !identity.displayName) return;
                try {
                    const response = await fetchWithAuth(`${API_URL}/join-room`, {
                        method: 'POST',
                        body: JSON.stringify({
                            playerName: identity.displayName,
                            roomId: invite.roomId,
                        }),
                    });
                    const data = await response.json();
                    if (response.ok && data.success) {
                        sessionStorage.setItem('playerName', identity.displayName);
                        sessionStorage.setItem('playerId', data.playerId);
                        sessionStorage.setItem('roomId', invite.roomId);
                        sessionStorage.setItem('isHost', 'false');
                        window.location.href = 'sala.html';
                    } else {
                        showError(data.message || 'No se pudo unir a la sala');
                    }
                } catch (e) {
                    console.error('Error al aceptar invitación', e);
                    showError('Error al unirse a la sala');
                }
            });
        modal
            .querySelector('[data-action="decline"]')
            .addEventListener('click', () => {
                clearTimeout(timer);
                clearInterval(countdownInterval);
                remove();
                if (lobbyWs && lobbyWs.readyState === WebSocket.OPEN) {
                    lobbyWs.send(
                        JSON.stringify({
                            type: 'invite_response',
                            inviterPlayerId: invite.inviterPlayerId,
                            accepted: false,
                            roomId: invite.roomId,
                        })
                    );
                }
            });
    }

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
        // Tokens are httpOnly cookies and cannot be read from JS
        return null;
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
        // Token is set in httpOnly cookie by server; we store user for UI
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
        localStorage.removeItem(GUEST_USER_KEY);
        refreshIdentityUI();
    }

    function saveGuestUser(name) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        localStorage.setItem(
            GUEST_USER_KEY,
            JSON.stringify({
                displayName: name,
                username: `guest_${name}`,
                isGuest: true,
            })
        );
        refreshIdentityUI();
    }

    function clearIdentity() {
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

        const friendsContainerEl = document.getElementById('friendsContainer');
        if (friendsContainerEl) {
            friendsContainerEl.style.display = isLoggedIn ? 'block' : 'none';
        }

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
        if (!/^[\p{L}\p{N}_\-\s]{2,24}$/u.test(username.trim())) {
            showError(
                'El usuario debe tener entre 2 y 24 caracteres, solo letras, números, espacios, guiones y guiones bajos'
            );
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
        if (!/^[\p{L}\p{N}_\-\s]{2,24}$/u.test(displayName.trim())) {
            showError(
                'El nombre visible debe tener entre 2 y 24 caracteres, solo letras, números, espacios, guiones y guiones bajos'
            );
            return false;
        }
        return true;
    }

    async function fetchWithAuth(url, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(options.headers || {}),
        };
        // No need to send Authorization header, cookies are sent automatically
        return fetch(url, {
            ...options,
            credentials: 'include', // Ensure cookies are sent
            headers,
        });
    }

    async function loadMyAccount() {
        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, {
                method: 'GET',
            });
            const data = await response.json();

            if (!response.ok || !data.success || !data.account) {
                showError(data.message || 'No se pudo cargar Mi cuenta');
                return;
            }

            const account = data.account;
            accountDisplayNameInput.value = account.displayName || '';
            statGamesPlayed.textContent = String(
                account.stats?.gamesPlayed || 0
            );
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
            // No podemos leer la cookie httpOnly, pero si hay usuario en localStorage
            // reconstruimos la UI desde ahí y abrimos el WS de lobby.
            refreshIdentityUI();
            if (getAuthUser()) {
                await loadFriends();
                setupLobbyWebSocket();
            }
            return;
        }

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/me`, {
                method: 'GET',
            });
            if (!response.ok) {
                localStorage.removeItem(AUTH_TOKEN_KEY);
                localStorage.removeItem(AUTH_USER_KEY);
            } else {
                const data = await response.json();
                if (data.success && data.user) {
                    const normalizedUser = {
                        id: data.user.id,
                        username: data.user.username,
                        displayName: data.user.displayName,
                    };
                    localStorage.setItem(
                        AUTH_USER_KEY,
                        JSON.stringify(normalizedUser)
                    );
                } else {
                    localStorage.removeItem(AUTH_TOKEN_KEY);
                    localStorage.removeItem(AUTH_USER_KEY);
                }
            }
        } catch (error) {
            console.error('Error verificando sesión:', error);
        }

        refreshIdentityUI();
        // siempre intentamos cargar la lista de amigos (API devolverá vacío/401 si no está autenticado)
        await loadFriends();
        // abrir socket sólo si seguimos autenticados
        if (token && getAuthUser()) {
            setupLobbyWebSocket();
        }
    }

    // resto de código sigue abajo

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
                    Accept: 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                showError(data.message || 'No se pudo iniciar sesión');
                return;
            }

            saveAuth(data.token, data.user);
            showSuccess('Sesión iniciada correctamente');
            loginPasswordInput.value = '';
            await loadFriends();
            setupLobbyWebSocket();
        } catch (error) {
            console.error('Error en login:', error);
            showError('Error al conectar con el servidor');
        } finally {
            setButtonLoading(
                loginBtn,
                false,
                'Ingresando...',
                'Iniciar sesión'
            );
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
                    Accept: 'application/json',
                },
                body: JSON.stringify({ username, password, displayName }),
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
            await loadFriends();
            setupLobbyWebSocket();
        } catch (error) {
            console.error('Error en registro:', error);
            showError('Error al conectar con el servidor');
        } finally {
            setButtonLoading(registerBtn, false, 'Creando...', 'Crear usuario');
        }
    });

    acceptGuestBtn.addEventListener('click', () => {
        const guestName = guestNameInput.value.trim();
        if (!guestName) {
            showError('Ingresa un nombre para invitado');
            return;
        }

        saveGuestUser(guestName);
        showSuccess('Usuario temporal creado');
    });

    myAccountBtn.addEventListener('click', async () => {
        const isHidden = myAccountPanel.style.display === 'none';
        if (isHidden) {
            toggleAccountView(true);
            await loadMyAccount();
            return;
        }

        toggleAccountView(false);
    });

    backToMenuBtn.addEventListener('click', () => {
        toggleAccountView(false);
    });

    saveDisplayNameBtn.addEventListener('click', async () => {
        const displayName = accountDisplayNameInput.value.trim();
        if (!displayName) {
            showError('Ingresa un nombre visible válido');
            return;
        }

        setButtonLoading(
            saveDisplayNameBtn,
            true,
            'Guardando...',
            'Guardar nombre'
        );

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, {
                method: 'PATCH',
                body: JSON.stringify({ displayName }),
            });
            const data = await response.json();

            if (!response.ok || !data.success) {
                showError(data.message || 'No se pudo actualizar el nombre');
                return;
            }

            const existingAuth = getAuthUser();
            if (existingAuth) {
                localStorage.setItem(
                    AUTH_USER_KEY,
                    JSON.stringify({
                        ...existingAuth,
                        displayName: data.account.displayName,
                    })
                );
            }

            refreshIdentityUI();
            await loadMyAccount();
            showSuccess('Nombre actualizado');
        } catch (error) {
            console.error('Error actualizando nombre:', error);
            showError('Error actualizando nombre');
        } finally {
            setButtonLoading(
                saveDisplayNameBtn,
                false,
                'Guardando...',
                'Guardar nombre'
            );
        }
    });

    changePasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentPasswordInput.value;
        const newPassword = newPasswordInput.value;

        if (!currentPassword || !newPassword) {
            showError('Completa contraseña actual y nueva');
            return;
        }

        setButtonLoading(
            changePasswordBtn,
            true,
            'Cambiando...',
            'Cambiar contraseña'
        );

        try {
            const response = await fetchWithAuth(`${API_URL}/auth/account`, {
                method: 'PATCH',
                body: JSON.stringify({ currentPassword, newPassword }),
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
            setButtonLoading(
                changePasswordBtn,
                false,
                'Cambiando...',
                'Cambiar contraseña'
            );
        }
    });

    logoutBtn.addEventListener('click', async () => {
        try {
            await fetchWithAuth(`${API_URL}/auth/logout`, {
                method: 'POST',
            });
        } catch (error) {
            console.error('Error al cerrar sesión:', error);
        }

        clearIdentity();
        showSuccess('Sesión cerrada');
        // cerrar socket y limpiar lista amigos
        if (lobbyWs) {
            lobbyWs.close();
            lobbyWs = null;
        }
        friends = [];
        renderFriendList();
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
                body: JSON.stringify({ playerName }),
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
                    roomId: roomCode,
                }),
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
            setButtonLoading(confirmJoinRoomBtn, false, 'Uniendo...', 'Unirse');
        }
    });

    cancelJoinRoomBtn.addEventListener('click', closeJoinRoomModal);
    joinRoomBackdrop.addEventListener('click', closeJoinRoomModal);
    if (closeJoinRoomBtn) {
        closeJoinRoomBtn.addEventListener('click', closeJoinRoomModal);
    }

    joinRoomCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmJoinRoomBtn.click();
        }
        if (e.key === 'Escape') {
            closeJoinRoomModal();
        }
    });

    joinRoomCodeInput.addEventListener('input', () => {
        joinRoomCodeInput.value = joinRoomCodeInput.value.replace(/\D/g, '');
    });

    guestNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            acceptGuestBtn.click();
        }
    });

    toggleAccountView(false);
    hydrateSession();
});
