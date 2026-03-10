// src/services/friendService.js
const { pool, withTransaction } = require('../db');

async function getFriends(userId) {
    if (!userId) return [];
    const result = await pool.query(
        `SELECT u.id, u.username, u.display_name
         FROM friends f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1
         ORDER BY u.display_name ASC`,
        [userId]
    );
    return result.rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.display_name,
    }));
}

async function addFriend(userId, friendId) {
    if (!userId || !friendId) {
        const error = new Error('userId y friendId son obligatorios');
        error.code = 'MISSING_FIELDS';
        throw error;
    }
    if (userId === friendId) {
        const error = new Error('No puedes agregarte como amigo');
        error.code = 'SELF_FRIEND';
        throw error;
    }

    return withTransaction(async (client) => {
        // verificar que el amigo existe
        const exists = await client.query('SELECT 1 FROM users WHERE id = $1', [
            friendId,
        ]);
        if (exists.rowCount === 0) {
            const error = new Error('Usuario no encontrado');
            error.code = 'FRIEND_NOT_FOUND';
            throw error;
        }

        const already = await client.query(
            'SELECT 1 FROM friends WHERE user_id = $1 AND friend_id = $2',
            [userId, friendId]
        );
        if (already.rowCount > 0) {
            const error = new Error(
                'Ese jugador ya está en tu lista de amigos'
            );
            error.code = 'ALREADY_FRIEND';
            throw error;
        }

        await client.query(
            'INSERT INTO friends (user_id, friend_id) VALUES ($1, $2)',
            [userId, friendId]
        );
    });
}

async function removeFriend(userId, friendId) {
    if (!userId || !friendId) {
        const error = new Error('userId y friendId son obligatorios');
        error.code = 'MISSING_FIELDS';
        throw error;
    }

    await pool.query(
        'DELETE FROM friends WHERE user_id = $1 AND friend_id = $2',
        [userId, friendId]
    );
}

module.exports = {
    getFriends,
    addFriend,
    removeFriend,
};
