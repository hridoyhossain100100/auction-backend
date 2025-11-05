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
        default: function() { return this.basePrice; } // বেস প্রাইসই বর্তমান প্রাইস
    },
    // --- নিলামের তথ্য ---
    status: {
        type: String,
        enum: ['Pending', 'Ongoing', 'Sold', 'Unsold'],
        default: 'Pending' // শুরুতে প্লেয়ার লিস্টে থাকবে
    },
    soldTo: {
        type: Schema.Types.ObjectId,
        ref: 'Team'
    },
    soldAmount: {
        type: Number
    },
    // --- বিডের ইতিহাস ---
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
    // অ্যাডমিন যে প্লেয়ারটি তৈরি করেছে
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
});

module.exports = mongoose.model('Player', PlayerSchema);