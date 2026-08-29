import type { Chunk, Link } from '../../src/shared/types';

const LINK_CAP = 8;
const KEYWORD_LINK_THRESHOLD = 2;
const INITIAL_STRENGTH = 0.05;

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'also', 'always', 'among',
  'and', 'another', 'any', 'anybody', 'anyone', 'anything', 'are', 'around',
  'because', 'been', 'before', 'behind', 'being', 'below', 'beneath', 'beside',
  'between', 'beyond', 'both', 'but', 'came', 'cannot', 'come', 'could',
  'did', 'does', 'doing', 'done', 'down', 'during', 'each', 'either', 'else',
  'even', 'ever', 'every', 'everyone', 'everything', 'few', 'for', 'from',
  'further', 'get', 'gets', 'had', 'has', 'have', 'having', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'however', 'into',
  'its', 'itself', 'just', 'like', 'made', 'make', 'many', 'may', 'might',
  'more', 'most', 'much', 'must', 'near', 'neither', 'never', 'none', 'nor',
  'not', 'nothing', 'now', 'off', 'often', 'once', 'one', 'only', 'onto',
  'other', 'our', 'ours', 'out', 'over', 'own', 'per', 'said', 'same', 'saw',
  'say', 'says', 'she', 'should', 'since', 'some', 'someone', 'something',
  'soon', 'still', 'such', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'through', 'thus', 'too',
  'under', 'until', 'upon', 'very', 'was', 'well', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'within',
  'without', 'would', 'yes', 'yet', 'you', 'your', 'yours',
]);

const MONTH_ABBR: Record<string, string> = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

const NAME_RE = /\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g;
const DATE_RE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),\s+(\d{4})\b/g;
const WORD_RE = /[a-z]+/g;

function chunkText(chunk: Chunk): string {
  return chunk.sentences.join(' ');
}

function extractNames(chunk: Chunk): Set<string> {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  NAME_RE.lastIndex = 0;
  while ((match = NAME_RE.exec(chunkText(chunk))) !== null) {
    // Skip pairs like "The Lobby" where the first word is a stopword
    // (usually sentence-initial capitalization, not a person's name).
    if (STOPWORDS.has(match[1].toLowerCase())) continue;
    names.add(`${match[1]} ${match[2]}`);
  }
  return names;
}

function extractDates(chunk: Chunk): Set<string> {
  const dates = new Set<string>();
  let match: RegExpExecArray | null;
  DATE_RE.lastIndex = 0;
  while ((match = DATE_RE.exec(chunkText(chunk))) !== null) {
    const month = MONTH_ABBR[match[1].slice(0, 3).toLowerCase()];
    const day = parseInt(match[2], 10);
    dates.add(`${month} ${day} ${match[3]}`);
  }
  return dates;
}

function stem(word: string): string {
  for (const suffix of ['s', 'ed', 'ing']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

function extractKeywords(chunk: Chunk): Set<string> {
  const keywords = new Set<string>();
  const words = chunkText(chunk).toLowerCase().match(WORD_RE) ?? [];
  for (const word of words) {
    if (word.length < 4 || STOPWORDS.has(word)) continue;
    keywords.add(stem(word));
  }
  return keywords;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const item of small) {
    if (large.has(item)) count++;
  }
  return count;
}

function numericId(chunk: Chunk): number {
  return parseInt(chunk.id.replace(/\D/g, ''), 10);
}

export function buildLinks(chunks: Chunk[]): Link[] {
  const infos = chunks.map((chunk) => ({
    chunk,
    names: extractNames(chunk),
    dates: extractDates(chunk),
    keywords: extractKeywords(chunk),
  }));
  const n = infos.length;

  // Candidate pairs meeting at least one linking criterion.
  const candidates: Array<{ a: number; b: number; shared: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sharedNames = intersectionSize(infos[i].names, infos[j].names);
      const sharedDates = intersectionSize(infos[i].dates, infos[j].dates);
      const sharedKeywords = intersectionSize(infos[i].keywords, infos[j].keywords);
      const linked =
        sharedNames > 0 || sharedDates > 0 || sharedKeywords >= KEYWORD_LINK_THRESHOLD;
      if (!linked) continue;
      candidates.push({ a: i, b: j, shared: sharedNames + sharedDates + sharedKeywords });
    }
  }

  // Keep the strongest pairs first; skip any pair once either endpoint is at the cap.
  candidates.sort((x, y) => y.shared - x.shared);
  const degree = new Array(n).fill(0);
  const chosen: Array<{ a: number; b: number }> = [];
  for (const candidate of candidates) {
    if (degree[candidate.a] >= LINK_CAP || degree[candidate.b] >= LINK_CAP) continue;
    degree[candidate.a]++;
    degree[candidate.b]++;
    chosen.push({ a: candidate.a, b: candidate.b });
  }

  // Connectivity: any chunk left with zero links gets linked to the chunk with
  // the highest keyword overlap, even when that overlap is below the threshold.
  // Among partners tied on overlap, prefer one that is still below the cap.
  for (let i = 0; i < n; i++) {
    if (degree[i] > 0) continue;
    let best = -1;
    let bestOverlap = -1;
    let bestHasCapacity = false;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const overlap = intersectionSize(infos[i].keywords, infos[j].keywords);
      const hasCapacity = degree[j] < LINK_CAP;
      if (overlap > bestOverlap || (overlap === bestOverlap && hasCapacity && !bestHasCapacity)) {
        bestOverlap = overlap;
        best = j;
        bestHasCapacity = hasCapacity;
      }
    }
    if (best === -1) continue;
    degree[i]++;
    degree[best]++;
    chosen.push({ a: i, b: best });
  }

  return chosen.map(({ a, b }) => {
    const [from, to] =
      numericId(infos[a].chunk) < numericId(infos[b].chunk)
        ? [infos[a].chunk.id, infos[b].chunk.id]
        : [infos[b].chunk.id, infos[a].chunk.id];
    return { from, to, strength: INITIAL_STRENGTH };
  });
}
