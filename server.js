const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(cors());

// MongoDB User Schema
const userSchema = new mongoose.Schema({
    username: String,
    phoneOrEmail: String,
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'master_admin', 'support_admin', 'agent'], default: 'user' },
    turnoverReq: { type: Number, default: 0 },
    turnoverDone: { type: Number, default: 0 },
    referralCode: String,
    referredBy: String
});

const User = mongoose.model('User', userSchema);

// Deposit Request Schema
const depositSchema = new mongoose.Schema({
    userId: String,
    amount: Number,
    bonusPercent: Number,
    trxId: String,
    last4Digits: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now, expires: 900 } // 15 মিনিট পর অটোমেটিক এক্সপায়ার হবে
});

const Deposit = mongoose.model('Deposit', depositSchema);

// API Route: Submit Deposit Request
app.post('/api/deposit/request', async (req, res) => {
    try {
        const { userId, amount, bonusPercent, trxId, last4Digits } = req.body;
        
        const newDeposit = new Deposit({
            userId,
            amount,
            bonusPercent,
            trxId,
            last4Digits
        });

        await newDeposit.save();
        
        // Notify Admins in Real-Time
        io.emit('new_deposit_alert', newDeposit);
        
        res.status(200).json({ success: true, message: "Deposit request submitted successfully" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API Route: Admin Approve Deposit & Set Turnover
app.post('/api/admin/approve-deposit', async (req, res) => {
    const { depositId, adminId } = req.body;
    
    const deposit = await Deposit.findById(depositId);
    if (!deposit || deposit.status !== 'pending') {
        return res.status(400).json({ message: "Invalid or processed deposit request" });
    }

    const user = await User.findById(deposit.userId);
    
    // Turnover Calculation (Standard: 10x deposit, 100% bonus: 18x)
    let turnoverMultiplier = 10;
    if(deposit.bonusPercent === 100) turnoverMultiplier = 18;
    else if(deposit.bonusPercent === 50) turnoverMultiplier = 16;
    
    const addedTurnover = (deposit.amount * turnoverMultiplier);
    
    // Balance Update
    user.balance += deposit.amount;
    user.turnoverReq += addedTurnover;
    await user.save();

    deposit.status = 'approved';
    await deposit.save();

    // Push live update to the specific user's app
    io.to(deposit.userId).emit('balance_updated', { balance: user.balance, turnoverReq: user.turnoverReq });

    res.json({ success: true, message: "Deposit approved successfully" });
});

// Real-Time Aviator Game Loop (Server-Synchronized Multiplier)
let aviatorMultiplier = 1.00;
let isFlying = false;

function runAviatorEngine() {
    setInterval(() => {
        if (!isFlying) {
            isFlying = true;
            aviatorMultiplier = 1.00;
            const crashPoint = (Math.random() * 3 + 1).toFixed(2); // Win-Loss logic backend control
            
            const flightInterval = setInterval(() => {
                aviatorMultiplier += 0.03;
                io.emit('aviator_tick', { multiplier: aviatorMultiplier.toFixed(2) });

                if (aviatorMultiplier >= crashPoint) {
                    clearInterval(flightInterval);
                    io.emit('aviator_crash', { crashPoint });
                    isFlying = false;
                }
            }, 100);
        }
    }, 12000); // New round every 12 seconds
}

runAviatorEngine();

server.listen(5000, () => console.log('Production Server running on port 5000'));
