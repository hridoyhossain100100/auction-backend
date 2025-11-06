const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true 
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['Admin', 'TeamOwner'], // ভূমিকা শুধু এই দুটি হতে পারবে
        default: 'TeamOwner'       // নতুন কেউ রেজিস্টার করলে সে 'TeamOwner' হবে
    },
    team: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Team'
    }
});

const User = mongoose.model('User', UserSchema);

module.exports = User;
