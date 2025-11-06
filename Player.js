const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PlayerSchema = new Schema({
    playerName: {
        type: String,
        required: true,
        unique: true 
    },
    discordUsername: {
        type: String,
        required: true
    },
    imageUrl: {
        type: String,
        default: 'https://static.vecteezy.com/system/resources/thumbnails/009/734/564/small_2x/default-avatar-profile-icon-of-social-media-user-vector.jpg' // একটি ডিফল্ট ছবি
    },
    category: {
        type: String,
        required: true,
        enum: ['Batsman', 'Bowler', 'All-Rounder', 'Unassigned'],
        default: 'Unassigned'
    },
    isSelfRegistered: {
        type: Boolean,
        default: true
    },
    basePrice: {
        type: Number,
        required: false,
        default: 100 // ডিফল্ট বেস প্রাইস
    },
    currentPrice: {
        type: Number,
        required: true,
        default: function() { return this.basePrice; }
    },
    status: {
        type: String,
        enum: ['Pending', 'Ongoing', 'Sold', 'Unsold'],
        default: 'Pending'
    },
    auctionEndTime: {
        type: Date,
        default: null
    },
    soldTo: {
        type: Schema.Types.ObjectId,
        ref: 'Team'
    },
    soldAmount: {
        type: Number
    },
    bids: [
        {
            bidderTeam: {
                type: Schema.Types.ObjectId,
                ref: 'Team'
            },
            amount: {
                type: Number
            },
            timestamp: {
                type: Date,
                default: Date.now
            }
        }
    ],
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    registrationDate: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Player', PlayerSchema);
