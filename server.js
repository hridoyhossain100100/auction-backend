const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // 'bcryptjs' ব্যবহার করা হচ্ছে
const jwt = require('jsonwebtoken');
const http = require('http');
const { Server } = require('socket.io');

// --- মডেল ইম্পোর্ট ---
const User = require('./User');
const Player = require('./Player');
const Team = require('./Team');
const authMiddleware = require('./authMiddleware');

const app = express();
const PORT = 3000; // আপনি Render-এ এটি পরিবর্তন করতে পারেন

// --- Socket.io সেটআপ ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});
// --- গ্লোবাল অকশন স্টেট (টাইমার ট্র্যাকিং) ---
let playerRegistrationEndTime = null;
// ---

// --- সমাধান: URI এবং SECRET সরাসরি হার্ডকোড করা হলো ---
const MONGO_URI = "mongodb+srv://auction_admin:auction_admin123@cluster0.tkszoeu.mongodb.net/?appName=Cluster0";
const JWT_SECRET = "your_secret_key_123"; // এই কী-টি authMiddleware.js-এর সাথে মিলতে হবে

// মিডলওয়্যার
app.use(cors()); // Express API-এর জন্য CORS
app.use(express.json());

// --- ডেটাবেস কানেকশন ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('Successfully connected to MongoDB Atlas!'))
    .catch((error) => console.error('Error connecting to MongoDB:', error.message));

// ---------------------------------
// --- অকশন গেম লজিক (আপনার কোড) ---
// ---------------------------------

async function sellPlayer(playerId, adminTriggered = false) {
    try {
        const player = await Player.findById(playerId).populate('bids.bidderTeam');
        if (!player || (player.status !== 'Ongoing' && player.status !== 'Pending')) return;
        
        // টাইমার বন্ধ করুন
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

        io.emit('players_updated');
        io.emit('teams_updated');
        io.emit('my_players_updated');
        io.emit('auction_log', logMessage);

    } catch (error) {
        console.error("Sell Player Error:", error.message);
        io.emit('auction_log', `Error selling player: ${error.message}`);
    }
}

