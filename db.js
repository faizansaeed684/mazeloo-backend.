import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Hardcoded fallback in case env var has spaces or is missing
const SUPABASE_URL = 'https://iyqgtxxwguumhqqtemzk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5cWd0eHh3Z3V1bWhxcXRlbXprIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTA2ODg2NSwiZXhwIjoyMDg2NjQ0ODY1fQ.hcZELxCY5Zn6DNKDt0cjRqUcvIkoYeSjPg8M9ADJhos';

const supabaseUrl = (process.env.SUPABASE_URL || '').trim() || SUPABASE_URL;
const supabaseKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || SUPABASE_KEY;

console.log('Supabase URL (first 40):', supabaseUrl.substring(0, 40));
console.log('Key length:', supabaseKey.length);

// Admin client that bypasses RLS
export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

export default supabase;
