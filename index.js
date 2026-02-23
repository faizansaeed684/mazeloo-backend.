import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { supabase } from './db.js';
import { authenticateToken, generateToken } from './auth.js';
import { hashPassword, comparePassword, generateReferralCode } from './utils.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Log env config on startup so we can verify in Render logs
const supabaseUrl = process.env.SUPABASE_URL || '(NOT SET)';
console.log('=== CONFIG CHECK ===');
console.log('SUPABASE_URL:', supabaseUrl.substring(0, 40));
console.log('KEY SET:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('KEY length:', (process.env.SUPABASE_SERVICE_ROLE_KEY || '').length);
console.log('====================');

// Health check endpoint - also tests Supabase connection
app.get('/health', async (req, res) => {
    try {
        console.log('[Health] Checking Supabase connection...');
        const { error, data } = await supabase.from('users').select('id').limit(1);

        if (error) {
            console.error('[Health] Connection error details:', error);
            return res.json({
                status: 'error',
                supabaseError: error.message,
                nativeError: error.nativeError || null,
                cause: error.cause || null,
                attemptedUrl: error.attemptedUrl || null,
                url: supabaseUrl.substring(0, 40)
            });
        }

        res.json({
            status: 'ok',
            version: '1.0.1-v2', // Added v2 to track my latest push
            supabase: 'connected',
            url: supabaseUrl.substring(0, 40),
            dataFound: !!data
        });
    } catch (e) {
        console.error('[Health] Catch-all error:', e);
        res.json({
            status: 'error',
            message: e.message,
            stack: e.stack,
            url: supabaseUrl.substring(0, 40)
        });
    }
});


app.post('/api/auth/signup', async (req, res) => {
    const { username, password, full_name, country, whatsapp, referral_code } = req.body;

    if (!username || !password || !full_name || !country) {
        return res.status(400).json({ error: 'Missing required fields: username, password, full_name, country' });
    }

    try {
        // Check username uniqueness - use maybeSingle() to avoid error on no results
        const { data: existing, error: checkError } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .maybeSingle();

        if (checkError) {
            console.error('Username check error:', checkError);
            return res.status(500).json({ error: `Database check failed: ${checkError.message}` });
        }

        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const id = crypto.randomUUID();
        const password_hash = await hashPassword(password);
        const ref_code = generateReferralCode();

        // Check for referrer
        let referred_by = null;
        if (referral_code) {
            const { data: referrer } = await supabase
                .from('users')
                .select('id')
                .eq('referral_code', referral_code)
                .maybeSingle();
            if (referrer) {
                referred_by = referrer.id;
            }
        }

        const { error: insertError } = await supabase.from('users').insert({
            id,
            username,
            full_name,
            password_hash,
            country,
            whatsapp: whatsapp || null,
            referral_code: ref_code,
            referred_by,
            role: 'user',
            email: `${id}@mazeloo-placeholder.com` // use UUID to guarantee email uniqueness
        });

        if (insertError) {
            console.error('Signup DB Error:', insertError.message, insertError.details, insertError.hint);
            // Check for duplicate username (race condition)
            if (insertError.code === '23505') {
                return res.status(409).json({ error: 'Username already taken' });
            }
            return res.status(500).json({ error: `Database Error: ${insertError.message}` });
        }

        const user = { id, username, role: 'user' };
        const token = generateToken(user);

        res.status(201).json({ user, token });
    } catch (err) {
        console.error('Signup Error:', err);
        res.status(500).json({ error: `Server Error: ${err.message}` });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Missing username or password' });
    }

    try {
        const { data: user, error } = await supabase.from('users').select('*').eq('username', username).single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.password_hash) {
            return res.status(401).json({ error: 'Account not configured for password login' });
        }

        const isMatch = await comparePassword(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user);
        const { password_hash, ...userWithoutPassword } = user;

        res.json({ user: userWithoutPassword, token });
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({ error: `Server error during login: ${err.message}` });
    }
});

// ============ PROTECTED ROUTES ============

app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
        if (error || !user) {
            return res.status(404).json({ error: 'Profile not found' });
        }
        const { password_hash, ...profile } = user;
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching profile' });
    }
});

