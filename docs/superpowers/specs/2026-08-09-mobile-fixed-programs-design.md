# Σταθερά Προγράμματα στο Android (offline) — Design

## Πλαίσιο και πρόβλημα

Το mobile build (Capacitor/Android) υποστηρίζει σήμερα μόνο δύο λειτουργίες: "Ξεκίνα Γλέντι" (live session, offline-first μέσω τοπικού cache) και "Συγχρονισμός τραγουδιών" (κατεβάζει `ReferenceData` από `/api/reference-data` και το αποθηκεύει σε IndexedDB). Το `scripts/build-mobile.sh` αφαιρεί ρητά `src/app/admin`, `src/app/programs`, και `src/app/api` πριν χτίσει το static export — άρα τα Σταθερά Προγράμματα (προκαθορισμένες, διατεταγμένες λίστες τραγουδιών) δεν υπάρχουν καθόλου στο κινητό σήμερα.

Ο χρήστης θέλει να μπορεί να βλέπει και να αναπαράγει τα ήδη-φτιαγμένα προγράμματά του από το κινητό, με την ίδια offline-first λογική που έχει ήδη το "Ξεκίνα Γλέντι".

## Στόχος

- Προβολή (όχι επεξεργασία) των Σταθερών Προγραμμάτων από το Android app, offline μετά από sync.
- Ίδια εμπειρία πλοήγησης με το web (`/programs` → σειρές με προεπισκόπηση → αναπαραγωγή με προηγούμενο/επόμενο), προσαρμοσμένη στους περιορισμούς του static export.
- Ενσωμάτωση στο υπάρχον κουμπί "Συγχρονισμός τραγουδιών" — όχι νέο, ξεχωριστό sync flow.

## Εκτός εμβέλειας

- Δημιουργία/επεξεργασία προγραμμάτων από το κινητό (μένει αποκλειστικά web, `/admin/programs`).
- Οποιαδήποτε αλλαγή στο web `/programs/*` flow — μένει όπως είναι, ζωντανό μέσω API.
- iOS-specific δουλειά (η αλλαγή γίνεται στο κοινό `src/`, οπότε το iOS build θα την πάρει κι αυτό, αλλά δεν δοκιμάζεται εδώ).

## Μοντέλο δεδομένων: επέκταση `ReferenceData`

`src/lib/referenceData.ts` αποκτά ένα νέο πεδίο, **κανονικοποιημένο** (όχι πλήρη αντίγραφα τραγουδιών — τα τραγούδια είναι ήδη στο ίδιο payload, συνδέονται με id, ίδιο σκεπτικό με το υπάρχον `axisValues`):

```ts
export interface ReferenceData {
  songs: SongRow[];
  axisValues: SongAxisValueRow[];
  regions: RegionRow[];
  rhythms: RhythmRow[];
  dromoi: DromosRow[];
  composers: ComposerRow[];
  axisTypes: AxisTypeRow[];
  genres: GenreRow[];
  programs: OfflineProgram[]; // νέο
}

export interface OfflineProgram {
  id: number;
  title: string;
  sequences: OfflineSequence[]; // ήδη σε σειρά προβολής (server-side orderBy position, όπως σήμερα)
}

export interface OfflineSequence {
  id: number;
  title: string;
  songIds: number[]; // σε σειρά αναπαραγωγής
}
```

`GET /api/reference-data` προσθέτει `programs` στο payload του, χτισμένο από τα ήδη υπάρχοντα `listPrograms(ownerId)` / `listSequencesForProgram` / `listSongsForSequence`. Το `offlineCache.ts` δεν χρειάζεται καμία αλλαγή — αποθηκεύει ήδη ολόκληρο το `ReferenceData` object σαν ένα blob.

## Native UI & routing

Τα δυναμικά routes (`/programs/[id]`, `.../sequences/[seqId]`) δεν δουλεύουν σε static export χωρίς server — ακολουθούμε το ίδιο μοτίβο με το υπάρχον `/session/local`: **στατικές** σελίδες που διαβάζουν "ποιο πρόγραμμα/σειρά κοιτάω" από τοπική αποθήκευση (`preferencesStore`), όχι από URL params.

