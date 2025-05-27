// game/game-index.js
import { GameCore } from './game-core.js';
import { GameNetwork } from './game-network.js';
import { GameUI } from './game-ui.js';
import { GameInput } from './game-input.js';

// Hacer disponibles globalmente para game-main.js
window.GameCore = GameCore;
window.GameNetwork = GameNetwork;
window.GameUI = GameUI;
window.GameInput = GameInput;