app.get('/api/profile/search', authenticateToken, async (req, res) => {
    const { q, limit = 20 } = req.query;
    try {
        const { data: rows, error } = await supabase
            .from('users')
            .select('id, username, full_name, avatar_url, total_points')
            .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
            .order('total_points', { ascending: false })
            .limit(parseInt(limit));

        if (error) throw error;
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/api/profile/:username', authenticateToken, async (req, res) => {
    try {
        const { data: user, error } = await supabase.from('users').select('*').eq('username', req.params.username).single();
        if (error || !user) return res.status(404).json({ error: 'User not found' });
        const { password_hash, ...profile } = user;
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.patch('/api/profile', authenticateToken, async (req, res) => {
    const { full_name, bio, country, whatsapp, avatar_url, cover_url, website, location, email } = req.body;
    try {
        const updates = {
            full_name, bio, country, whatsapp, avatar_url, cover_url, website, location,
            updated_at: new Date().toISOString()
        };

        // Only update email if provided
        if (email) updates.email = email;

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        const { password_hash, ...profile } = data;
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Profile update failed' });
    }
});

// Alias PUT for PATCH to support frontend
app.put('/api/profile', authenticateToken, async (req, res) => {
    // Reuse the same logic
    const { full_name, bio, country, whatsapp, avatar_url, cover_url, website, location, email } = req.body;
    try {
        const updates = {
            full_name, bio, country, whatsapp, avatar_url, cover_url, website, location,
            updated_at: new Date().toISOString()
        };
        if (email) updates.email = email;

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        const { password_hash, ...profile } = data;
        res.json(profile);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Profile update failed' });
    }
});

// ============ VERIFICATION ============

app.post('/api/verifications/request', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { verification_type, verification_value } = req.body;
    try {
        const { error } = await supabase.from('verifications').insert({
            id,
            user_id: req.user.id,
            verification_type,
            verification_value
        });
        if (error) throw error;
        res.status(201).json({ id, user_id: req.user.id, verification_type, verification_value });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.get('/api/verifications', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('verifications')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Verifications fetch failed' });
    }
});

app.post('/api/verifications/claim-bonus', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('users')
            .update({ available_points: supabase.rpc('increment_points', { x: 20 }) })
            .eq('id', req.user.id);

        // Simpler approach:
        const { data: user } = await supabase.from('users').select('available_points, total_points').eq('id', req.user.id).single();
        await supabase.from('users').update({
            available_points: (user.available_points || 0) + 20,
            total_points: (user.total_points || 0) + 20
        }).eq('id', req.user.id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Bonus claim failed' });
    }
});

// ============ WALLET & TASKS ============

app.get('/api/wallet/summary', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('total_points, available_points, pending_points, total_earned, total_spent')
            .eq('id', req.user.id)
            .single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Wallet fetch failed' });
    }
});

app.get('/api/wallet/transactions', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('wallet_transactions')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Transactions fetch failed' });
    }
});

app.get('/api/tasks', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Tasks fetch failed' });
    }
});

app.post('/api/tasks/:taskId/submit', authenticateToken, async (req, res) => {
    const id = crypto.randomUUID();
    const { submission_data } = req.body;
    try {
        const { error } = await supabase.from('task_views').insert({
            id,
            task_id: req.params.taskId,
            user_id: req.user.id,
        });
        if (error) throw error;

        // Award points
        const { data: task } = await supabase.from('tasks').select('reward_points').eq('id', req.params.taskId).single();
        if (task) {
            const { data: user } = await supabase.from('users').select('available_points, total_points, total_earned').eq('id', req.user.id).single();
            await supabase.from('users').update({
                available_points: (user.available_points || 0) + task.reward_points,
                total_points: (user.total_points || 0) + task.reward_points,
                total_earned: (user.total_earned || 0) + task.reward_points
            }).eq('id', req.user.id);
        }

        res.status(201).json({ id, task_id: req.params.taskId, user_id: req.user.id, submission_data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Task submission failed' });
    }
});

// ============ NOTIFICATIONS ============

app.get('/api/notifications', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Notifications failed' });
    }
});

app.post('/api/notifications/:notificationId/read', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('id', req.params.notificationId)
            .eq('user_id', req.user.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Read update failed' });
    }
});

app.post('/api/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', req.user.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Read update failed' });
    }
});

// ============ LEADERBOARD ============

app.get('/api/leaderboard', authenticateToken, async (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, full_name, avatar_url, total_points')
            .order('total_points', { ascending: false })
            .limit(limit);
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Leaderboard failed' });
    }
});

// ============ VERIFICATION FLOW (NEW) ============

