const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const TeamSchema = new Schema({
    teamName: {
        type: String,
        required: true,
        unique: true
    },
    owner: {
        type: Schema.Types.ObjectId, // যে ইউজার এই টিমের মালিক
        ref: 'User', // 'User' মডেলের সাথে লিঙ্ক
        required: true,
        unique: true // একজন ইউজার শুধু একটি টিমের মালিক হতে পারবে
    },
    budget: {
        type: Number,
        required: true,
        default: 10000000 // উদাহরণ: ডিফল্ট বাজেট ১ কোটি (টেস্টিংয়ের জন্য)
    },
    playersOwned: [
        {
            // ভবিষ্যতে কেনা প্লেয়ারদের ID এখানে থাকবে
            type: Schema.Types.ObjectId,
            ref: 'Player' // 'Player' মডেল (আমরা পরে তৈরি করবো)
        }
    ]
});

module.exports = mongoose.model('Team', TeamSchema);