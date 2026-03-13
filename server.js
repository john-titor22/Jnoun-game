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
        case 'SUBMIT_COMMAND':
            handleCommandSubmit(ws, payload);
            break;
        case 'FOLLOW_COMMAND':
            handleFollowCommand(ws, payload);
            break;
        case 'PLAYER_VOTE':
            handlePlayerVote(ws, payload);
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
        gameStarted: false,
        secretImam: null,
        jnoun: null,
        imamCommand: null,
        jnounCommand: null,
        playerChoices: {},
        votes: {}
    };
    
    const player = {
        id: payload.playerId,
        name: payload.playerName,
        ws: ws,
        role: null,
        alive: true,
        isHost: true,
        protected: false,
        marked: false
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
        isHost: false,
        protected: false,
        marked: false
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
    
    const players = Array.from(room.players.values());
    
    if (players.length < 4) {
        broadcastToRoom(roomCode, {
            type: 'ERROR',
            payload: { message: 'Need at least 4 players' }
        });
        return;
    }
    
    room.gameStarted = true;
    room.dayNumber = 1;
    room.phase = 'gathering';
    
    // DAY 1: Everyone human, but 1 secret Imam (doesn't know yet)
    players.forEach(p => {
        p.role = 'human';
        p.alive = true;
        p.protected = false;
        p.marked = false;
    });
    
    // Select secret Imam (they don't know yet)
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    room.secretImam = shuffled[0];
    room.jnoun = null;
    
    broadcastToRoom(roomCode, {
        type: 'GAME_START',
        payload: {
            phase: 'gathering',
            dayNumber: 1,
            message: 'اليوم الأول - اجتمعوا في الصالون'
        }
    });
    
    // Everyone thinks they're human (including the Imam)
    players.forEach(player => {
        sendToPlayer(player.ws, {
            type: 'ROLE_ASSIGNED',
            payload: {
                role: 'human',
                message: 'أنت إنسان - You are Human (for now...)'
            }
        });
    });
    
    // Day lasts 60 seconds
    setTimeout(() => {
        transitionToNight1(roomCode);
    }, 60000);
}

function transitionToNight1(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'night';
    room.dayNumber = 1;
    
    broadcastToRoom(roomCode, {
        type: 'PHASE_CHANGE',
        payload: {
            phase: 'night',
            message: 'الليل الأول - عودوا للنوم'
        }
    });
    
    const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
    
    alivePlayers.forEach(player => {
        sendToPlayer(player.ws, {
            type: 'ENTER_BEDROOM',
            payload: {}
        });
    });
    
    // After 10 seconds, random player becomes Jnoun
    setTimeout(() => {
        transformRandomPlayerToJnoun(roomCode);
    }, 10000);
}

function transformRandomPlayerToJnoun(roomCode) {
    const room = rooms.get(roomCode);
    
    const alivePlayers = Array.from(room.players.values())
        .filter(p => p.alive && p.id !== room.secretImam.id);
    
    if (alivePlayers.length === 0) return;
    
    const jnoun = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
    
    jnoun.role = 'jnoun';
    room.jnoun = jnoun;
    
    // SEND POSSESSION SEQUENCE TO JNOUN FIRST (before role reveal)
    sendToPlayer(jnoun.ws, {
        type: 'JNOUN_POSSESSION_SEQUENCE',
        payload: {
            message: 'شيء ما يقترب...'
        }
    });
    
    // After possession animation (15 seconds), reveal role
    setTimeout(() => {
        sendToPlayer(jnoun.ws, {
            type: 'TRANSFORMATION',
            payload: {
                role: 'jnoun',
                message: 'أنت الآن جني! - You are now Jnoun! Guide players to darkness to mark them for death.'
            }
        });
    }, 15000);
    
    // Reveal to Imam at same time as Jnoun possession starts
    sendToPlayer(room.secretImam.ws, {
        type: 'TRANSFORMATION',
        payload: {
            role: 'imam',
            message: 'أنت الإمام! - You are the Imam! Guide players to safety to protect them.'
        }
    });
    
    // Update Imam's actual role
    room.secretImam.role = 'imam';
    
    // Wake everyone for Day 2 after possession completes
    setTimeout(() => {
        wakeUpForDay2(roomCode);
    }, 20000);
}

