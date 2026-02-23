// Direct Supabase REST API client using native fetch
// This bypasses @supabase/supabase-js and all its dependencies
// Hardcoded fallback in case env var has spaces or is missing
const SUPABASE_URL = 'https://iyqgtxxwguumhqqtemzk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cWd0eHh3Z3V1bWhxcXRlbXprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTA2ODg2NSwiZXhwIjoyMDg2NjQ0ODY1fQ.hcZELxCY5Zn6DNKDt0cjRqUcvIkoYeSjPg8M9ADJhos';

console.log('[DB] Supabase URL:', SUPABASE_URL.substring(0, 50));
console.log('[DB] Key length:', SUPABASE_KEY.length);

const HEADERS = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
};

import https from 'https';

// Native HTTPS request function as a fallback to fetch
async function httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = https.request(reqOptions, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode,
                    text: async () => body,
                    json: async () => JSON.parse(body)
                });
            });
        });

        req.on('error', (e) => reject(e));
        if (options.body) req.write(options.body);
        req.end();
    });
}

// Execute a SELECT query on a table
async function dbSelect(table, { columns = '*', filters = {}, single = false, limit = null } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}`;

    for (const [key, val] of Object.entries(filters)) {
        url += `&${key}=eq.${encodeURIComponent(val)}`;
    }
    if (limit) url += `&limit=${limit}`;

    const headers = { ...HEADERS };
    if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';

    try {
        console.log(`[DB] Attempting fetch for ${table}...`);
        const res = await fetch(url, { method: 'GET', headers });
        const text = await res.text();

        if (!res.ok) {
            const err = JSON.parse(text);
            return { data: null, error: err };
        }

        const data = text ? JSON.parse(text) : (single ? null : []);
        return { data: single ? (data || null) : data, error: null };
    } catch (e) {
        console.error(`[DB] Fetch failed for ${table}:`, e.message);
        console.log(`[DB] Falling back to native https module...`);
        try {
            const res = await httpsRequest(url, { method: 'GET', headers });
            const text = await res.text();
            if (!res.ok) {
                return { data: null, error: JSON.parse(text) };
            }
            const data = text ? JSON.parse(text) : (single ? null : []);
            return { data: single ? (data || null) : data, error: null };
        } catch (httpsErr) {
            console.error(`[DB] Native https also failed:`, httpsErr.message);
            return { data: null, error: { message: e.message, nativeError: httpsErr.message } };
        }
    }
}

// Execute an INSERT query
async function dbInsert(table, row) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const options = {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(row)
    };

    try {
        const res = await fetch(url, options);
        const text = await res.text();
        if (!res.ok) {
            const err = JSON.parse(text);
            return { data: null, error: err };
        }
        return { data: text ? JSON.parse(text) : null, error: null };
    } catch (e) {
        console.log(`[DB] Insert fetch failed, falling back to native https...`);
        try {
            const res = await httpsRequest(url, options);
            const text = await res.text();
            if (!res.ok) {
                return { data: null, error: JSON.parse(text) };
            }
            return { data: text ? JSON.parse(text) : null, error: null };
        } catch (httpsErr) {
            console.error(`[DB] Insert native https failed:`, httpsErr.message);
            return { data: null, error: { message: e.message, nativeError: httpsErr.message } };
        }
    }
}

// Execute an UPDATE query
async function dbUpdate(table, updates, filters = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url, {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify(updates)
    });
    const text = await res.text();
    if (!res.ok) {
        const err = JSON.parse(text);
        return { data: null, error: err };
    }
    return { data: text ? JSON.parse(text) : null, error: null };
}

// Execute a DELETE query
async function dbDelete(table, filters = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = Object.entries(filters).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`);
    if (params.length) url += '?' + params.join('&');

    const res = await fetch(url, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) {
        const text = await res.text();
        return { error: JSON.parse(text) };
    }
    return { error: null };
}

// Expose a supabase-like interface so we don't need to change index.js much
export const supabase = {
    from: (table) => ({
        select: (columns = '*') => ({
            eq: (col, val) => ({
                single: () => dbSelect(table, { columns, filters: { [col]: val }, single: true }),
                maybeSingle: () => dbSelect(table, { columns, filters: { [col]: val }, single: false }).then(r => {
                    if (r.error) return r;
                    const row = r.data?.[0] || null;
                    return { data: row, error: null };
                }),
                limit: (n) => dbSelect(table, { columns, filters: { [col]: val }, limit: n }),
                order: () => ({ data: [], error: null }) // stub
            }),
            limit: (n) => dbSelect(table, { columns, limit: n }),
            order: () => ({ data: [], error: null })
        }),
        insert: (row) => dbInsert(table, row),
        update: (updates) => ({
            eq: (col, val) => dbUpdate(table, updates, { [col]: val })
        }),
        delete: () => ({
            eq: (col, val) => dbDelete(table, { [col]: val })
        })
    })
};

export default supabase;
