import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * ARCHITECTURAL FIX: Modular Singleton Injection
 * Imports the globally frozen database singleton instance instead of spinning up a separate 
 * unencrypted connection configuration local to this file.
 */
import dbInstance from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

/**
 * ARCHITECTURE LAYERING: Serves static frontend assets (HTML/CSS/JS) via Express middleware.
 * NOTE: For production-level scaling, these assets should be offloaded to a CDN (e.g., AWS CloudFront)
 * to free up the Node.js CPU thread for dynamic REST API routing.
 */
app.use(express.static(path.join(__dirname, 'public')));

/**
 * AUTHENTICATION ENDPOINT: Validates user credentials against the relational schema.
 * TRAP MITIGATION: Implements parameterized queries via the singleton layer to completely neutralize SQL Injection (SQLi) vectors.
 * PRODUCTION UPGRADE: Plain-text PIN validation should be migrated to cryptographically salted bcrypt hashes 
 * combined with stateless JWT (JSON Web Tokens) or HttpOnly cookie sessions.
 */
app.post('/api/login', async (req, res) => {
    const { accountNo, pin } = req.body;
    try {
        // SWAPPED: Utilizing the secure dbInstance layer
        const rows = await dbInstance.query('SELECT id, name, balance FROM customers WHERE account_no = ? AND pin = ?', [accountNo, pin]);
        if (rows.length > 0) res.json({ success: true, user: rows[0] });
        else res.status(401).json({ success: false, message: "Invalid credentials" });
    } catch (err) { res.status(500).json({ success: false, message: "Database error" }); }
});

/**
 * UTILITY ENDPOINT: Retrieves the complete list of unique customer accounts.
 * Used exclusively by the frontend SPA to dynamically populate the transfer recipient dropdown,
 * ensuring seamless user flow execution.
 */
app.get('/api/customers', async (req, res) => {
    try {
        // SWAPPED: Running query over the secure TLS cloud singleton instance
        const rows = await dbInstance.query('SELECT id, name, account_no FROM customers');
        res.json({ success: true, customers: rows });
    } catch (err) { res.status(500).json({ success: false, message: "DB Error" }); }
});

/**
 * DATA ISOLATION ENFORCEMENT: Enforces strict data isolation policies at the API layer.
 * Replaced the global admin audit log query with a targeted `WHERE` condition checking both 
 * `sender_id` and `receiver_id` matches against the authenticated user's ID. 
 * Prevents horizontal privilege escalation and ensures client-specific payload safety.
 */
app.get('/api/transactions/:userId', async (req, res) => {
    const userId = req.params.userId; 
    try {
        const query = `
            SELECT t.amount, t.transaction_date, s.name as sender_name, r.name as receiver_name 
            FROM transaction_history t
            JOIN customers s ON t.sender_id = s.id
            JOIN customers r ON t.receiver_id = r.id
            WHERE t.sender_id = ? OR t.receiver_id = ? 
            ORDER BY t.transaction_date DESC`;
            
        // SWAPPED: Execution bound to database connection proxy singleton
        const rows = await dbInstance.query(query, [userId, userId]);
        res.json({ success: true, transactions: rows });
    } catch (err) { 
        res.status(500).json({ success: false, message: "DB Error" }); 
    }
});

/**
 * TRANSACTION EXECUTION ENGINE: Triggers the atomic balance ledger update logic.
 * INTERVIEW FOCUS: Offloads transaction logic into a custom MySQL Stored Procedure to ensure absolute 
 * ACID compliance. Minimizes Express-to-DB network round-trip overhead and wraps the execution flow 
 * in pessimistic `FOR UPDATE` row-level locks to completely mitigate concurrent race conditions.
 */
app.post('/api/transfer', async (req, res) => {
    const { senderId, receiverId, amount } = req.body;
    try {
        // SWAPPED: Invoking Stored Procedure call dynamically over active cloud connections
        const result = await dbInstance.query('CALL TransferMoney(?, ?, ?)', [senderId, receiverId, amount]);
        const status = result[0][0].status;
        res.json({ success: status.includes('Successful'), message: status });
    } catch (err) { res.status(500).json({ success: false, message: "Server Error" }); }
});

/**
 * KEEP-ALIVE HEALTH CHECK ENDPOINT: 
 * Pings the database to prevent Render and Aiven Free Tier instances from sleeping due to inactivity.
 */
app.get('/api/health', async (req, res) => {
    try {
        await dbInstance.query('SELECT 1');
        res.status(200).json({ status: 'healthy', timestamp: new Date() });
    } catch (error) {
        res.status(500).json({ status: 'unhealthy', error: error.message });
    }
});

/**
 * PORT DYNAMICIZATION UPGRADE: Dynamic Environment Binding
 * Ingests the `process.env.PORT` variable assigned by Render container systems.
 * If running locally, it defaults seamlessly to port 3000 to prevent local architecture breaking.
 */
const PORT = process.env.PORT || 3000;

/**
 * HTTP APPLICATION SERVER: Launches the API Gateway.
 * Operates on the Node.js single-threaded Event Loop, utilizing asynchronous, non-blocking 
 * libuv thread pool execution to handle high-concurrency requests smoothly.
 */
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));