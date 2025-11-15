// === সম্পূর্ণ server.js ফাইল (সঠিক) ===

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

// --- মডেল ইম্পোর্ট ---
const User = require('./User');
const Player = require('./Player');
const Team = require('./Team');
const authMiddleware = require('./authMiddleware');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Socket.io সেটআপ ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

// --- গ্লোবাল অকশন স্টেট ---
let playerRegistrationEndTime = null;
let globalAuctionDuration = 30; // <-- নতুন: নিলামের ডিফল্ট সময় (সেকেন্ডে)

const MONGO_URI = "mongodb+srv://auction_admin:auction_admin123@cluster0.tkszoeu.mongodb.net/?appName=Cluster0";
const JWT_SECRET = "your_secret_key_123";

// মিডলওয়্যার
app.use(cors()); 
app.use(express.json());

// --- ডেটাবেস কানেকশন ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((error) => console.error('Error connecting to MongoDB:', error.message));

// --- রিয়েল-টাইম স্ট্যাটাস পাঠানোর ফাংশন ---
async function broadcastStats() {
    try {
        const [totalPlayers, liveAuctions, playersSold, registeredTeams] = await Promise.all([
            Player.countDocuments(),
            Player.countDocuments({ status: 'Ongoing' }),
            Player.countDocuments({ status: 'Sold' }),
            Team.countDocuments()
        ]);
        const stats = { totalPlayers, liveAuctions, playersSold, registeredTeams };
        io.emit('stats_updated', stats); 
    } catch (error) {
        console.error("Error broadcasting stats:", error.message);
    }
}


// --- অকশন গেম লজিক ---
async function sellPlayer(playerId, adminTriggered = false) {
    try {
        const player = await Player.findById(playerId).populate('bids.bidderTeam');
        if (!player || (player.status !== 'Ongoing' && player.status !== 'Pending')) return;
        
        io.emit('timer_update', { player_id: player._id, time: 0 });

        let logMessage = '';
        if (player.bids.length === 0) {
            player.status = 'Unsold';
            logMessage = `${player.playerName} went UNSOLD (Base Price: $${player.basePrice})`;
        } else {
            const lastBid = player.bids[player.bids.length - 1];
            const winningTeamId = lastBid.bidderTeam._id;
            const soldPrice = lastBid.amount;
            const winningTeam = await Team.findById(winningTeamId);

            if (!winningTeam) throw new Error('Winning team not found');
            if (winningTeam.budget < soldPrice && !adminTriggered) {
                throw new Error(`Team ${winningTeam.teamName} has insufficient budget!`);
            }
            if (!adminTriggered) {
                winningTeam.budget -= soldPrice;
            }
            winningTeam.playersOwned.push(playerId);
            await winningTeam.save();

            player.status = 'Sold';
            player.soldTo = winningTeamId;
            player.soldAmount = soldPrice;
            logMessage = `${player.playerName} SOLD to ${winningTeam.teamName} for $${soldPrice}`;
        }

        player.auctionEndTime = null;
        await player.save();

        broadcastStats(); 

        io.emit('players_updated');
        io.emit('teams_updated');
        io.emit('my_players_updated');
        io.emit('auction_log', logMessage);
    } catch (error) {
        console.error("Sell Player Error:", error.message);
        io.emit('auction_log', `Error selling player: ${error.message}`);
    }
}

// --- অকশন টাইমার "গেম লুপ" ---
setInterval(async () => {
    try {
        const ongoingPlayer = await Player.findOne({ status: 'Ongoing' });
        if (ongoingPlayer) {
            const timeLeft = Math.round((new Date(ongoingPlayer.auctionEndTime).getTime() - Date.now()) / 1000);
            if (timeLeft <= 0) {
                await sellPlayer(ongoingPlayer._id);
            } else {
                io.emit('timer_update', { player_id: ongoingPlayer._id, time: timeLeft });
            }
        }

        if (playerRegistrationEndTime) {
            const regTimeLeft = Math.round((playerRegistrationEndTime.getTime() - Date.now()) / 1000);
            if (regTimeLeft > 0) {
                io.emit('reg_timer_update', regTimeLeft);
            } else {
                playerRegistrationEndTime = null;
                io.emit('reg_timer_update', 0);
                io.emit('auction_log', "Player registration window has closed!");
            }
        }
    } catch (error) {
        console.error('Timer Loop Error:', error.message);
    }
}, 1000);

