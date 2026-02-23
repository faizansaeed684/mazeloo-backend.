// Direct Supabase REST API client using native fetch
// This bypasses @supabase/supabase-js and all its dependencies

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || 'https://iyqgtxxwguumhqqtemzk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cWd0eHh3Z3V1bWhxcXRlbXprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTA2ODg2NSwiZXhwIjoyMDg2NjQ0ODY1fQ.hcZELxCY5Zn6DNKDt0cjRqUcvIkoYeSjPg8M9ADJhos';

console.log('[DB] Supabase URL:', SUPABASE_URL.substring(0, 50));
console.log('[DB] Key length:', SUPABASE_KEY.length);

const HEADERS = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': 'return=representation'
};

// Execute a SELECT query on a table
async function dbSelect(table, { columns = '*', filters = {}, single = false, limit = null } = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}?select=${columns}`;

    for (const [key, val] of Object.entries(filters)) {
        url += `&${key}=eq.${encodeURIComponent(val)}`;
    }
    if (limit) url += `&limit=${limit}`;

    const headers = { ...HEADERS };
    if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';

    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();

    if (!res.ok) {
        const err = JSON.parse(text);
        return { data: null, error: err };
    }

    const data = text ? JSON.parse(text) : (single ? null : []);
    return { data: single ? (data || null) : data, error: null };
}

// Execute an INSERT query
async function dbInsert(table, row) {
    const url = `${SUPABASE_URL}/rest/v1/${table}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(row)
    });
    const text = await res.text();
    if (!res.ok) {
        const err = JSON.parse(text);
        return { data: null, error: err };
    }
    return { data: text ? JSON.parse(text) : null, error: null };
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
