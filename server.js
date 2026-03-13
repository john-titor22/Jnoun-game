// server.js - WebSocket Server for Railway Deployment
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Game rooms storage
const rooms = new Map();

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function handleMessage(ws, data) {
    const { type, payload } = data;
    
    switch(type) {
        case 'CREATE_ROOM':
            createRoom(ws, payload);
            break;
        case 'JOIN_ROOM':
            joinRoom(ws, payload);
            break;
        case 'START_GAME':
            startGame(payload.roomCode);
            break;
        case 'PLAYER_STATE':
            updatePlayerState(ws, payload);
            break;
        case 'PHASE_CHANGE':
            changePhase(payload.roomCode, payload.phase);
            break;
        case 'POSSESSION':
            handlePossession(payload);
            break;
        default:
            console.log('Unknown message type:', type);
    }
}

function createRoom(ws, payload) {
    const roomCode = generateRoomCode();
    const room = {
        code: roomCode,
        host: payload.playerId,
        players: new Map(),
        jnounCount: payload.jnounCount,
        phase: 'lobby',
        dayNumber: 0,
        possessedPlayers: [],
        gameStarted: false
    };
    
    const player = {
        id: payload.playerId,
        name: payload.playerName,
        ws: ws,
        role: null,
        alive: true,
        isHost: true
    };
    
    room.players.set(player.id, player);
    rooms.set(roomCode, room);
    ws.roomCode = roomCode;
    ws.playerId = payload.playerId;
    
    sendToPlayer(ws, {
        type: 'ROOM_CREATED',
        payload: { roomCode, player }
    });
    
    broadcastToRoom(roomCode, {
        type: 'PLAYER_LIST',
        payload: { players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
        }))}
    });
}

function joinRoom(ws, payload) {
    const room = rooms.get(payload.roomCode);
    
    if (!room) {
        sendToPlayer(ws, {
            type: 'ERROR',
            payload: { message: 'Room not found' }
        });
        return;
    }
    
    if (room.gameStarted) {
        sendToPlayer(ws, {
            type: 'ERROR',
            payload: { message: 'Game already started' }
        });
        return;
    }
    
    const player = {
        id: payload.playerId,
        name: payload.playerName,
        ws: ws,
        role: null,
        alive: true,
        isHost: false
    };
    
    room.players.set(player.id, player);
    ws.roomCode = payload.roomCode;
    ws.playerId = payload.playerId;
    
    sendToPlayer(ws, {
        type: 'ROOM_JOINED',
        payload: { roomCode: room.code, player }
    });
    
    broadcastToRoom(room.code, {
        type: 'PLAYER_LIST',
        payload: { players: Array.from(room.players.values()).map(p => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost
        }))}
    });
}

function startGame(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.gameStarted = true;
    room.dayNumber = 1;
    room.phase = 'day';
    
    // DAY 1: Everyone starts as HUMAN
    const players = Array.from(room.players.values());
    players.forEach(player => {
        player.role = 'human';
        player.alive = true;
    });
    
    // Assign tasks to each player
    const tasks = assignTasks(players);
    
    broadcastToRoom(roomCode, {
        type: 'GAME_START',
        payload: {
            phase: 'day',
            dayNumber: 1,
            message: 'اليوم الأول - الجميع بشر'
        }
    });
    
    // Send individual role info
    players.forEach(player => {
        sendToPlayer(player.ws, {
            type: 'ROLE_ASSIGNED',
            payload: {
                role: 'human',
                tasks: tasks.get(player.id)
            }
        });
    });
    
    // Start day phase timer (2 minutes)
    setTimeout(() => {
        transitionToNight(roomCode);
    }, 120000);
}

function assignTasks(players) {
    const allTasks = [
        { id: 1, name: 'تنظيف الفوانيس - Clean Lanterns', location: 'lantern', duration: 5 },
        { id: 2, name: 'ترتيب الوسائد - Arrange Cushions', location: 'cushion', duration: 5 },
        { id: 3, name: 'تلميع الطاولة - Polish Table', location: 'table', duration: 5 },
        { id: 4, name: 'فحص الأبواب - Check Doors', location: 'door', duration: 5 },
        { id: 5, name: 'إعداد الشاي - Prepare Tea', location: 'table', duration: 7 },
        { id: 6, name: 'ترتيب الزهريات - Arrange Vases', location: 'vase', duration: 5 }
    ];
    
    const taskAssignments = new Map();
    
    players.forEach(player => {
        const shuffled = [...allTasks].sort(() => Math.random() - 0.5);
        taskAssignments.set(player.id, shuffled.slice(0, 3));
    });
    
    return taskAssignments;
}

