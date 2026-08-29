import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const SERVER_DIR = path.join(import.meta.dirname, '..');

dotenv.config({ path: path.join(SERVER_DIR, '.env'), quiet: true });

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const CACHE_DIR = path.join(SERVER_DIR, 'cache');

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function stripCodeFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9_-]*[ \t]*\r?\n?/, '');
    if (t.endsWith('```')) {
      t = t.slice(0, -3);
    }
  }
  return t.trim();
}

async function callChatCompletion(
  system: string,
  user: string,
  baseUrl: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    if (res.status === 429 && attempt < maxAttempts) {
      const body = await res.text().catch(() => '');
      const match = body.match(/retry in ([\d.]+)s/i);
      const waitSeconds = Math.min(Math.ceil(match ? Number(match[1]) : 30), 60);
      console.log(`LLM rate limited; retrying in ${waitSeconds}s (attempt ${attempt} of ${maxAttempts - 1} retries)`);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM request failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }
    const data: any = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('LLM response did not include message content');
    }
    return content;
  }
  throw new Error('LLM request rate-limited after retries');
}

export async function chatJSON(system: string, user: string, cacheKey: string): Promise<any> {
  const cacheFile = path.join(CACHE_DIR, `${sha256(cacheKey)}.json`);
  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  }

  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY not set');
  }
  const baseUrl = process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;

  const attempts = [user, `${user}\n\nRespond with valid JSON only.`];
  let lastParseError: unknown;
  for (const prompt of attempts) {
    const reply = await callChatCompletion(system, prompt, baseUrl, model, apiKey);
    try {
      const parsed = JSON.parse(stripCodeFences(reply));
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(parsed, null, 2));
      return parsed;
    } catch (err) {
      lastParseError = err;
    }
  }
  const reason = lastParseError instanceof Error ? lastParseError.message : String(lastParseError);
  throw new Error(`LLM reply could not be parsed as JSON after retry: ${reason}`);
}