// --- অকশন টাইমার "গেম লুপ" (আপনার কোড) ---
setInterval(async () => {
    try {
        // ১. অকশন টাইমার চেক
        const ongoingPlayer = await Player.findOne({ status: 'Ongoing' });

        if (ongoingPlayer) {
            const timeLeft = Math.round((new Date(ongoingPlayer.auctionEndTime).getTime() - Date.now()) / 1000);

            if (timeLeft <= 0) {
                // সময় শেষ, প্লেয়ার বিক্রি করুন
                await sellPlayer(ongoingPlayer._id);
            } else {
                // সময় আপডেট করুন
                io.emit('timer_update', { player_id: ongoingPlayer._id, time: timeLeft });
            }
        }

        // ২. রেজিস্ট্রেশন টাইমার চেক (আপনার কোড)
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
// --- API রুট (সমাধান করা) ---
// ---------------------------------

// রুট: টেস্ট রুট (সার্ভার চলছে কিনা দেখার জন্য)
app.get('/', (req, res) => {
    res.send('Auction Backend Server is running successfully!');
});

// --- Auth Routes (login.js-এর জন্য) ---

// রুট: ইউজার রেজিস্ট্রেশন
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        let user = await User.findOne({ username });
        if (user) {
            return res.status(400).json({ message: 'Username already exists.' });
        }
        // পাসওয়ার্ড হ্যাশ করুন
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // অ্যাডমিন তৈরি করার একটি বেসিক লজিক (প্রথম ইউজারকে অ্যাডমিন বানানো)
        const isFirstUser = (await User.countDocuments()) === 0;
        
        user = new User({
            username,
            password: hashedPassword,
            role: isFirstUser ? 'Admin' : 'TeamOwner' // প্রথম ইউজার অ্যাডমিন, বাকিরা টিমওনার
        });
        await user.save();
        res.status(201).json({ message: 'Registration successful!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: ইউজার লগইন
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        // পাসওয়ার্ড চেক
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials.' });
        }
        // JWT টোকেন তৈরি
        const payload = {
            user: {
                id: user.id,
                username: user.username,
                role: user.role
            }
        };
        // JWT_SECRET ব্যবহার করা হলো
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: ইউজার প্রোফাইল (টোকেন ভেরিফাই করার জন্য)
app.get('/api/profile', authMiddleware, async (req, res) => {
    try {
        // authMiddleware থেকে req.user আসে
        const user = await User.findById(req.user.id).select('-password');
        const team = await Team.findOne({ owner: req.user.id });
        res.json({
            username: user.username,
            role: user.role,
            team: team ? team : null // ইউজারের টিম আছে কিনা
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


// --- Team Routes (admin.js এবং team.js-এর জন্য) ---

// রুট: টিম তৈরি (শুধুমাত্র অ্যাডমিন)
app.post('/api/teams/create', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied. Admins only.' });
    }
    const { teamName, budget, ownerUsername } = req.body;
    try {
        // টিম ওনারকে খুঁজুন
        const owner = await User.findOne({ username: ownerUsername });
        if (!owner) {
            return res.status(404).json({ message: `User '${ownerUsername}' not found.` });
        }
        if (owner.role !== 'TeamOwner') {
             return res.status(400).json({ message: `User '${ownerUsername}' is an Admin, not a TeamOwner.` });
        }
        // ওনারের অন্য টিম আছে কিনা চেক করুন
        const existingTeam = await Team.findOne({ owner: owner.id });
        if (existingTeam) {
            return res.status(400).json({ message: `User '${ownerUsername}' already owns team '${existingTeam.teamName}'.` });
        }
        // নতুন টিম তৈরি করুন
        const newTeam = new Team({
            teamName,
            budget,
            owner: owner.id
        });
        await newTeam.save();

        // ইউজার মডেলে টিমের ID আপডেট করুন
        owner.team = newTeam._id;
        await owner.save();

        io.emit('teams_updated'); // সব ক্লায়েন্টকে আপডেট পাঠান
        res.status(201).json({ message: 'Team created and assigned successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: সব টিমের তথ্য (বাজেট) (team.js-এর জন্য)
app.get('/api/teams', authMiddleware, async (req, res) => {
    try {
        const teams = await Team.find().select('teamName budget');
        res.json(teams);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: আমার কেনা প্লেয়ার (team.js-এর জন্য)
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


// --- Player Routes (admin.js এবং team.js-এর জন্য) ---

// রুট: প্লেয়ার তৈরি (শুধুমাত্র অ্যাডমিন)
app.post('/api/players/create', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied. Admins only.' });
    }
    const { playerName, category, basePrice } = req.body;
    try {
        const newPlayer = new Player({
            playerName,
            category,
            basePrice,
            currentPrice: basePrice,
            isSelfRegistered: false, // অ্যাডমিন তৈরি করেছে
            discordUsername: 'N/A (Admin Created)' // সেলফ-রেজিস্টার না হওয়ায় এটি প্রযোজ্য নয়
        });
        await newPlayer.save();
        io.emit('players_updated'); // সব ক্লায়েন্টকে আপডেট পাঠান
        res.status(201).json({ message: 'Player created successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: সব প্লেয়ার (অ্যাডমিনের জন্য)
app.get('/api/players', async (req, res) => {
    try {
        const players = await Player.find()
            .populate('soldTo', 'teamName')
            .populate('bids.bidderTeam', 'teamName')
            .sort({ status: 1, currentPrice: -1 }); // স্ট্যাটাস অনুযায়ী সাজানো
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: শুধু অকশনের জন্য উপলব্ধ প্লেয়ার (টিম ড্যাশবোর্ডের জন্য)
app.get('/api/players/available', async (req, res) => {
    try {
        // শুধু 'Pending' বা 'Ongoing' প্লেয়ারদের দেখানো হচ্ছে
        const players = await Player.find({ status: { $in: ['Pending', 'Ongoing'] } })
            .populate('bids.bidderTeam', 'teamName')
            .sort({ status: -1 }); // 'Ongoing' প্লেয়ার আগে দেখাবে
        res.json(players);
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


// --- অকশন কন্ট্রোল রুট (আপনার ফ্রন্ট-এন্ড থেকে কল করা) ---

// রুট: বিড করা (টিম ওনার)
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
        if (bidAmount <= player.currentPrice) return res.status(400).json({ error: `Bid must be higher than $${player.currentPrice}.` });
        if (team.budget < bidAmount) return res.status(400).json({ error: 'Insufficient budget for this bid.' });

        // বিড গ্রহণ করুন
        const newBid = {
            bidderTeam: team._id,
            amount: bidAmount,
            timestamp: new Date()
        };
        player.bids.push(newBid);
        player.currentPrice = bidAmount;

        // টাইমার রিসেট/বাড়ানো (যেমন, ১০ সেকেন্ড বাকি থাকলে রিসেট করে ৩০ সেকেন্ড করা)
        const timeLeft = Math.round((new Date(player.auctionEndTime).getTime() - Date.now()) / 1000);
        if (timeLeft < 10) {
             player.auctionEndTime = new Date(Date.now() + 30 * 1000); // সময় ৩০ সেকেন্ড বাড়ানো হলো
        }

        await player.save();

        // সব ক্লায়েন্টকে আপডেট পাঠান
        io.emit('players_updated');
        io.emit('teams_updated');
        io.emit('auction_log', `BID: ${team.teamName} bids $${bidAmount} for ${player.playerName}`);

        res.json({ message: 'Bid placed successfully!' });

    } catch (error) {
        res.status(500).json({ error: 'Server error: ' + error.message });
    }
});

// রুট: অকশন শুরু করা (অ্যাডমিন)
app.post('/api/players/:id/start', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        // অন্য কোনো প্লেয়ার 'Ongoing' থাকলে শুরু করা যাবে না
        const ongoingPlayer = await Player.findOne({ status: 'Ongoing' });
        if (ongoingPlayer) {
            return res.status(400).json({ message: `Cannot start. ${ongoingPlayer.playerName} is already being auctioned.` });
        }

        const player = await Player.findById(req.params.id);
        if (!player || player.status !== 'Pending') {
            return res.status(400).json({ message: 'Player is not ready for auction.' });
        }

        player.status = 'Ongoing';
        player.currentPrice = player.basePrice; // দাম বেস প্রাইসে রিসেট
        player.bids = []; // পুরনো বিড মুছে ফেলা (যদি থাকে)
        player.auctionEndTime = new Date(Date.now() + 60 * 1000); // অকশন টাইমার ৬০ সেকেন্ড
        await player.save();

        io.emit('players_updated');
        io.emit('auction_log', `AUCTION STARTED: ${player.playerName} (Base Price: $${player.basePrice})`);

        res.json({ message: 'Auction started!' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

// রুট: প্লেয়ার ম্যানুয়ালি বিক্রি (অ্যাডমিন)
app.post('/api/players/:id/sold', authMiddleware, async (req, res) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ message: 'Access denied.' });
    }
    try {
        // sellPlayer ফাংশনটি কল করুন, adminTriggered = true দিয়ে
        await sellPlayer(req.params.id, true);
        res.json({ message: 'Player manually sold.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});


// --- প্লেয়ার সেল্ফ-রেজিস্ট্রেশন রুট (আপনার কোড) ---

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

app.post('/api/players/self-register', async (req, res) => {
    if (!playerRegistrationEndTime || playerRegistrationEndTime <= new Date()) {
        return res.status(400).json({ message: 'Player registration is currently closed.' });
    }
    const { playerName, discordUsername } = req.body;
    if (!playerName || !discordUsername) {
        return res.status(400).json({ message: 'Player Name and Discord Username are required.' });
    }
    try {
        const existingPlayer = await Player.findOne({ playerName });
        if (existingPlayer) {
            return res.status(400).json({ message: 'Player name already registered.' });
        }
        const newPlayer = new Player({
            playerName,
            discordUsername,
            category: 'Unassigned',
            isSelfRegistered: true,
            // basePrice স্বয়ংক্রিয়ভাবে 100 সেট হবে (মডেল অনুযায়ী)
        });
        await newPlayer.save();
        io.emit('players_updated');
        io.emit('auction_log', `${playerName} successfully self-registered (Discord: ${discordUsername}).`);
        res.status(201).json({ message: `${playerName} registered successfully! Awaiting auction.` });
    } catch (error) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});


// --- সার্ভার চালু করুন ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Socket.io is listening for connections.');
});