- **`src/app/programs/local/page.tsx`** — λίστα προγραμμάτων από το cache. Tap σε πρόγραμμα → αποθηκεύει `selectedProgramId` στο `preferencesStore` → πλοήγηση σε `/programs/local/program`.
- **`src/app/programs/local/program/page.tsx`** — διαβάζει `selectedProgramId`, δείχνει τις σειρές του με προεπισκόπηση (ίδιο layout με `src/app/programs/[id]/page.tsx`, αλλά τα δεδομένα έρχονται από cache, όχι fetch). Tap σε σειρά → αποθηκεύει `selectedSequenceId` → πλοήγηση σε `/programs/local/sequence`.
- **`src/app/programs/local/sequence/page.tsx`** — διαβάζει `selectedSequenceId`, δείχνει αναπαραγωγή με προηγούμενο/επόμενο (ίδιο layout με `src/app/programs/[id]/sequences/[seqId]/page.tsx`). Το index του τρέχοντος τραγουδιού μένει σε in-memory `useState` (δεν χρειάζεται persistence — ίδια συμπεριφορά με το web, restart από την αρχή σε reload).

Τα τραγούδια μέσα στη σειρά προκύπτουν με lookup: `sequence.songIds.map(id => referenceData.songs.find(s => s.id === id))` — καμία επιπλέον κλήση δικτύου.

**Home page (`src/app/page.tsx`):** νέο κουμπί "Σταθερά προγράμματα" (`native`-only, δίπλα στο "Ξεκίνα Γλέντι"), `<Link href="/programs/local">`.

**Άδειο cache / κανένα πρόγραμμα:** η λίστα δείχνει μήνυμα "Δεν υπάρχουν προγράμματα" (ίδιο μήνυμα με το web όταν `programs.length === 0`) — όχι σφάλμα, ίδιο pattern με τα υπάρχοντα empty states.

## Αλλαγές στο `scripts/build-mobile.sh`

Σήμερα: `rm -rf .mobile-build/src/app/programs` (διαγράφει τα πάντα). Αλλάζει σε στοχευμένη διαγραφή μόνο των web/dynamic κομματιών, κρατώντας το νέο `programs/local/`:

```bash
rm -rf ".mobile-build/src/app/programs/[id]"
rm -f ".mobile-build/src/app/programs/page.tsx"
```

(Το `admin/programs` παραμένει μέσα στο ήδη υπάρχον `rm -rf .mobile-build/src/app/admin`, δεν αλλάζει.)

Οι δύο ήδη υπάρχοντες αμυντικοί έλεγχοι του script (`if [ -d .mobile-build/src/app/api ]; then ... abort` κ.λπ.) μένουν ως έχουν — δεν χρειάζεται νέος, μιας που δεν προστίθεται κανένα server-only route στο mobile bundle.

## Edge cases & error handling

- Χρήστης πατάει "Σταθερά προγράμματα" **πριν** κάνει ποτέ sync: το cache είναι κενό, η λίστα δείχνει το ίδιο empty-state μήνυμα (όχι crash) — ίδιο σκεπτικό με το πώς το "Ξεκίνα Γλέντι" χειρίζεται ήδη ένα άδειο cache.
- Πρόγραμμα/σειρά διαγράφηκε στο web **μετά** το τελευταίο sync στο κινητό: ο χρήστης βλέπει την παλιά (stale) εκδοχή μέχρι το επόμενο sync — αποδεκτό, ίδια συμπεριφορά με το πώς ήδη λειτουργεί το sync για τα τραγούδια.
- Σειρά χωρίς τραγούδια: ίδιο μήνυμα με το web ("Δεν έχουν προστεθεί τραγούδια σε αυτή τη σειρά").
- `selectedProgramId`/`selectedSequenceId` δείχνουν σε πρόγραμμα/σειρά που δεν υπάρχει πια στο τρέχον cache (π.χ. διαγράφηκε): η σελίδα δείχνει το ίδιο "δεν βρέθηκε" state με άδειο αποτέλεσμα από το lookup, με σύνδεσμο πίσω στη λίστα — όχι crash.

## Testing

- Χειροκίνητη επαλήθευση σε πραγματική συσκευή (όπως και το υπόλοιπο mobile flow, δεν υπάρχει test harness για Capacitor/native σε αυτό το repo): sync → "Σταθερά προγράμματα" → λίστα → πρόγραμμα → σειρά → αναπαραγωγή με προηγούμενο/επόμενο → επιβεβαίωση ότι λειτουργεί με **airplane mode ενεργό** (το ζητούμενο: offline).
- `npm run build:mobile` πρέπει να ολοκληρώνεται χωρίς σφάλμα και οι δύο αμυντικοί έλεγχοι του script να περνάνε.
