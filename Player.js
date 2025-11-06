const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PlayerSchema = new Schema({
    playerName: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true,
        enum: ['Batsman', 'Bowler', 'All-Rounder']
    },
    basePrice: {
        type: Number,
        required: true,
        default: 0
    },
    currentPrice: {
        type: Number,
        required: true,
        default: function() { return this.basePrice; }
    },
    // --- নিলামের তথ্য ---
    status: {
        type: String,
        enum: ['Pending', 'Ongoing', 'Sold', 'Unsold'],
        default: 'Pending'
    },
    // --- নতুন: টাইমার ফিল্ড ---
    auctionEndTime: {
        type: Date,
        default: null
    },
    // ---
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
        required: true
    }
});

module.exports = mongoose.model('Player', PlayerSchema);
