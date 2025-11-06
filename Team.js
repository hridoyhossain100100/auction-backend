const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeamSchema = new Schema({
    teamName: {
        type: String,
        required: true,
        unique: true
    },
    owner: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    budget: {
        type: Number,
        required: true,
        default: 10000000 
    },
    playersOwned: [
        {
            type: Schema.Types.ObjectId,
            ref: 'Player'
        }
    ]
});

module.exports = mongoose.model('Team', TeamSchema);
