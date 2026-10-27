import {neon} from '@neondatabase/serverless';
import {getDatabaseUrl} from './authDb';
let ready:Promise<void>|null=null;
function sql(){const url=getDatabaseUrl();if(!url)throw new Error('Database unavailable');return neon(url);}
async function ensure(){if(!ready)ready=sql()`CREATE TABLE IF NOT EXISTS zpora_push_devices (token TEXT PRIMARY KEY,user_id TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`.then(()=>undefined).catch(e=>{ready=null;throw e;});await ready;}
export function validExpoPushToken(token:string){return /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token)&&token.length<200;}
export async function saveZporaPushDevice(userId:string,token:string){await ensure();await sql()`INSERT INTO zpora_push_devices(token,user_id) VALUES(${token},${userId}) ON CONFLICT(token) DO UPDATE SET user_id=${userId},updated_at=NOW()`;}
export async function deleteZporaPushDevice(userId:string,token:string){await ensure();await sql()`DELETE FROM zpora_push_devices WHERE token=${token} AND user_id=${userId}`;}
export async function zporaPushTokens(userId:string){await ensure();const rows=await sql()`SELECT token FROM zpora_push_devices WHERE user_id=${userId} AND updated_at > NOW()-INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 10`;return rows.map(r=>String(r.token));}