app.post('/api/auth/send-verification', authenticateToken, async (req, res) => {
    const { type, value } = req.body; // type: 'email' | 'whatsapp'
    if (!type || !value) return res.status(400).json({ error: 'Missing type or value' });

    try {
        // Generate a 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 mins expiry

        // Upsert code into verification_codes table
        const { error } = await supabase.from('verification_codes').upsert({
            user_id: req.user.id,
            code,
            type,
            expires_at
        }, { onConflict: 'user_id,type' });

        if (error) throw error;

        // In a real app, you would send the email/whatsapp here.
        // For now, we simulate success and log it.
        console.log(`[VERIFY] Code for ${req.user.username} (${type}): ${code}`);

        res.json({ success: true, message: `Verification code sent to ${value} (Simulated)` });
    } catch (err) {
        console.error('[VERIFY] Send error:', err);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});

app.post('/api/auth/verify-code', authenticateToken, async (req, res) => {
    const { type, code } = req.body;
    if (!type || !code) return res.status(400).json({ error: 'Missing type or code' });

    try {
        // Check code in DB
        const { data: record, error } = await supabase
            .from('verification_codes')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('type', type)
            .eq('code', code)
            .maybeSingle();

        if (error) throw error;
        if (!record) return res.status(400).json({ error: 'Invalid verification code' });

        // Check expiry
        if (new Date() > new Date(record.expires_at)) {
            return res.status(400).json({ error: 'Verification code expired' });
        }

        // Mark user as verified
        const field = type === 'email' ? 'email_verified' : 'whatsapp_verified';
        const { error: updateError } = await supabase.from('users').update({
            [field]: true,
            has_blue_badge: true // granting blue badge on any verification for now as per app logic
        }).eq('id', req.user.id);

        if (updateError) throw updateError;

        // Delete the code record
        await supabase.from('verification_codes').delete().eq('id', record.id);

        res.json({ success: true });
    } catch (err) {
        console.error('[VERIFY] Check error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ============ REFERRALS ============

app.get('/api/referrals', authenticateToken, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('referrals')
            .select('*, referred:referred_id(username, full_name, avatar_url, created_at)')
            .eq('referrer_id', req.user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Referrals fetch failed' });
    }
});

// ============ ADMIN ROUTES ============

app.get('/api/admin/stats', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [{ count: userCount }, { count: taskCount }] = await Promise.all([
            supabase.from('users').select('*', { count: 'exact', head: true }),
            supabase.from('tasks').select('*', { count: 'exact', head: true })
        ]);

        res.json({
            total_users: userCount || 0,
            active_tasks: taskCount || 0,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Admin stats failed' });
    }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, username, full_name, email, role, is_banned, total_points, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Admin users failed' });
    }
});

app.patch('/api/admin/users/:userId/ban', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { is_banned } = req.body;
    try {
        const { error } = await supabase.from('users').update({ is_banned }).eq('id', req.params.userId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ban update failed' });
    }
});

app.get('/api/admin/verifications', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { data, error } = await supabase
            .from('verifications')
            .select('*, user:user_id(username, full_name)')
            .eq('is_approved', false)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Verifications admin failed' });
    }
});

app.post('/api/admin/verifications/:id/approve', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { data: verification, error } = await supabase
            .from('verifications')
            .update({ is_approved: true, approved_by: req.user.id, approved_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;

        // Update user badge
        const field = verification.verification_type === 'email' ? 'email_verified' : 'whatsapp_verified';
        await supabase.from('users').update({ [field]: true, has_blue_badge: true }).eq('id', verification.user_id);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Verification approval failed' });
    }
});

app.post('/api/admin/tasks', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const id = crypto.randomUUID();
    try {
        const { error } = await supabase.from('tasks').insert({ id, creator_id: req.user.id, ...req.body });
        if (error) throw error;
        res.status(201).json({ id, ...req.body });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Task creation failed' });
    }
});

app.patch('/api/admin/tasks/:taskId', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { error } = await supabase.from('tasks').update(req.body).eq('id', req.params.taskId);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Task update failed' });
    }
});

// ============ SETTINGS ============

app.patch('/api/settings/password', authenticateToken, async (req, res) => {
    const { current_password, new_password } = req.body;
    try {
        const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();
        const isMatch = await comparePassword(current_password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

        const new_hash = await hashPassword(new_password);
        const { error } = await supabase.from('users').update({ password_hash: new_hash }).eq('id', req.user.id);
        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Password update failed' });
    }
});


app.listen(PORT, () => {
    console.log(`Mazeloo server running on port ${PORT}`);
});

