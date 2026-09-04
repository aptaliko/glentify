import './neonConfig'; // must run before neon() — no-op in prod, redirects to local proxy when NEON_LOCAL=1
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
