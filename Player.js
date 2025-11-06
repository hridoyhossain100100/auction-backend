const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PlayerSchema = new Schema({
    // --- সেল্ফ-রেজিস্ট্রেশন প্লেয়ারদের জন্য ---
    playerName: {
        type: String,
        required: true,
        unique: true 
    },
    category: {
        type: String,
        required: true,
        enum: ['Batsman', 'Bowler', 'All-Rounder', 'Unassigned'] // Unassigned যোগ করা হলো
    },
    isSelfRegistered: { // এই প্লেয়ার কি নিজে রেজিস্টার করেছে?
        type: Boolean,
        default: true
    },
    // -------------------------------------
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
    // নিলামের তথ্য
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
    createdBy: { // এখন এটি অ্যাডমিন হতে পারে, অথবা প্লেয়ারের User ID
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    // --- নতুন: রেজিস্ট্রেশন টাইমলাইন ---
    registrationDate: {
        type: Date, // কখন প্লেয়ার রেজিস্টার করেছে
        default: Date.now
    }
});

module.exports = mongoose.model('Player', PlayerSchema);
