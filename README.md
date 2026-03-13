# 🌙 Jnoun vs Humans - Multiplayer Horror Game

An immersive Arabic-themed multiplayer horror game where humans complete tasks during the day, and jnouns possess players at night.

## 🎮 Game Features

### Day 1 - Everyone is Human
- All players start as humans
- Complete tasks in the Moroccan house salon
- 2 minutes to complete your assigned tasks
- Work together before nightfall

### Night - Possession Phase
- Players go to their bedrooms
- **Cannot move** - only look around (click + drag)
- Selected players get visited by jnouns
- Creepy door opening sequence
- Jumpscare and possession
- Number of possessed players = jnoun count selected in lobby

### Subsequent Days
- Possessed players now **ARE** jnouns (hidden role)
- Discussion and voting phases
- More players can be possessed each night
- Humans win if they eliminate all jnouns
- Jnouns win if they equal/outnumber humans

## 🚀 Deploy to Railway

### Prerequisites
- Railway account (free tier available)
- Git installed

### Step 1: Prepare Your Files
```bash
# Make sure you have these files:
# - server.js
# - package.json
# - railway.json
# - public/index.html
```

### Step 2: Initialize Git Repository
```bash
git init
git add .
git commit -m "Initial commit - Jnoun vs Humans game"
```

### Step 3: Deploy to Railway

#### Option A: Using Railway CLI (Recommended)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Deploy
railway up
```

#### Option B: Using Railway Dashboard
1. Go to https://railway.app
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Connect your GitHub account
5. Push your code to GitHub:
   ```bash
   # Create GitHub repo first, then:
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```
6. Select your repository in Railway
7. Railway will auto-detect Node.js and deploy

### Step 4: Configure Environment
Railway will automatically:
- Install dependencies from package.json
- Expose your app on a public URL
- Set up WebSocket support
- Handle PORT environment variable

### Step 5: Get Your Game URL
After deployment completes:
1. Click on your deployment in Railway dashboard
2. Go to "Settings" → "Domains"
3. Copy your game URL (e.g., `your-game.up.railway.app`)
4. Share with friends!

## 🎯 How to Play

### Creating a Room
1. Enter your name
2. Select number of jnouns (1-3)
3. Click "Create Room"
4. Share the 6-character room code with friends

### Joining a Room
1. Enter your name
2. Click "Join Room"
3. Enter the room code
4. Wait for host to start

### Gameplay Controls
- **Click + Drag Mouse** - Look around
- **WASD / Arrow Keys** - Move (when allowed)
- **Shift** - Sprint
- **E** - Interact with tasks

### Game Phases

#### Day Phase (2 minutes)
- Move around the Moroccan house
- Find glowing green task markers
- Press E near markers to complete tasks
- Complete all 3 assigned tasks

#### Night Phase
- **In Bedroom**: Cannot move, only look around
- Watch the door slowly open
- If selected for possession:
  - Jnoun appears in doorway
  - Slowly approaches your bed
  - Jumpscare
  - You become a jnoun (secret)

#### Discussion Phase (90 seconds)
- Talk with other players
- Discuss suspicious behavior
- Jnouns pretend to be human

#### Voting Phase
- Vote to eliminate a player
- Most votes = eliminated
- Player's role revealed after elimination

## 🛠️ Technical Details

### WebSocket Events
- `CREATE_ROOM` - Host creates a new game room
- `JOIN_ROOM` - Player joins existing room
- `START_GAME` - Host starts the game
- `PHASE_CHANGE` - Server broadcasts phase transitions
- `POSSESSION` - Server handles jnoun possession
- `GAME_END` - Victory condition met

### Game State
Server maintains:
- Room codes and player lists
- Day/night cycles
- Possession tracking
- Role assignments
- Win condition checking

## 📝 Local Development

```bash
# Install dependencies
npm install

# Run server
npm start

# Development with auto-reload
npm run dev
```

Server runs on `http://localhost:3000`

## 🎨 Customization

### Adjust Game Timings
In `server.js`:
```javascript
// Day phase duration (default: 2 minutes)
setTimeout(() => transitionToNight(roomCode), 120000);

// Discussion phase (default: 90 seconds)
setTimeout(() => startVoting(roomCode), 90000);
```

### Change Jnoun Count
In `public/index.html`, modify:
```html
<select id="jnounCount">
    <option value="1">1 Jnoun</option>
    <option value="2">2 Jnouns</option>
    <option value="3">3 Jnouns</option>
    <option value="4">4 Jnouns</option> <!-- Add more -->
</select>
```

## 🐛 Troubleshooting

### Players can't connect
- Check Railway logs for errors
- Ensure WebSocket port is open
- Verify public URL is correct

### Game doesn't start
- Need minimum 3 players
- Only host can start game
- Check browser console for errors

### Connection lost
- Railway free tier may sleep after inactivity
- Refresh page to reconnect
- Check Railway dashboard for deployment status

## 📄 License
MIT

## 🤝 Contributing
Pull requests welcome!

---

**Made with ❤️ for Arabic horror gaming**