// ---------------------------------
// --- API রুট ---
// ---------------------------------
app.get('/', (req, res) => {
    res.send('Auction Backend Server is running successfully!');
});

app.get('/api/stats', authMiddleware, async (req, res) => {
    try {
        const [totalPlayers, liveAuctions, playersSold, registeredTeams] = await Promise.all([
            Player.countDocuments(),
            Player.countDocuments({ status: 'Ongoing' }),
            Player.countDocuments({ status: 'Sold' }),
            Team.countDocuments()
        ]);
        res.json({ totalPlayers, liveAuctions, playersSold, registeredTeams });
    } catch (error) {
        res.status(500).json({ message: "Error fetching stats." });
    }
});


// --- Auth Routes ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'Username already exists.' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const isFirstUser = (await User.countDocuments()) === 0;
        user = new User({
            username,
            password: hashedPassword,
            role: isFirstUser ? 'Admin' : 'TeamOwner'
        });
        await user.save();
        res.status(201).json({ message: 'Registration successful!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        const payload = {
            user: { id: user.id, username: user.username, role: user.role }
        };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        const team = await Team.findOne({ owner: req.user.id });
        res.json({
            username: user.username,
            role: user.role,
            team: team ? team : null
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// --- Team Routes ---
app.post('/api/teams/create', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied. Admins only.' });
    }
    const { teamName, budget, ownerUsername } = req.body;
    try {
        const owner = await User.findOne({ username: ownerUsername });
        if (!owner) {
            return res.status(404).json({ message: `User '${ownerUsername}' not found.` });
        }
        if (owner.role !== 'TeamOwner') {
             return res.status(400).json({ message: `User '${ownerUsername}' is an Admin, not a TeamOwner.` });
        }
        const existingTeam = await Team.findOne({ owner: owner.id });
        if (existingTeam) {
            return res.status(400).json({ message: `User '${ownerUsername}' already owns team '${existingTeam.teamName}'.` });
        }
        const newTeam = new Team({ teamName, budget, owner: owner.id });
        await newTeam.save();

        broadcastStats();

        owner.team = newTeam._id;
        await owner.save();
        io.emit('teams_updated');
        
        io.emit('users_updated'); 
        
        res.status(201).json({ message: 'Team created and assigned successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.get('/api/teams', authMiddleware, async (req, res) => {
    try {
        const teams = await Team.find().select('teamName budget');
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.get('/api/teams/my-players', authMiddleware, async (req, res) => {
    try {
        const team = await Team.findOne({ owner: req.user.id }).populate('playersOwned');
        if (!team) {
            return res.status(404).json({ message: 'You are not assigned to a team.' });
        }
        const purchasedPlayers = team.playersOwned.filter(p => p.status === 'Sold');
        res.json(purchasedPlayers);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// --- Player Routes ---
app.post('/api/players/create', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    const { playerName, discordUsername, basePrice } = req.body; 
    try {
        const newPlayer = new Player({
            playerName,
            discordUsername,
            basePrice,
            currentPrice: basePrice,
            isSelfRegistered: false
        });

        await newPlayer.save(); 

        broadcastStats(); 
        io.emit('players_updated');
        res.status(201).json({ message: 'Player created successfully.' });

    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find()
            .populate('soldTo', 'teamName')
            .populate('bids.bidderTeam', 'teamName')
            .sort({ status: 1, currentPrice: -1 });
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

app.get('/api/players/available', async (req, res) => {
    try {
        const players = await Player.find({ status: { $in: ['Pending', 'Ongoing'] } })
            .populate('bids.bidderTeam', 'teamName')
            .sort({ status: 1 });
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// --- Auction Control Routes ---
app.post('/api/players/:id/bid', authMiddleware, async (req, res) => {
    if (req.user.role !== 'TeamOwner') {
        return res.status(403).json({ error: 'Only Team Owners can bid.' });
    }
    try {
        const { bidAmount } = req.body;
        const player = await Player.findById(req.params.id);
        const team = await Team.findOne({ owner: req.user.id });

        if (!team) return res.status(404).json({ error: 'Team not found.' });
        if (!player) return res.status(404).json({ error: 'Player not found.' });
        if (player.status !== 'Ongoing') return res.status(400).json({ error: 'This player is not currently up for auction.' });
        
        // === ❗️❗️ নতুন রুলস (আপনার ডিসকর্ড ছবি অনুযায়ী) ===

        // রুল ১: টিম কি ৬ জন প্লেয়ার কিনে ফেলেছে?
        if (team.playersOwned.length >= 6) {
            return res.status(400).json({ error: 'Your team is full (6 players max).' });
        }

        // রুল ২: সর্বোচ্চ বিড ৫০০?
        if (bidAmount > 500) {
            return res.status(400).json({ error: 'Maximum bid cap for a single player is 500 tokens.' });
        }

        // রুল ৩: বিডের অ্যামাউন্ট কি বাজেটের মধ্যে আছে?
        if (team.budget < bidAmount) {
            return res.status(400).json({ error: 'Insufficient budget for this bid.' });
        }
        
        // রুল ৪: মিনিমাম বিড এবং ফিক্সড ইনক্রিমেন্ট ১০?
        const minBidAmount = (player.bids.length === 0) ? player.basePrice : (player.currentPrice + 10);

        if (bidAmount < minBidAmount) {
             return res.status(400).json({ error: `Bid must be at least $${minBidAmount}. (Increment is 10)` });
        }
        
        // রুল ৫: বিডটি কি ১০ এর গুণিতক? (যেমন ২০, ৩০, ৪০)
        if (bidAmount % 10 !== 0) {
            return res.status(400).json({ error: `Bid must be in increments of 10 (e.g., 30, 40, 50...).` });
        }
        // === রুলস চেক করা শেষ ===


        const newBid = {
            bidderTeam: team._id,
            amount: bidAmount,
            timestamp: new Date()
        };
        player.bids.push(newBid);
        player.currentPrice = bidAmount;

        const timeLeft = Math.round((new Date(player.auctionEndTime).getTime() - Date.now()) / 1000);
        
        // (আগের কোড অনুযায়ী ১০ সেকেন্ডে রিসেট)
        if (timeLeft < 10) {
             player.auctionEndTime = new Date(Date.now() + 10 * 1000);
        }

        await player.save();

        io.emit('players_updated');
        io.emit('teams_updated');
        io.emit('auction_log', `BID: ${team.teamName} bids $${bidAmount} for ${player.playerName}`);

        res.json({ message: 'Bid placed successfully!' });

    } catch (error) {
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});


app.post('/api/players/:id/start', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const ongoingPlayer = await Player.findOne({ status: 'Ongoing' });
        if (ongoingPlayer) {
            return res.status(400).json({ message: `Cannot start. ${ongoingPlayer.playerName} is already being auctioned.` });
        }

        const player = await Player.findById(req.params.id);
        
        if (!player || (player.status !== 'Pending' && player.status !== 'Unsold')) {
            return res.status(400).json({ message: 'Player is not ready for auction (must be Pending or Unsold).' });
        }

        player.status = 'Ongoing';
        player.currentPrice = player.basePrice; 
        player.bids = []; 
        
        player.auctionEndTime = new Date(Date.now() + globalAuctionDuration * 1000);
        
        await player.save();

        broadcastStats();

        io.emit('players_updated');
        io.emit('auction_log', `AUCTION STARTED: ${player.playerName} (Base Price: $${player.basePrice})`);

        res.json({ message: 'Auction started!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


app.post('/api/players/:id/sold', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        await sellPlayer(req.params.id, true);
        res.json({ message: 'Player manually sold.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// --- Player Self-Registration Routes ---
app.post('/api/admin/start-player-reg', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    if (playerRegistrationEndTime && playerRegistrationEndTime > new Date()) {
        return res.status(400).json({ message: 'Registration is already ongoing.' });
    }
    playerRegistrationEndTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
    io.emit('reg_timer_update', 24 * 60 * 60);
    io.emit('auction_log', `Admin started Player Registration Window for 24 hours.`);
    res.json({ message: 'Player registration started for 24 hours.' });
});

app.post('/api/players/self-register', async (req, res) => {
    if (!playerRegistrationEndTime || playerRegistrationEndTime <= new Date()) {
        return res.status(400).json({ message: 'Player registration is currently closed.' });
    }
    
    const { playerName, discordUsername, imageUrl } = req.body;
    if (!playerName || !discordUsername) {
        return res.status(400).json({ message: 'Player Name and Discord Username are required.' });
    }
    try {
        const existingPlayer = await Player.findOne({ 
            $or: [
                { playerName: playerName }, 
                { discordUsername: discordUsername }
            ] 
        });

        if (existingPlayer) {
            if (existingPlayer.playerName === playerName) {
                return res.status(400).json({ message: 'This Player Name is already registered.' });
            }
            if (existingPlayer.discordUsername === discordUsername) {
                return res.status(400).json({ message: 'This Discord Username is already registered.' });
            }
        }
        
        const newPlayer = new Player({
            playerName,
            discordUsername,
            isSelfRegistered: true,
            imageUrl: imageUrl || undefined
        });
        await newPlayer.save();
        
        broadcastStats();

        io.emit('players_updated');
        io.emit('auction_log', `${playerName} successfully self-registered (Discord: ${discordUsername}).`);
        res.status(201).json({ message: `${playerName} registered successfully! Awaiting auction.` });
    } catch (error) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});


// ---------------------------------
// --- নতুন রুট: অ্যাডমিন সেটিংস, প্লেয়ার ও টিম ডিলিট ---
// ---------------------------------

// === নতুন: অকশন সেটিংস রুট ===
app.post('/api/admin/settings', authMiddleware, (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    const { duration } = req.body;
    if (duration && !isNaN(duration) && duration > 5) { // কমপক্ষে ৫ সেকেন্ড
        globalAuctionDuration = parseInt(duration, 10);
        console.log(`Auction duration set to: ${globalAuctionDuration} seconds`);
        
        io.emit('auction_log', `Admin updated auction duration to ${globalAuctionDuration} seconds.`);
        
        res.json({ message: `Auction duration updated to ${globalAuctionDuration} seconds.` });
    } else {
        res.status(400).json({ message: 'Invalid duration provided (min 5 seconds).' });
    }
});

// === নতুন: প্লেয়ার ডিলিট রুট ===
app.delete('/api/players/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const player = await Player.findByIdAndDelete(req.params.id);
        if (!player) {
            return res.status(404).json({ message: 'Player not found.' });
        }
        
        io.emit('players_updated');
        broadcastStats(); 
        io.emit('auction_log', `Admin deleted player: ${player.playerName}`);
        
        res.json({ message: 'Player deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// === নতুন: টিম ডিলিট রুট ===
app.delete('/api/teams/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const team = await Team.findByIdAndDelete(req.params.id);
        if (!team) {
            return res.status(404).json({ message: 'Team not found.' });
        }
        
        await User.updateOne({ _id: team.owner }, { $unset: { team: "" } });

        io.emit('teams_updated');
        io.emit('users_updated'); 
        broadcastStats(); 
        io.emit('auction_log', `Admin deleted team: ${team.teamName}`);
        
        res.json({ message: 'Team deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// ---------------------------------
// --- ❗️❗️ নতুন রুট: ইউজার ম্যানেজমেন্ট (অ্যাডমিন) ---
// ---------------------------------

// === নতুন: আন-অ্যাসাইনড টিম ওনারদের লিস্ট ===
app.get('/api/users/unassigned', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const users = await User.find({
            role: 'TeamOwner',
            team: { $exists: false } 
        }).select('username role'); 

        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// === নতুন: ইউজার ডিলিট রুট ===
app.delete('/api/users/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        
        io.emit('users_updated'); 
        io.emit('auction_log', `Admin deleted user: ${user.username}`);
        
        res.json({ message: 'User deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// ---------------------------------
// --- ❗️❗️ নতুন: Audience Public Routes ---
// ---------------------------------

// === নতুন: Public Stats রুট (টোকেন ছাড়া চলবে) ===
app.get('/api/stats-public', async (req, res) => {
    try {
        const [totalPlayers, liveAuctions, playersSold, registeredTeams] = await Promise.all([
            Player.countDocuments(),
            Player.countDocuments({ status: 'Ongoing' }),
            Player.countDocuments({ status: 'Sold' }),
            Team.countDocuments()
        ]);
        res.json({ totalPlayers, liveAuctions, playersSold, registeredTeams });
    } catch (error) {
        res.status(500).json({ message: "Error fetching stats." });
    }
});

// === নতুন: Public Teams রুট (টোকেন ছাড়া চলবে) ===
app.get('/api/teams-public', async (req, res) => {
    try {
        const teams = await Team.find().select('teamName budget');
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


// --- সার্ভার চালু করুন ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.io is listening for connections.');
});
