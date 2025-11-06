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
const PORT = 3000;

// --- Socket.io সেটআপ ---
const server = http.createServer(app); 
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
// --- সেটআপ শেষ ---

// --- আপনার দেওয়া URI এবং Secret ---
const MONGO_URI = "mongodb+srv://auction_admin:auction_admin123@cluster0.tkszoeu.mongodb.net/?appName=Cluster0";
const JWT_SECRET = "your_secret_key_123";
// ---

// মিডলওয়্যার
app.use(cors());
app.use(express.json());

// --- ডেটাবেস কানেকশন ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((error) => console.error('Error connecting to MongoDB:', error.message));

// ---------------------------------
// --- অকশন গেম লজিক (নতুন) ---
// ---------------------------------

// --- প্লেয়ার বিক্রি করার মূল ফাংশন ---
async function sellPlayer(playerId, adminTriggered = false) {
    try {
        const player = await Player.findById(playerId);
        if (!player || (player.status !== 'Ongoing' && player.status !== 'Pending')) {
            return; 
        }

        let logMessage = '';
        if (player.bids.length === 0) {
            player.status = 'Unsold';
            logMessage = `${player.playerName} went UNSOLD (Base Price: $${player.basePrice})`;
        } else {
            const lastBid = player.bids[player.bids.length - 1];
            const winningTeamId = lastBid.bidderTeam;
            const soldPrice = lastBid.amount;

            const winningTeam = await Team.findById(winningTeamId);

            if (!winningTeam) {
                throw new Error('Winning team not found');
            }
            if (winningTeam.budget < soldPrice && !adminTriggered) {
                throw new Error(`Team ${winningTeam.teamName} has insufficient budget!`);
            }

            winningTeam.budget -= soldPrice;
            winningTeam.playersOwned.push(playerId);
            await winningTeam.save();

            player.status = 'Sold';
            player.soldTo = winningTeamId;
            player.soldAmount = soldPrice;

            logMessage = `${player.playerName} SOLD to ${winningTeam.teamName} for $${soldPrice}`;
        }

        player.auctionEndTime = null; 
        await player.save();

        io.emit('players_updated'); 
        io.emit('teams_updated');   
        io.emit('my_players_updated'); 
        io.emit('auction_log', logMessage); 

    } catch (error) {
        console.error("Sell Player Error:", error.message);
        io.emit('auction_log', `Error selling player: ${error.message}`);
    }
}

// --- অকশন টাইমার "গেম লুপ" (প্রতি সেকেন্ডে চলবে) ---
setInterval(async () => {
    try {
        const ongoingPlayer = await Player.findOne({ status: 'Ongoing' });

        if (ongoingPlayer) {
            const timeLeft = Math.round((new Date(ongoingPlayer.auctionEndTime).getTime() - Date.now()) / 1000);

            if (timeLeft <= 0) {
                io.emit('timer_update', { player_id: ongoingPlayer._id, time: 0 }); 
                await sellPlayer(ongoingPlayer._id);
            } else {
                io.emit('timer_update', { player_id: ongoingPlayer._id, time: timeLeft });
            }
        }
    } catch (error) {
        console.error('Timer Loop Error:', error.message);
    }
}, 1000); // প্রতি 1 সেকেন্ড

// ---------------------------------
// --- API রুট ---
// ---------------------------------

// Auth API রুট
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ message: 'Username already exists' });
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Invalid username or password' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Invalid username or password' });
        const payload = { user: { id: user.id, username: user.username, role: user.role } };
        jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }, (err, token) => {
            if (err) throw err;
            res.json({ message: "Login successful!", token: token });
        });
    } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) { res.status(500).send('Server Error'); }
});

// Team API রুট
app.post('/api/teams/create', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Access denied.' });
        const { teamName, budget, ownerUsername } = req.body;
        const owner = await User.findOne({ username: ownerUsername });
        if (!owner) return res.status(404).json({ message: `User '${ownerUsername}' not found` });
        if (owner.role !== 'TeamOwner') return res.status(400).json({ message: 'This user is an Admin' });
        if (owner.team) return res.status(400).json({ message: 'This user already owns a team' });
        const existingTeam = await Team.findOne({ teamName });
        if (existingTeam) return res.status(400).json({ message: 'Team name already taken' });
        const newTeam = new Team({ teamName, budget, owner: owner._id });
        await newTeam.save();
        owner.team = newTeam._id;
        await owner.save();
        io.emit('teams_updated');
        res.status(201).json({ message: 'Team created successfully!', team: newTeam });
    } catch (error) { res.status(500).json({ message: 'Server error creating team' }); }
});
app.get('/api/teams', authMiddleware, async (req, res) => {
    try {
        const teams = await Team.find().select('teamName budget');
        res.json(teams);
    } catch (error) { res.status(500).json({ message: 'Server error fetching teams' }); }
});
app.get('/api/teams/my-players', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || !user.team) return res.status(404).json({ message: 'You do not own a team' });
        const teamId = user.team;
        const myPlayers = await Player.find({ soldTo: teamId });
        res.json(myPlayers || []);
    } catch (error) { res.status(500).json({ message: 'Server error fetching players' }); }
});

