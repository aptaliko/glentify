import { eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { axisTypes } from '../src/db/schema';

const AXIS_TYPES: { key: string; label: string; lookupTable: string | null; hierarchical: boolean }[] = [
  { key: 'region', label: 'Περιοχή', lookupTable: 'regions', hierarchical: true },
  { key: 'rhythm', label: 'Ρυθμός', lookupTable: 'rhythms', hierarchical: false },
  { key: 'dromos', label: 'Δρόμος', lookupTable: 'dromoi', hierarchical: false },
  { key: 'composer', label: 'Συνθέτης', lookupTable: 'composers', hierarchical: false },
  { key: 'year', label: 'Χρονολογία', lookupTable: null, hierarchical: false },
];

async function main() {
  let created = 0;
  for (const at of AXIS_TYPES) {
    const existing = await db.select().from(axisTypes).where(eq(axisTypes.key, at.key));
    if (existing[0]) continue;
    await db.insert(axisTypes).values(at);
    created++;
  }
  console.log(`Axis types created: ${created}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
