const sequelize = require('../config/database');
const { DataTypes } = require('sequelize');

const Room = sequelize.define('Room', {
    roomId: {
        type: DataTypes.STRING(4),
        primaryKey: true,
        allowNull: false
    },
    lastActivity: {
        type: DataTypes.DATE,
        allowNull: false
    }
});

const Player = sequelize.define('Player', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    isHost: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    cards: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: []
    },
    lastActivity: {
        type: DataTypes.DATE,
        allowNull: false
    }
});

const GameState = sequelize.define('GameState', {
    deck: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false
    },
    board: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    currentTurn: {
        type: DataTypes.UUID,
        allowNull: false
    },
    gameStarted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    initialCards: {
        type: DataTypes.INTEGER,
        defaultValue: 6
    }
});

const BoardHistory = sequelize.define('BoardHistory', {
    ascending1: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [1]
    },
    ascending2: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [1]
    },
    descending1: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [100]
    },
    descending2: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        defaultValue: [100]
    }
});

// Relaciones
Room.hasMany(Player);
Player.belongsTo(Room);

Room.hasOne(GameState);
GameState.belongsTo(Room);

Room.hasOne(BoardHistory);
BoardHistory.belongsTo(Room);

module.exports = {
    Room,
    Player,
    GameState,
    BoardHistory,
    sequelize
};