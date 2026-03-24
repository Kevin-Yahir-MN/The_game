(() => {
    function getAvatarEmoji(avatarId) {
        const avatars = window.APP_AVATARS?.AVATARS || [];
        const found = avatars.find((avatar) => avatar.id === avatarId);
        return found ? found.emoji : '';
    }

    function getAvatarMarkup(avatarId, avatarUrl) {
        if (avatarUrl) {
            return `<img class="avatar-img" src="${avatarUrl}" alt="" />`;
        }
        const emoji = getAvatarEmoji(avatarId);
        return emoji
            ? `<span class="avatar-chip" aria-hidden="true">${emoji}</span>`
            : '';
    }

    function renderFriendList({
        container,
        friends,
        showInvite,
        onInvite,
        onSelectFriend,
        isInviteDisabled,
    }) {
        if (!container) return;

        if (!Array.isArray(friends) || friends.length === 0) {
            container.innerHTML = '<li>(sin amigos)</li>';
            return;
        }

        container.innerHTML = friends
            .map((friend) => {
                const disabled = isInviteDisabled
                    ? isInviteDisabled(friend)
                    : false;
                const disabledAttr = disabled ? 'disabled' : '';
                const titleAttr = disabled ? 'title="Ya está en la sala"' : '';
                const inviteBtn = showInvite
                    ? `<button class="invite-friend-btn" ${disabledAttr} ${titleAttr} data-friend-id="${friend.id}" data-friend-name="${friend.displayName}">Invitar</button>`
                    : '';
                const avatarMarkup = getAvatarMarkup(
                    friend.avatarId,
                    friend.avatarUrl
                );
                return `<li data-friend-id="${friend.id}">${avatarMarkup}<span class="friend-name" data-friend-id="${friend.id}">${friend.displayName}</span> ${inviteBtn}</li>`;
            })
            .join('');

        if (showInvite) {
            container
                .querySelectorAll('.invite-friend-btn')
                .forEach((btn) => {
                    btn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        if (typeof onInvite === 'function') {
                            onInvite(btn.dataset.friendId, btn.dataset.friendName);
                        }
                    });
                });
        }

        if (!container.dataset.clickBound) {
            container.addEventListener('click', (event) => {
                const row = event.target.closest('li[data-friend-id]');
                if (!row) return;
                if (typeof onSelectFriend === 'function') {
                    onSelectFriend(row.dataset.friendId);
                }
            });
            container.dataset.clickBound = 'true';
        }
    }

    function createFriendModalController({
        canRemove,
        fetchAccount,
        onRemove,
        onFetchError,
    }) {
        const modal = document.getElementById('friendModal');
        const modalFriendName = document.getElementById('modalFriendName');
        const modalGamesPlayed = document.getElementById('modalGamesPlayed');
        const modalWins = document.getElementById('modalWins');
        const modalWinStreak = document.getElementById('modalWinStreak');
        const modalSpecialMoves = document.getElementById('modalSpecialMoves');
        const removeFriendBtn = document.getElementById('removeFriendBtn');
        const closeFriendModalBtn = document.querySelector(
            '[data-close-friend-modal]'
        );
        const gameAudio = window.GameAudio || null;

        if (!modal) {
            return {
                showFriendModal() { },
                closeFriendModal() { },
            };
        }

        function closeFriendModal() {
            modal.classList.add('hidden');
            delete modal.dataset.currentId;
            if (removeFriendBtn) removeFriendBtn.style.display = '';
        }

        function showFriendModal(friendId, fallbackName) {
            const allowRemove =
                typeof canRemove === 'function' ? canRemove() : !!canRemove;

            if (!allowRemove && removeFriendBtn) {
                removeFriendBtn.style.display = 'none';
            }

            if (typeof fetchAccount === 'function') {
                fetchAccount(friendId)
                    .then((account) => {
                        if (!account) {
                            if (typeof onFetchError === 'function') {
                                onFetchError();
                            }
                            return;
                        }
                        const stats = account.stats || {};
                        const name = account.displayName || fallbackName || 'Amigo';
                        const avatarEmoji = getAvatarEmoji(account.avatarId);
                        modalFriendName.textContent = avatarEmoji
                            ? `${avatarEmoji} ${name}`
                            : name;
                        modalGamesPlayed.textContent =
                            stats.gamesPlayed ?? '-';
                        modalWins.textContent = stats.wins ?? '-';
                        modalWinStreak.textContent = stats.winStreak ?? '-';
                        modalSpecialMoves.textContent =
                            stats.specialMoves ?? '-';
                        modal.classList.remove('hidden');
                        modal.dataset.currentId = friendId;
                    })
                    .catch(() => {
                        modalFriendName.textContent = fallbackName || 'Amigo';
                        modalGamesPlayed.textContent = '-';
                        modalWins.textContent = '-';
                        modalWinStreak.textContent = '-';
                        modalSpecialMoves.textContent = '-';
                        modal.classList.remove('hidden');
                        modal.dataset.currentId = friendId;
                    });
            } else {
                modalFriendName.textContent = fallbackName || 'Amigo';
                modalGamesPlayed.textContent = '-';
                modalWins.textContent = '-';
                modalWinStreak.textContent = '-';
                modalSpecialMoves.textContent = '-';
                modal.classList.remove('hidden');
                modal.dataset.currentId = friendId;
            }
        }

        if (removeFriendBtn) {
            removeFriendBtn.addEventListener('click', () => {
                const fid = modal.dataset.currentId;
                if (!fid || typeof onRemove !== 'function') return;
                onRemove(fid)
                    .then(() => closeFriendModal())
                    .catch(() => { });
            });
        }

        if (closeFriendModalBtn) {
            closeFriendModalBtn.addEventListener('click', closeFriendModal);
            closeFriendModalBtn.addEventListener('click', () => {
                gameAudio?.play('returnbutton');
            });
        }

        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                closeFriendModal();
            }
        });

        return { showFriendModal, closeFriendModal };
    }

    window.FriendsUI = {
        renderFriendList,
        createFriendModalController,
    };
})();







