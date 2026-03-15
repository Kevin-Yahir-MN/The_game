(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.APP_AVATARS = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const AVATARS = [
        { id: 'spark', label: 'Spark', emoji: '✨' },
        { id: 'rocket', label: 'Rocket', emoji: '🚀' },
        { id: 'wizard', label: 'Wizard', emoji: '🧙' },
        { id: 'robot', label: 'Robot', emoji: '🤖' },
        { id: 'fox', label: 'Fox', emoji: '🦊' },
        { id: 'panda', label: 'Panda', emoji: '🐼' },
        { id: 'tiger', label: 'Tiger', emoji: '🐯' },
        { id: 'penguin', label: 'Penguin', emoji: '🐧' },
        { id: 'owl', label: 'Owl', emoji: '🦉' },
        { id: 'dragon', label: 'Dragon', emoji: '🐉' },
        { id: 'ninja', label: 'Ninja', emoji: '🥷' },
    ];
    const DEFAULT_AVATAR_ID = AVATARS[0].id;

    function isValidAvatarId(id) {
        return AVATARS.some((avatar) => avatar.id === id);
    }

    function getAvatarById(id) {
        return AVATARS.find((avatar) => avatar.id === id) || null;
    }

    return {
        AVATARS,
        DEFAULT_AVATAR_ID,
        isValidAvatarId,
        getAvatarById,
    };
});
