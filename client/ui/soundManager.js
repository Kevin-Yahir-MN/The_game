(function attachSoundManager(global) {
    const SOUND_FILES = {
        chatmessage: '/assets/sounds/chatmessage.mp3',
        draw: '/assets/sounds/draw.mp3',
        error: '/assets/sounds/error.mp3',
        gameover: '/assets/sounds/gameover.mp3',
        invitation: '/assets/sounds/invitation.mp3',
        menubutton: '/assets/sounds/menubutton.mp3',
        myturn: '/assets/sounds/myturn.mp3',
        playerenter: '/assets/sounds/playerenter.mp3',
        put: '/assets/sounds/put.mp3',
        returnbutton: '/assets/sounds/returnbutton.mp3',
        specialmove: '/assets/sounds/specialmove.mp3',
        startbutton: '/assets/sounds/startbutton.mp3',
        win: '/assets/sounds/win.mp3',
    };
    const SOUND_VOLUMES = {
        gameover: 0.55,
        specialmove: 0.55,
        win: 0.55,
    };
    const AUDIO_ENABLED_STORAGE_KEY = 'game_audio_enabled';

    const audioCache = new Map();
    let isEnabled = readStoredEnabledState();

    function readStoredEnabledState() {
        try {
            return global.localStorage.getItem(AUDIO_ENABLED_STORAGE_KEY) !== 'false';
        } catch {
            return true;
        }
    }

    function persistEnabledState() {
        try {
            global.localStorage.setItem(
                AUDIO_ENABLED_STORAGE_KEY,
                isEnabled ? 'true' : 'false'
            );
        } catch {
            // ignore storage failures and keep runtime state only
        }
    }

    function getAudio(soundName) {
        const src = SOUND_FILES[soundName];
        if (!src) {
            return null;
        }

        if (!audioCache.has(soundName)) {
            const audio = new Audio(src);
            audio.preload = 'auto';
            audio.volume = SOUND_VOLUMES[soundName] ?? 1;
            audioCache.set(soundName, audio);
        }

        return audioCache.get(soundName);
    }

    function primeAudio() {
        Object.keys(SOUND_FILES).forEach((soundName) => {
            const audio = getAudio(soundName);
            audio?.load();
        });
    }

    function ensureMuteButtonStyles() {
        if (document.getElementById('game-audio-toggle-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'game-audio-toggle-styles';
        style.textContent = `
            .game-audio-toggle {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 1200;
                min-width: 52px;
                height: 52px;
                border: 0;
                border-radius: 999px;
                padding: 0 16px;
                background: rgba(17, 24, 39, 0.9);
                color: #fff;
                box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22);
                backdrop-filter: blur(8px);
                cursor: pointer;
                font: 700 14px/1 'Poppins', sans-serif;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                transition: transform 0.16s ease, background-color 0.16s ease, box-shadow 0.16s ease;
            }

            .game-audio-toggle:hover {
                transform: translateY(-2px);
                box-shadow: 0 16px 28px rgba(0, 0, 0, 0.26);
            }

            .game-audio-toggle:active {
                transform: translateY(0);
            }

            .game-audio-toggle.is-muted {
                background: rgba(127, 29, 29, 0.92);
            }

            .game-audio-toggle__icon {
                font-size: 18px;
                line-height: 1;
            }

            .game-audio-toggle__label {
                white-space: nowrap;
            }

            @media (max-width: 640px) {
                .game-audio-toggle {
                    right: 14px;
                    bottom: 14px;
                    min-width: 48px;
                    height: 48px;
                    padding: 0 14px;
                }

                .game-audio-toggle__label {
                    display: none;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function updateMuteButton(button) {
        if (!button) {
            return;
        }

        button.classList.toggle('is-muted', !isEnabled);
        button.setAttribute(
            'aria-label',
            isEnabled ? 'Silenciar sonido' : 'Activar sonido'
        );
        button.title = isEnabled ? 'Silenciar sonido' : 'Activar sonido';
        button.innerHTML = `
            <span class="game-audio-toggle__icon" aria-hidden="true">${isEnabled ? '🔊' : '🔇'
            }</span>
            <span class="game-audio-toggle__label">${isEnabled ? 'Sonido' : 'Mute'
            }</span>
        `;
    }

    function ensureMuteButton() {
        if (!document.body) {
            return;
        }

        ensureMuteButtonStyles();

        let button = document.getElementById('gameAudioToggle');
        if (!button) {
            button = document.createElement('button');
            button.id = 'gameAudioToggle';
            button.type = 'button';
            button.className = 'game-audio-toggle';
            button.addEventListener('click', () => {
                isEnabled = !isEnabled;
                persistEnabledState();
                updateMuteButton(button);
            });
            document.body.appendChild(button);
        }

        updateMuteButton(button);
    }

    global.GameAudio = {
        play(soundName) {
            if (!isEnabled) {
                return false;
            }

            const baseAudio = getAudio(soundName);
            if (!baseAudio) {
                return false;
            }

            const audioInstance = baseAudio.cloneNode(true);
            audioInstance.volume = baseAudio.volume || 1;
            audioInstance.currentTime = 0;
            audioInstance.play().catch(() => null);
            return true;
        },
        playAndWait(soundName) {
            return new Promise((resolve) => {
                if (!isEnabled) {
                    resolve(false);
                    return;
                }

                const baseAudio = getAudio(soundName);
                if (!baseAudio) {
                    resolve(false);
                    return;
                }

                const audioInstance = baseAudio.cloneNode(true);
                audioInstance.volume = baseAudio.volume || 1;
                audioInstance.currentTime = 0;

                const finish = () => resolve(true);
                audioInstance.addEventListener('ended', finish, {
                    once: true,
                });
                audioInstance.addEventListener(
                    'error',
                    () => resolve(false),
                    {
                        once: true,
                    }
                );

                audioInstance.play().catch(() => resolve(false));
            });
        },
        setEnabled(nextValue) {
            isEnabled = Boolean(nextValue);
            persistEnabledState();
            updateMuteButton(document.getElementById('gameAudioToggle'));
        },
        setVolume(soundName, volume) {
            const audio = getAudio(soundName);
            if (!audio) {
                return false;
            }

            audio.volume = Math.min(Math.max(Number(volume) || 0, 0), 1);
            return true;
        },
        preload() {
            primeAudio();
        },
        unlock() {
            primeAudio();
        },
        mountControls() {
            ensureMuteButton();
        },
    };

    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        global.addEventListener(eventName, primeAudio, {
            passive: true,
            once: true,
        });
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureMuteButton, {
            once: true,
        });
    } else {
        ensureMuteButton();
    }
})(window);











