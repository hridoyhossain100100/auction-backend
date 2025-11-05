const jwt = require('jsonwebtoken');
const JWT_SECRET = "your_secret_key_123"; // এই কী-টি server.js-এর সাথে মিলতে হবে

module.exports = function(req, res, next) {
    // হেডার থেকে টোকেন নিন
    const authHeader = req.header('Authorization'); // 'Bearer TOKEN'

    // চেক করুন হেডার আছে কিনা
    if (!authHeader) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        // 'Bearer ' লেখাটি বাদ দিয়ে শুধু টোকেনটি নিন
        const token = authHeader.split(' ')[1];
        
        // টোকেন ভেরিফাই (Verify) করুন
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // ভেরিফাই সফল হলে, ইউজারের তথ্য রিকোয়েস্টের সাথে যোগ করুন
        req.user = decoded.user;
        next(); // পরবর্তী ধাপে (protected route) যেতে দিন

    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};