// প্লেয়ার (Player) API রুট
app.post('/api/players/create', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Access denied.' });
        const { playerName, category, basePrice } = req.body;
        const newPlayer = new Player({
            playerName, category, basePrice,
            currentPrice: basePrice, createdBy: req.user.id
        });
        await newPlayer.save();
        io.emit('players_updated');
        res.status(201).json({ message: 'Player created successfully!', player: newPlayer });
    } catch (error) { res.status(500).json({ message: 'Server error creating player' }); }
});

// সব প্লেয়ার দেখুন (অ্যাডমিনের জন্য)
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find()
            .populate({ path: 'bids.bidderTeam', select: 'teamName' })
            .populate('soldTo', 'teamName')
            .sort({ createdAt: -1 });
        res.json(players);
    } catch (error) { res.status(500).json({ message: 'Server error fetching players' }); }
});

// Available প্লেয়ারদের দেখুন (টিমের জন্য)
app.get('/api/players/available', async (req, res) => {
    try {
        const players = await Player.find({
            status: { $in: ['Pending', 'Ongoing'] } 
        })
            .populate({ path: 'bids.bidderTeam', select: 'teamName' })
            .sort({ createdAt: -1 });
        res.json(players);
    } catch (error) { res.status(500).json({ message: 'Server error fetching available players' }); }
});

// Bid on a Player
app.post('/api/players/:id/bid', authMiddleware, async (req, res) => {
    try {
        const { bidAmount } = req.body;
        const playerId = req.params.id;
        const userId = req.user.id;
        const user = await User.findById(userId);
        if (!user || !user.team) return res.status(400).json({ message: 'You must own a team to bid.' });

        const team = await Team.findById(user.team);
        if (team.budget < bidAmount) return res.status(400).json({ message: 'Insufficient budget for this bid' });

        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ message: 'Player not found' });

        if (player.status !== 'Ongoing') return res.status(400).json({ message: 'Bidding for this player is not active' });

        if (new Date() > new Date(player.auctionEndTime)) return res.status(400).json({ message: 'Time for bidding has expired' });

        if (bidAmount <= player.currentPrice) return res.status(400).json({ message: 'Bid must be higher than the current price' });

        const newBid = { bidderTeam: team._id, amount: bidAmount, timestamp: new Date() };
        player.bids.push(newBid);
        player.currentPrice = bidAmount;

        player.auctionEndTime = new Date(Date.now() + 10 * 1000); // ১০ সেকেন্ড টাইমার রিসেট
        await player.save();

        io.emit('players_updated');
        io.emit('auction_log', `${team.teamName} bid $${bidAmount} for ${player.playerName}`);
        io.emit('timer_update', { player_id: player._id, time: 10 }); 

        res.json({ message: 'Bid placed successfully!', player: player });
    } catch (error) { res.status(500).json({ message: 'Server error placing bid' }); }
});

// Sell a Player
app.post('/api/players/:id/sold', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Access denied.' });

        const playerId = req.params.id;
        const player = await Player.findById(playerId);

        if (!player || player.status !== 'Ongoing') return res.status(400).json({ message: 'Player is not in an ongoing auction' });

        await sellPlayer(playerId, true); // ম্যানুয়ালি সোল্ড

        res.json({ message: 'Player manually sold!' });
    } catch (error) { res.status(500).json({ message: 'Server error selling player' }); }
});

// Start Auction
app.post('/api/players/:id/start', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'Admin') return res.status(403).json({ message: 'Access denied.' });

        const alreadyOngoing = await Player.findOne({ status: 'Ongoing' });
        if (alreadyOngoing) {
            return res.status(400).json({ message: `Auction for ${alreadyOngoing.playerName} is already in progress!` });
        }

        const playerId = req.params.id;
        const player = await Player.findById(playerId);
        if (!player) return res.status(404).json({ message: 'Player not found' });
        if (player.status !== 'Pending') return res.status(400).json({ message: 'Auction already active or finished' });

        player.status = 'Ongoing';
        player.auctionEndTime = new Date(Date.now() + 60 * 1000); // ৬০ সেকেন্ড
        await player.save();

        const logMessage = `Admin started bidding for ${player.playerName} (Base Price: $${player.basePrice})`;
        io.emit('players_updated'); 
        io.emit('auction_log', logMessage);

        res.json({ message: 'Auction started!', player: player });
    } catch (error) { res.status(500).json({ message: 'Server error starting auction' }); }
});


// --- Socket.io কানেকশন লজিক ---
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// --- সার্ভার চালু করুন ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.io is listening for connections.');
});
