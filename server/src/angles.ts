import { chatJSON } from './llm';

interface Angle {
  name: string;
  description: string;
}

const SYSTEM_PROMPT = `A lawyer will search case documents. Produce exactly 3 search angles that would find evidence SUPPORTING the argument and exactly 3 that would find evidence REFUTING it. Each angle finds a different kind of evidence (e.g. who knew what and when; incentives; timeline contradictions; third-party sign-offs). Respond with JSON only: {"support":[{"name","description"}],"refute":[{"name","description"}]}. Names are short snake_case. Refute names MUST start with "refute_".`;

function normalize(list: unknown, label: string): Angle[] {
  if (!Array.isArray(list)) {
    throw new Error(`angles.${label} is not an array`);
  }
  if (list.length < 3) {
    throw new Error(`expected 3 ${label} angles, got ${list.length}`);
  }
  return list.slice(0, 3).map((item: any) => ({
    name: String(item?.name ?? '').trim(),
    description: String(item?.description ?? '').trim(),
  }));
}

export async function makeAngles(
  argument: string,
): Promise<{ support: Angle[]; refute: Angle[] }> {
  const raw = await chatJSON(SYSTEM_PROMPT, `Argument: ${argument}`, `angles|${argument}`);

  const support = normalize(raw?.support, 'support');
  const refute = normalize(raw?.refute, 'refute').map((angle) => ({
    ...angle,
    name: angle.name.startsWith('refute_') ? angle.name : `refute_${angle.name}`,
  }));

  return { support, refute };
}
