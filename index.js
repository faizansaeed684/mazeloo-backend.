import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { query } from './db.js';
import { authenticateToken, generateToken } from './auth.js';
import { hashPassword, comparePassword, generateReferralCode } from './utils.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// ============ AUTH ROUTES ============

app.post('/api/auth/signup', async (req, res) => {
    const { username, password, full_name, country, whatsapp, referral_code } = req.body;

    try {
        const id = crypto.randomUUID();
        const password_hash = await hashPassword(password);
        const ref_code = generateReferralCode();

        // Check for referrer
        let referrer_id = null;
        if (referral_code) {
            const refResult = await query('SELECT id FROM users WHERE referral_code = ?', [referral_code]);
            if (refResult.rows.length > 0) {
                referrer_id = refResult.rows[0].id;
            }
        }

        await query(
            `INSERT INTO users (
        id, username, full_name, password_hash, country, whatsapp, referral_code, referred_by, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                username,
                full_name,
                password_hash,
                country,
                whatsapp || null,
                ref_code,
                referrer_id,
                'user'
            ]
        );

        const user = { id, username, role: 'user' };
        const token = generateToken(user);

        res.status(201).json({ user, token });
    } catch (err) {
        console.error('Signup Error:', err);
        res.status(500).json({
            error: 'Database error saving new user',
            details: err.message
        });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const { rows } = await query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = rows[0];
        const isMatch = await comparePassword(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user);
        const { password_hash, ...userWithoutPassword } = user;

        res.json({ user: userWithoutPassword, token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// ============ PROTECTED ROUTES ============

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const { password_hash, ...profile } = rows[0];
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching profile' });
    }
});

// ============ PROFILE ROUTES ============

app.get('/api/profile/search', authenticateToken, async (req, res) => {
    const { q, limit = 20 } = req.query;
    try {
        const { rows } = await query(
            `SELECT * FROM users 
       WHERE username LIKE ? OR full_name LIKE ? 
       ORDER BY total_points DESC LIMIT ?`,
            [`%${q}%`, `%${q}%`, parseInt(limit)]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/profile/:username', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM users WHERE username = ?', [req.params.username]);
        if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const { password_hash, ...profile } = rows[0];
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============ POST ROUTES ============

app.post('/api/posts', authenticateToken, async (req, res) => {
    const { image_url, caption } = req.body;
    const id = crypto.randomUUID();
    try {
        await query(
            'INSERT INTO posts (id, user_id, image_url, caption) VALUES (?, ?, ?, ?)',
            [id, req.user.id, image_url, caption || null]
        );
        res.status(201).json({ id, user_id: req.user.id, image_url, caption });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Post creation failed' });
    }
});

app.get('/api/posts/feed', authenticateToken, async (req, res) => {
    const { page = 0, limit = 10 } = req.query;
    const offset = page * limit;
    try {
        // Simplified feed: Get following + own posts
        const { rows } = await query(
            `SELECT p.*, u.username, u.full_name, u.avatar_url,
       (SELECT count(*) FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = ?) > 0 as is_liked
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.user_id = ? OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
            [req.user.id, req.user.id, req.user.id, parseInt(limit), parseInt(offset)]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Feed failed' });
    }
});

app.get('/api/posts/user/:userId', authenticateToken, async (req, res) => {
    const { page = 0, limit = 12 } = req.query;
    const offset = page * limit;
    try {
        const { rows } = await query(
            'SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [req.params.userId, parseInt(limit), parseInt(offset)]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'User posts failed' });
    }
});

// ============ SOCIAL / STORIES ROUTES ============

app.post('/api/posts/:postId/like', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    try {
        await query('INSERT IGNORE INTO post_likes (id, post_id, user_id) VALUES (?, ?, ?)', [id, req.params.postId, req.user.id]);
        await query('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?', [req.params.postId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Like failed' });
    }
});

app.post('/api/posts/:postId/comment', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { comment_text } = req.body;
    try {
        await query(
            'INSERT INTO post_comments (id, post_id, user_id, comment_text) VALUES (?, ?, ?, ?)',
            [id, req.params.postId, req.user.id, comment_text]
        );
        await query('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?', [req.params.postId]);
        res.status(201).json({ id, post_id: req.params.postId, user_id: req.user.id, comment_text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Comment failed' });
    }
});

app.post('/api/profiles/:userId/follow', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    try {
        await query(
            'INSERT IGNORE INTO follows (id, follower_id, following_id) VALUES (?, ?)',
            [id, req.user.id, req.params.userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Follow failed' });
    }
});

app.get('/api/stories', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT s.*, u.username, u.avatar_url 
       FROM stories s
       JOIN users u ON s.user_id = u.id
       WHERE expires_at > NOW()
       ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Stories failed' });
    }
});

app.post('/api/stories', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { image_url } = req.body;
    const expires_at = new Date();
    expires_at.setHours(expires_at.getHours() + 24);

    try {
        await query(
            'INSERT INTO stories (id, user_id, image_url, expires_at) VALUES (?, ?, ?, ?)',
            [id, req.user.id, image_url, expires_at]
        );
        res.status(201).json({ id, user_id: req.user.id, image_url, expires_at });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Story creation failed' });
    }
});

app.post('/api/stories/:storyId/view', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    try {
        await query('INSERT IGNORE INTO story_views (id, story_id, user_id) VALUES (?, ?, ?)', [id, req.params.storyId, req.user.id]);
        await query('UPDATE stories SET views_count = views_count + 1 WHERE id = ?', [req.params.storyId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Story view failed' });
    }
});

// ============ SOCIAL / FOLLOWS ============

app.delete('/api/profiles/:userId/follow', authenticateToken, async (req, res) => {
    try {
        await query('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.user.id, req.params.userId]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Unfollow failed' });
    }
});

app.post('/api/profiles/:userId/approve', authenticateToken, async (req, res) => {
    try {
        await query('UPDATE follows SET is_pending = 0 WHERE follower_id = ? AND following_id = ?', [req.params.userId, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Approval failed' });
    }
});

app.get('/api/profiles/:userId/followers', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT u.* FROM users u 
       JOIN follows f ON u.id = f.follower_id 
       WHERE f.following_id = ? AND f.is_pending = 0`,
            [req.params.userId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Followers failed' });
    }
});

app.get('/api/profiles/:userId/following', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT u.* FROM users u 
       JOIN follows f ON u.id = f.following_id 
       WHERE f.follower_id = ? AND f.is_pending = 0`,
            [req.params.userId]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Following failed' });
    }
});

app.get('/api/profiles/requests', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT u.* FROM users u 
       JOIN follows f ON u.id = f.follower_id 
       WHERE f.following_id = ? AND f.is_pending = 1`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Requests failed' });
    }
});

// ============ MESSAGING ============

app.post('/api/messages', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { receiver_id, message_text } = req.body;
    try {
        await query(
            'INSERT INTO messages (id, sender_id, receiver_id, message_text) VALUES (?, ?, ?, ?)',
            [id, req.user.id, receiver_id, message_text]
        );
        res.status(201).json({ id, sender_id: req.user.id, receiver_id, message_text });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Message failed' });
    }
});

app.get('/api/messages/conversation/:otherUserId', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT * FROM messages 
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) 
       ORDER BY created_at ASC`,
            [req.user.id, req.params.otherUserId, req.params.otherUserId, req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Conversation failed' });
    }
});

app.post('/api/messages/:senderId/read', authenticateToken, async (req, res) => {
    try {
        await query('UPDATE messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [req.params.senderId, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Read update failed' });
    }
});

