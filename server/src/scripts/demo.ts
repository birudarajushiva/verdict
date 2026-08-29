import { runVerdictLoop } from '../orchestrator';

const ARGUMENT =
  'Kestrel knew the controller firmware was defective before signing on March 3';

const first = await runVerdictLoop(ARGUMENT, 'demo');

// Per-tick, per-side: summary line and number of finds.
for (let i = 0; i < first.support.ticks.length; i++) {
  for (const side of ['support', 'refute'] as const) {
    const tick = first[side].ticks[i];
    console.log(`${side} ${tick.summary} finds=${tick.finds.length}`);
  }
}

console.log(`\nsupport path: ${first.support.sources.join(' → ') || '(empty)'}`);
console.log(`refute  path: ${first.refute.sources.join(' → ') || '(empty)'}`);
console.log(`overlap: ${first.overlap.length ? first.overlap.join(', ') : '(none)'}`);

// Task table.
console.log('\ntasks:');
for (const t of first.tasks) {
  console.log(
    `${t.id} ${t.kind} ${t.side} tick${t.tick} ${t.status} $${t.cost.toFixed(5)} boosts=${t.boosts.length}`,
  );
}

// Brief.
const b = first.brief;
console.log('\nbrief:');
console.log(`  verdictScore: ${b.verdictScore}`);
console.log(`  strongestFor: ${b.strongestFor.join(' | ')}`);
console.log(`  strongestAgainst: ${b.strongestAgainst.join(' | ')}`);
console.log(`  contested: ${b.contested.join(' | ')}`);
console.log(`  weakestLinkFor: ${b.weakestLinkFor}`);
console.log(`  weakestLinkAgainst: ${b.weakestLinkAgainst}`);
for (const entry of b.timeline) {
  console.log(`  timeline: ${entry.date} — ${entry.event} [${entry.doc}]`);
}
console.log(`  nextSteps:`);
for (const step of b.nextSteps) console.log(`    - ${step}`);
console.log(`  humanReviewQueue: ${b.humanReviewQueue.join(', ') || '(empty)'}`);

// Second run: byte-identical JSON (cache + seed).
const second = await runVerdictLoop(ARGUMENT, 'demo');

const strategistBoostsOn = (side: 'support' | 'refute'): boolean =>
  first[side].ticks.some((t) =>
    t.boostsApplied.some((boost) => boost.reason.startsWith('strategist:')),
  );

const assert1 = first.support.sources.some(
  (doc) => doc === 'firmware_changelog.txt' || doc === 'hr_memo.txt',
);
const assert2 = first.refute.sources.some(
  (doc) => doc === 'email_04.txt' || doc === 'qa_report.txt',
);
const assert3 = strategistBoostsOn('support') && strategistBoostsOn('refute');
const assert4 = first.tasks.some(
  (t) => t.kind === 'factcheck' && (t.output?.flags.length ?? 0) > 0,
);
const assert5 = JSON.stringify(first) === JSON.stringify(second);
const assert6 = first.support.ticks.some((t) =>
  t.finds.some((f) => f.doc === 'firmware_changelog.txt' || f.doc === 'hr_memo.txt'),
);
const assert7 = first.refute.ticks.some((t) =>
  t.finds.some((f) => f.doc === 'email_04.txt' || f.doc === 'qa_report.txt'),
);

console.log(`\n1. support path reaches firmware_changelog.txt or hr_memo.txt: ${assert1 ? 'PASS' : 'FAIL'}`);
console.log(`2. refute path reaches email_04.txt or qa_report.txt: ${assert2 ? 'PASS' : 'FAIL'}`);
console.log(`3. strategist boost applied on each side: ${assert3 ? 'PASS' : 'FAIL'}`);
console.log(`4. at least one factcheck flag exists: ${assert4 ? 'PASS' : 'FAIL'}`);
console.log(`5. second run returns byte-identical JSON: ${assert5 ? 'PASS' : 'FAIL'}`);
console.log(`6. support find from firmware_changelog.txt or hr_memo.txt: ${assert6 ? 'PASS' : 'FAIL'}`);
console.log(`7. refute find from email_04.txt or qa_report.txt: ${assert7 ? 'PASS' : 'FAIL'}`);

if (!assert1 || !assert2 || !assert3 || !assert4 || !assert5 || !assert6 || !assert7) {
  process.exit(1);
}