function wakeUpForDay2(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'day';
    room.dayNumber = 2;
    
    // Clear bedroom scene and move to salon
    broadcastToRoom(roomCode, {
        type: 'WAKE_UP',
        payload: {
            phase: 'day',
            dayNumber: 2,
            message: 'اليوم الثاني - Someone among you has changed...',
            location: 'salon'
        }
    });
    
    // Start command phase after players gather
    setTimeout(() => {
        startCommandPhase(roomCode);
    }, 13000);
}

// Command templates for dual commanders
const COMMAND_TEMPLATES = [
    {
        action: 'follow_to_room',
        rooms: ['prayer room', 'salon', 'library', 'kitchen'],
        text: (room) => `Follow me to ${room} for safety`
    },
    {
        action: 'stay_together',
        text: () => `Everyone stay together in the courtyard`
    },
    {
        action: 'avoid_area',
        areas: ['upper floor', 'dark rooms'],
        text: (area) => `Avoid ${area} - it's dangerous`
    },
    {
        action: 'gather_for_prayer',
        text: () => `Gather for prayer in courtyard`
    },
    {
        action: 'close_doors',
        text: () => `Close and lock all bedroom doors`
    }
];

function startCommandPhase(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'commands';
    
    const template = COMMAND_TEMPLATES[Math.floor(Math.random() * COMMAND_TEMPLATES.length)];
    
    // Send command template to both Imam and Jnoun
    sendToPlayer(room.secretImam.ws, {
        type: 'ISSUE_COMMAND',
        payload: {
            template: template,
            role: 'imam',
            message: 'Issue a command to guide players to safety'
        }
    });
    
    sendToPlayer(room.jnoun.ws, {
        type: 'ISSUE_COMMAND',
        payload: {
            template: template,
            role: 'jnoun',
            message: 'Issue a command to lure players to danger'
        }
    });
    
    room.imamCommand = null;
    room.jnounCommand = null;
    
    // Wait 30 seconds for both to submit
    setTimeout(() => {
        broadcastCommands(roomCode);
    }, 30000);
}

function handleCommandSubmit(ws, payload) {
    const { roomCode, commandText, target } = payload;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.get(ws.playerId);
    if (!player) return;
    
    if (player.role === 'imam') {
        room.imamCommand = {
            playerId: player.id,
            playerName: player.name,
            text: commandText,
            target: target,
            type: 'imam'
        };
    } else if (player.role === 'jnoun') {
        room.jnounCommand = {
            playerId: player.id,
            playerName: player.name,
            text: commandText,
            target: target,
            type: 'jnoun'
        };
    }
}

function broadcastCommands(roomCode) {
    const room = rooms.get(roomCode);
    
    const commands = [];
    if (room.imamCommand) commands.push(room.imamCommand);
    if (room.jnounCommand) commands.push(room.jnounCommand);
    
    if (commands.length === 0) {
        // Default commands if none submitted
        commands.push({
            playerId: room.secretImam.id,
            playerName: room.secretImam.name,
            text: 'Follow me'
        });
        commands.push({
            playerId: room.jnoun.id,
            playerName: room.jnoun.name,
            text: 'Follow me'
        });
    }
    
    // Shuffle order so players can't tell which is which
    const shuffled = commands.sort(() => Math.random() - 0.5);
    
    broadcastToRoom(roomCode, {
        type: 'COMMANDS_ANNOUNCED',
        payload: {
            commands: shuffled.map(c => ({
                playerId: c.playerId,
                playerName: c.playerName,
                text: c.text
            }))
        }
    });
    
    room.phase = 'execution';
    room.playerChoices = {};
    
    // 90 seconds to follow a command
    setTimeout(() => {
        evaluateChoices(roomCode);
    }, 90000);
}

function handleFollowCommand(ws, payload) {
    const { roomCode, followingPlayerId } = payload;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.get(ws.playerId);
    if (!player || player.role !== 'human') return;
    
    room.playerChoices[player.id] = followingPlayerId;
}

