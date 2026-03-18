(function attachSoundManager(global) {
    const SOUND_FILES = {
        chatmessage: '/assets/sounds/chatmessage.wav',
        draw: '/assets/sounds/draw.wav',
        invitation: '/assets/sounds/invitation.wav',
        myturn: '/assets/sounds/myturn.wav',
        playerenter: '/assets/sounds/playerenter.wav',
        put: '/assets/sounds/put.wav',
        specialmove: '/assets/sounds/specialmove.wav',
    };

    const audioCache = new Map();
    let isEnabled = true;

    function getAudio(soundName) {
        const src = SOUND_FILES[soundName];
        if (!src) {
            return null;
        }

        if (!audioCache.has(soundName)) {
            const audio = new Audio(src);
            audio.preload = 'auto';
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
        setEnabled(nextValue) {
            isEnabled = Boolean(nextValue);
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
    };

    ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
        global.addEventListener(eventName, primeAudio, {
            passive: true,
            once: true,
        });
    });
})(window);
