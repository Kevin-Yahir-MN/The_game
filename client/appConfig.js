(() => {
    const { protocol, host, origin } = window.location;
    const wsOrigin = `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`;

    window.APP_CONFIG = {
        API_URL: origin,
        WS_URL: wsOrigin,
        PROD_API_URL: 'https://the-game-2xks.onrender.com',
        PROD_WS_URL: 'wss://the-game-2xks.onrender.com',
        REACTION_ICON_BASE_URL: `${origin}/assets/reactions`,
    };
})();