function evaluateChoices(roomCode) {
    const room = rooms.get(roomCode);
    
    // Determine who followed whom
    room.players.forEach(player => {
        if (!player.alive || player.role !== 'human') return;
        
        const choice = room.playerChoices[player.id];
        
        if (!choice) {
            player.protected = false;
            player.marked = false;
        } else if (choice === room.secretImam.id) {
            // Followed Imam = PROTECTED
            player.protected = true;
            player.marked = false;
        } else if (choice === room.jnoun.id) {
            // Followed Jnoun = MARKED for death
            player.protected = false;
            player.marked = true;
        }
    });
    
    // NO BROADCAST - complete silence after choices
    // Players won't know if they chose correctly until night
    
    setTimeout(() => {
        startDiscussionPhase(roomCode);
    }, 5000);
}

function startDiscussionPhase(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'discussion';
    
    broadcastToRoom(roomCode, {
        type: 'PHASE_CHANGE',
        payload: {
            phase: 'discussion',
            message: 'ناقش من تشك به - 60 seconds to discuss'
        }
    });
    
    setTimeout(() => {
        startVoting(roomCode);
    }, 60000);
}

function startVoting(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'voting';
    room.votes = {};
    
    const alive = Array.from(room.players.values())
        .filter(p => p.alive)
        .map(p => ({ id: p.id, name: p.name }));
    
    broadcastToRoom(roomCode, {
        type: 'START_VOTING',
        payload: { 
            players: alive,
            message: 'Vote to eliminate suspected Jnoun'
        }
    });
    
    setTimeout(() => {
        processVotes(roomCode);
    }, 30000);
}

function handlePlayerVote(ws, payload) {
    const { roomCode, votedForId } = payload;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.get(ws.playerId);
    if (!player || !player.alive) return;
    
    room.votes[player.id] = votedForId;
}

function processVotes(roomCode) {
    const room = rooms.get(roomCode);
    
    const voteCount = {};
    Object.values(room.votes).forEach(votedFor => {
        voteCount[votedFor] = (voteCount[votedFor] || 0) + 1;
    });
    
    let eliminated = null;
    let maxVotes = 0;
    
    Object.entries(voteCount).forEach(([playerId, count]) => {
        if (count > maxVotes) {
            maxVotes = count;
            eliminated = playerId;
        }
    });
    
    if (eliminated) {
        const player = room.players.get(eliminated);
        if (player) player.alive = false;
        
        broadcastToRoom(roomCode, {
            type: 'PLAYER_ELIMINATED',
            payload: {
                playerId: player.id,
                playerName: player.name,
                message: `${player.name} was eliminated`
            }
        });
    }
    
    if (checkWinCondition(roomCode)) return;
    
    setTimeout(() => {
        transitionToNight(roomCode);
    }, 5000);
}

function transitionToNight(roomCode) {
    const room = rooms.get(roomCode);
    room.phase = 'night';
    
    broadcastToRoom(roomCode, {
        type: 'PHASE_CHANGE',
        payload: {
            phase: 'night',
            message: 'الليل - عودوا للنوم'
        }
    });
    
    const alive = Array.from(room.players.values()).filter(p => p.alive);
    
    alive.forEach(player => {
        // ONLY marked players get special message
        if (player.marked) {
            sendToPlayer(player.ws, {
                type: 'ENTER_BEDROOM',
                payload: { 
                    marked: true,
                    message: 'شيء ما يقترب... - Something is coming...'
                }
            });
        } else if (player.protected) {
            sendToPlayer(player.ws, {
                type: 'ENTER_BEDROOM',
                payload: { 
                    protected: true,
                    message: 'تشعر بالأمان - You feel safe'
                }
            });
        } else {
            // Followed nobody or roles (Imam/Jnoun themselves)
            sendToPlayer(player.ws, {
                type: 'ENTER_BEDROOM',
                payload: {}
            });
        }
    });
    
    setTimeout(() => {
        executeNightKill(roomCode);
    }, 15000);
}