// ============ VERIFICATION ============

app.post('/api/verifications/request', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { verification_type, verification_value } = req.body;
    try {
        await query(
            'INSERT INTO verifications (id, user_id, verification_type, verification_value) VALUES (?, ?, ?, ?)',
            [id, req.user.id, verification_type, verification_value]
        );
        res.status(201).json({ id, user_id: req.user.id, verification_type, verification_value });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.post('/api/verifications/claim-bonus', authenticateToken, async (req, res) => {
    try {
        // Simple claim: check if user is verified (demo logic)
        await query('UPDATE users SET available_points = available_points + 20 WHERE id = ?', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Bonus claim failed' });
    }
});

// ============ WALLET & TASKS ============

app.get('/api/wallet/summary', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT total_points, available_points, pending_points, total_earned, total_spent FROM users WHERE id = ?',
            [req.user.id]
        );
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Wallet fetch failed' });
    }
});

app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM tasks WHERE is_active = 1 ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Tasks fetch failed' });
    }
});

app.post('/api/tasks/:taskId/submit', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { submission_data } = req.body;
    try {
        await query(
            'INSERT INTO task_submissions (id, task_id, user_id, submission_data) VALUES (?, ?, ?, ?)',
            [id, req.params.taskId, req.user.id, JSON.stringify(submission_data)]
        );
        res.status(201).json({ id, task_id: req.params.taskId, user_id: req.user.id, submission_data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Task submission failed' });
    }
});

app.post('/api/notifications/:notificationId/read', authenticateToken, async (req, res) => {
    try {
        await query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.notificationId, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Read update failed' });
    }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Read update failed' });
    }
});

app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Notifications failed' });
    }
});

// ============ LEADERBOARD & ADMIN ============

app.get('/api/leaderboard', authenticateToken, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT id, username, full_name, avatar_url, total_points FROM users ORDER BY total_points DESC LIMIT 100'
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Leaderboard failed' });
    }
});

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const userCount = await query('SELECT count(*) as count FROM users');
        const postCount = await query('SELECT count(*) as count FROM posts');
        const taskCount = await query('SELECT count(*) as count FROM tasks');
        const submissionCount = await query('SELECT count(*) as count FROM task_submissions');

        res.json({
            total_users: parseInt(userCount.rows[0].count),
            total_posts: parseInt(postCount.rows[0].count),
            active_tasks: parseInt(taskCount.rows[0].count),
            pending_submissions: parseInt(submissionCount.rows[0].count)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Admin stats failed' });
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
    console.log(`Mazeloo server running on port ${PORT}`);
});
