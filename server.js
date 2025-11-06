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
// --- গ্লোবাল অকশন স্টেট (টাইমার ট্র্যাকিং) ---
let playerRegistrationEndTime = null; 
// ---

const MONGO_URI = "mongodb+srv://auction_admin:auction_admin123@cluster0.tkszoeu.mongodb.net/?appName=Cluster0";
const JWT_SECRET = "your_secret_key_123";

// মিডলওয়্যার
app.use(cors());
app.use(express.json());

// --- ডেটাবেস কানেকশন ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((error) => console.error('Error connecting to MongoDB:', error.message));

// ---------------------------------
// --- অকশন গেম লজিক (অপরিবর্তিত) ---
// ---------------------------------

async function sellPlayer(playerId, adminTriggered = false) {
    // (sellPlayer ফাংশনটি আগের মতোই থাকবে, কোড বড় হওয়ার কারণে এখানে সংক্ষেপে দেখানো হলো)
    try {
        const player = await Player.findById(playerId);
        if (!player || (player.status !== 'Ongoing' && player.status !== 'Pending')) return; 
        let logMessage = '';
        if (player.bids.length === 0) {
            player.status = 'Unsold';
            logMessage = `${player.playerName} went UNSOLD (Base Price: $${player.basePrice})`;
        } else {
            const lastBid = player.bids[player.bids.length - 1];
            const winningTeamId = lastBid.bidderTeam;
            const soldPrice = lastBid.amount;
            const winningTeam = await Team.findById(winningTeamId);
            if (!winningTeam) throw new Error('Winning team not found');
            if (winningTeam.budget < soldPrice && !adminTriggered) throw new Error(`Team ${winningTeam.teamName} has insufficient budget!`);

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

// --- অকশন টাইমার "গেম লুপ" (অপরিবর্তিত) ---
setInterval(async () => {
    try {
        // ১. অকশন টাইমার চেক
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

        // ২. রেজিস্ট্রেশন টাইমার চেক
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

// --- নতুন: রেজিস্ট্রেশন উইন্ডো স্টার্ট API (অ্যাডমিন) ---
app.post('/api/admin/start-player-reg', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    if (playerRegistrationEndTime && playerRegistrationEndTime > new Date()) {
        return res.status(400).json({ message: 'Registration is already ongoing.' });
    }

    playerRegistrationEndTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // ২৪ ঘণ্টা

    io.emit('reg_timer_update', 24 * 60 * 60); 
    io.emit('auction_log', `Admin started Player Registration Window for 24 hours.`);

    res.json({ message: 'Player registration started for 24 hours.' });
});

// --- প্লেয়ার সেল্ফ-রেজিস্ট্রেশন API (আপডেটেড) ---
app.post('/api/players/self-register', async (req, res) => {
    if (!playerRegistrationEndTime || playerRegistrationEndTime <= new Date()) {
        return res.status(400).json({ message: 'Player registration is currently closed.' });
    }

    // --- পরিবর্তন: discordUsername যোগ করা হলো, basePrice সরানো হলো ---
    const { playerName, discordUsername } = req.body;
    if (!playerName || !discordUsername) {
        return res.status(400).json({ message: 'Player Name and Discord Username are required.' });
    }
    // ---

    try {
        const existingPlayer = await Player.findOne({ playerName });
        if (existingPlayer) {
            return res.status(400).json({ message: 'Player name already registered.' });
        }

        // Player.js মডেলে basePrice default: 100 আছে, তাই এখানে BasePrice দেওয়ার দরকার নেই
        const newPlayer = new Player({
            playerName,
            discordUsername, // Discord Username সেভ হবে
            category: 'Unassigned',
            isSelfRegistered: true,
        });
        await newPlayer.save();

        io.emit('players_updated');
        io.emit('auction_log', `${playerName} successfully self-registered (Discord: ${discordUsername}).`);

        res.status(201).json({ message: `${playerName} registered successfully! Awaiting auction.` });

    } catch(error) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// --- বাকি Auth এবং Auction API রুটগুলো এখানে অপরিবর্তিত থাকবে ---
// (Rest of the auth, team, and auction APIs are omitted here for brevity, 
// but they should be in the final server.js file).

// --- সার্ভার চালু করুন ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.io is listening for connections.');
});

// 
// নিম্নলিখিত API গুলোর কোড আগের মতোই থাকবে:
// app.post('/api/register', ...)
// app.post('/api/login', ...)
// app.get('/api/profile', ...)
// app.post('/api/teams/create', ...)
// app.get('/api/teams', ...)
// app.get('/api/teams/my-players', ...)
// app.post('/api/players/create', ...)
// app.get('/api/players', ...)
// app.get('/api/players/available', ...)
// app.post('/api/players/:id/bid', ...)
// app.post('/api/players/:id/sold', ...)
// app.post('/api/players/:id/start', ...)
//