function executeNightKill(roomCode) {
    const room = rooms.get(roomCode);
    
    // Jnoun kills ONE marked player (if any)
    const markedPlayers = Array.from(room.players.values())
        .filter(p => p.alive && p.marked && p.role === 'human');
    
    if (markedPlayers.length > 0) {
        const victim = markedPlayers[Math.floor(Math.random() * markedPlayers.length)];
        victim.alive = false;
        
        // Victim gets nightmare chase (they know NOW)
        sendToPlayer(victim.ws, {
            type: 'NIGHTMARE_CHASE',
            payload: { 
                message: 'الجن يطاردك! - You were marked!'
            }
        });
        
        // Other marked players who SURVIVED see a close call
        markedPlayers.forEach(p => {
            if (p.id !== victim.id) {
                sendToPlayer(p.ws, {
                    type: 'CLOSE_CALL',
                    payload: {
                        message: 'لقد نجوت... هذه المرة - You survived... this time'
                    }
                });
            }
        });
        
        setTimeout(() => {
            // NO HINT - players must deduce themselves
            broadcastToRoom(roomCode, {
                type: 'PLAYER_DIED',
                payload: {
                    playerId: victim.id,
                    playerName: victim.name,
                    message: `☠️ ${victim.name} was killed by Jnoun during the night`
                }
            });
            
            // Reset marks and protection
            room.players.forEach(p => {
                p.protected = false;
                p.marked = false;
            });
            
            if (checkWinCondition(roomCode)) return;
            
            // Wake up for next day
            setTimeout(() => {
                const nextDay = room.dayNumber + 1;
                broadcastToRoom(roomCode, {
                    type: 'WAKE_UP',
                    payload: {
                        phase: 'day',
                        dayNumber: nextDay,
                        message: `اليوم ${nextDay}`,
                        location: 'salon'
                    }
                });
                
                room.dayNumber = nextDay;
                
                // Start command phase
                setTimeout(() => {
                    startCommandPhase(roomCode);
                }, 10000);
            }, 3000);
        }, 25000);
        
    } else {
        broadcastToRoom(roomCode, {
            type: 'NIGHT_PEACEFUL',
            payload: {
                message: '✅ الليل مر بسلام - Nobody died'
            }
        });
        
        // Reset marks and protection
        room.players.forEach(p => {
            p.protected = false;
            p.marked = false;
        });
        
        if (checkWinCondition(roomCode)) return;
        
        setTimeout(() => {
            const nextDay = room.dayNumber + 1;
            broadcastToRoom(roomCode, {
                type: 'WAKE_UP',
                payload: {
                    phase: 'day',
                    dayNumber: nextDay,
                    message: `اليوم ${nextDay}`,
                    location: 'salon'
                }
            });
            
            room.dayNumber = nextDay;
            
            setTimeout(() => {
                startCommandPhase(roomCode);
            }, 10000);
        }, 5000);
    }
}

function checkWinCondition(roomCode) {
    const room = rooms.get(roomCode);
    const alive = Array.from(room.players.values()).filter(p => p.alive);
    
    const aliveHumans = alive.filter(p => p.role === 'human');
    const imamAlive = room.secretImam.alive;
    const jnounAlive = room.jnoun.alive;
    
    // Jnoun wins if Imam is dead OR only 2 players left
    if (!imamAlive || alive.length <= 2) {
        endGame(roomCode, 'jnoun', room.jnoun.name, room.secretImam.name);
        return true;
    }
    
    // Imam wins if Jnoun is eliminated
    if (!jnounAlive) {
        endGame(roomCode, 'imam', room.secretImam.name, room.jnoun.name);
        return true;
    }
    
    return false;
}

function endGame(roomCode, winner, winnerName, loserName) {
    const message = winner === 'imam' 
        ? `الإمام انتصر! - Imam (${winnerName}) wins!`
        : `الجن انتصر! - Jnoun (${winnerName}) wins!`;
    
    broadcastToRoom(roomCode, {
        type: 'GAME_END',
        payload: {
            winner,
            message,
            imamName: winnerName,
            jnounName: loserName
        }
    });
    
    setTimeout(() => {
        rooms.delete(roomCode);
    }, 10000);
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