function transitionToNight(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.phase = 'night';
    
    broadcastToRoom(roomCode, {
        type: 'PHASE_CHANGE',
        payload: {
            phase: 'night',
            message: 'الليل قد حل... عودوا إلى غرفكم'
        }
    });
    
    // Select players to be possessed based on jnounCount
    const humanPlayers = Array.from(room.players.values()).filter(p => p.role === 'human' && p.alive);
    const shuffled = humanPlayers.sort(() => Math.random() - 0.5);
    const toBePossessed = shuffled.slice(0, room.jnounCount);
    
    // Send each player to bedroom
    setTimeout(() => {
        const players = Array.from(room.players.values());
        players.forEach(player => {
            if (toBePossessed.includes(player)) {
                // This player will be possessed
                sendToPlayer(player.ws, {
                    type: 'ENTER_BEDROOM',
                    payload: { willBePossessed: true }
                });
            } else {
                // Safe player
                sendToPlayer(player.ws, {
                    type: 'ENTER_BEDROOM',
                    payload: { willBePossessed: false }
                });
            }
        });
        
        // After bedroom sequence, possess players
        setTimeout(() => {
            possessPlayers(roomCode, toBePossessed);
        }, 30000); // 30 seconds for bedroom sequence
        
    }, 3000);
}

function possessPlayers(roomCode, players) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    players.forEach(player => {
        player.role = 'jnoun';
        room.possessedPlayers.push(player.id);
        
        sendToPlayer(player.ws, {
            type: 'POSSESSED',
            payload: {
                message: 'أنت الآن جني - You are now a Jnoun'
            }
        });
    });
    
    // Transition to next day
    setTimeout(() => {
        startNextDay(roomCode);
    }, 5000);
}

function startNextDay(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.dayNumber++;
    room.phase = 'discussion';
    
    const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
    const jnouns = alivePlayers.filter(p => p.role === 'jnoun');
    const humans = alivePlayers.filter(p => p.role === 'human');
    
    // Check win conditions
    if (jnouns.length === 0) {
        endGame(roomCode, 'humans');
        return;
    }
    
    if (jnouns.length >= humans.length) {
        endGame(roomCode, 'jnouns');
        return;
    }
    
    broadcastToRoom(roomCode, {
        type: 'PHASE_CHANGE',
        payload: {
            phase: 'discussion',
            dayNumber: room.dayNumber,
            message: `اليوم ${room.dayNumber} - المناقشة`
        }
    });
    
    // Discussion phase - 90 seconds
    setTimeout(() => {
        startVoting(roomCode);
    }, 90000);
}

function startVoting(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.phase = 'voting';
    
    const alivePlayers = Array.from(room.players.values())
        .filter(p => p.alive)
        .map(p => ({ id: p.id, name: p.name }));
    
    broadcastToRoom(roomCode, {
        type: 'START_VOTING',
        payload: { players: alivePlayers }
    });
}

function endGame(roomCode, winner) {
    broadcastToRoom(roomCode, {
        type: 'GAME_END',
        payload: {
            winner: winner,
            message: winner === 'humans' ? 'الإنس انتصروا! - Humans Win!' : 'الجن انتصروا! - Jnouns Win!'
        }
    });
    
    // Clean up room after 10 seconds
    setTimeout(() => {
        rooms.delete(roomCode);
    }, 10000);
}

function updatePlayerState(ws, payload) {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    
    const player = room.players.get(ws.playerId);
    if (!player) return;
    
    // Broadcast player position/state to other players
    broadcastToRoom(ws.roomCode, {
        type: 'PLAYER_UPDATE',
        payload: {
            playerId: ws.playerId,
            ...payload
        }
    }, ws);
}

function handleDisconnect(ws) {
    const roomCode = ws.roomCode;
    if (!roomCode) return;
    
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.players.delete(ws.playerId);
    
    if (room.players.size === 0) {
        rooms.delete(roomCode);
    } else {
        broadcastToRoom(roomCode, {
            type: 'PLAYER_LEFT',
            payload: { playerId: ws.playerId }
        });
    }
}

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function sendToPlayer(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

function broadcastToRoom(roomCode, message, excludeWs = null) {
    const room = rooms.get(roomCode);
    if (!room) return;
    
    room.players.forEach(player => {
        if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(message));
        }
    });
}

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
