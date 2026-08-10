# Διαμοιρασμός Σταθερών Προγραμμάτων — Design

## Πλαίσιο και πρόβλημα

Μετά το multi-user-libraries, κάθε Σταθερό Πρόγραμμα (`programs`) ανήκει αποκλειστικά σε έναν χρήστη — `programs.ownerId` είναι `NOT NULL`, χωρίς καμία δομή διαμοιρασμού. Το μόνο υπάρχον precedent διάχυσης περιεχομένου (suggestion-on-create στα τραγούδια) είναι ρητά μονόδρομο, admin→όλους, one-time copy χωρίς μόνιμη σύνδεση — και το design doc του multi-user-libraries έθεσε ρητά εκτός εμβέλειας το sharing μεταξύ δύο απλών χρηστών.

Αυτό είναι το #3 από τα τρία features του mobile roadmap (βλ. `2026-08-09-mobile-fixed-programs-design.md` για το #2 timing). Ο George θέλει να μπορεί να μοιράζεται ένα πρόγραμμα με φίλους, με πλήρη αμφίδρομη συνεπεξεργασία — όχι απλή αντιγραφή.

## Στόχος

- Ένα Σταθερό Πρόγραμμα μπορεί να έχει πολλούς συνιδιοκτήτες (N-way, όχι μόνο 1+1) με ίσα δικαιώματα επεξεργασίας.
- Ο δημιουργός προσθέτει συνεργάτη γράφοντας το email του· αν υπάρχει λογαριασμός, η πρόσβαση ενεργοποιείται αμέσως, χωρίς αποδοχή/ειδοποίηση.
- Web: πλήρης συνεπεξεργασία. Android (offline): τα μοιρασμένα προγράμματα εμφανίζονται στον υπάρχοντα offline κατάλογο, view/play-only — καμία αλλαγή στο "μόνο ανάγνωση" μοντέλο που ήδη έχει το mobile.
- Μόνο ο δημιουργός διαχειρίζεται συνεργάτες και διαγράφει το πρόγραμμα. Κάθε συνεργάτης μπορεί να αποχωρήσει μόνος του.

## Εκτός εμβέλειας

- Αναζήτηση/κατάλογος χρηστών μέσα στην εφαρμογή — παραμένει μόνο "γράψε το email".
- Pending invites για email που δεν αντιστοιχεί σε λογαριασμό — άμεσο σφάλμα αντί για αναμονή.
- Real-time/live ενημέρωση αλλαγών (WebSocket κ.λπ.) — last-write-wins, ο χρήστης βλέπει την τελευταία αποθηκευμένη κατάσταση στο επόμενο fetch/refresh.
- Offline επεξεργασία μοιρασμένων (ή και δικών του) προγραμμάτων στο κινητό — παραμένει view-only, όπως σήμερα.
- Επέκταση της ορατότητας genre/axis (taxonomy) πέρα από τον ιδιοκτήτη τους — η προβολή προγράμματος δεν τα χρησιμοποιεί σήμερα (βλ. παρακάτω), οπότε δεν χρειάζεται.
- Sharing σε επίπεδο μεμονωμένου τραγουδιού ή sequence — μόνο ολόκληρο πρόγραμμα μοιράζεται.

## Μοντέλο δεδομένων

Νέος πίνακας, χωρίς αλλαγή σε υπάρχοντα schema:

```ts
export const programCollaborators = pgTable('program_collaborators', {
  id: serial('id').primaryKey(),
  programId: integer('program_id').notNull().references(() => programs.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at').notNull().defaultNow(),
});
```

`programs.ownerId` παραμένει `NOT NULL` αλλά αλλάζει σημασιολογικά σε **"δημιουργός"** — ο μόνος με δικαίωμα διαγραφής προγράμματος και διαχείρισης `programCollaborators`. Δεν χρειάζεται backfill· κάθε υπάρχον πρόγραμμα έχει ήδη δημιουργό (τον σημερινό owner) και μηδέν συνεργάτες.

Νέο query helper σε `src/db/queries/programs.ts`:

```ts
export type ProgramAccessRole = 'creator' | 'collaborator' | null;

export async function getProgramAccess(userId: number, programId: number): Promise<ProgramAccessRole> {
  const program = await db.select().from(programs).where(eq(programs.id, programId));
  if (!program[0]) return null;
  if (program[0].ownerId === userId) return 'creator';
  const collab = await db.select().from(programCollaborators)
    .where(and(eq(programCollaborators.programId, programId), eq(programCollaborators.userId, userId)));
  return collab[0] ? 'collaborator' : null;
}
```

## Πρόσβαση & δικαιώματα

| Ενέργεια | Δημιουργός | Συνεργάτης |
|---|---|---|
| Προβολή προγράμματος/sequences/τραγουδιών | ✅ | ✅ |
| Μετονομασία προγράμματος, add/remove/reorder sequences | ✅ | ✅ |
| Προσθήκη τραγουδιού σε sequence | ✅ (από δικά του τραγούδια) | ✅ (από δικά του τραγούδια) |
| Αφαίρεση/αναδιάταξη τραγουδιού σε sequence | ✅ | ✅ |
| Προσθήκη/αφαίρεση συνεργάτη | ✅ | ❌ |
| Αποχώρηση (αφαίρεση εαυτού) | — (δεν εφαρμόζεται) | ✅ |
| Διαγραφή ολόκληρου προγράμματος | ✅ | ❌ |

**Song picker κατά την προσθήκη:** ο υπάρχων μηχανισμός αναζήτησης τραγουδιών παραμένει scoped στα δικά του τραγούδια του χρήστη (`songs.ownerId = requester`) — κανένας δεν βλέπει ολόκληρη τη βιβλιοθήκη του άλλου μέσω του picker. Αυτό που μοιράζεται είναι μόνο ό,τι έχει ήδη μπει στο πρόγραμμα.

**Ανάγνωση τραγουδιών ήδη μέσα στο πρόγραμμα:** πλήρης πρόσβαση σε τίτλο/στίχους/τόνους, ανεξαρτήτως ποιος κατέχει το τραγούδι — επιβεβαιώθηκε στον κώδικα ότι `listSongsForSequence` ήδη κάνει `innerJoin` με `songs` και επιστρέφει ολόκληρη τη γραμμή, οπότε καμία μεταβολή δεν χρειάζεται εκεί: αρκεί να επιτραπεί η κλήση σε creator+collaborators (βλ. παρακάτω access-control fix). Επιβεβαιώθηκε επίσης ότι η σελίδα αναπαραγωγής (`src/app/programs/[id]/sequences/[seqId]/page.tsx`) δείχνει μόνο `title`, `maleKey`/`femaleKey`, `lyrics` — καθόλου genre/axis chips — άρα η ορατότητα taxonomy (nullable-`ownerId` regions/rhythms/dromoi/genres/composers) δεν χρειάζεται να επεκταθεί για τραγούδια συνεργατών.

## Access-control fix (προαπαιτούμενο, ξεχωριστό βήμα)

Η εξερεύνηση έδειξε ότι σήμερα μόνο το top-level `getProgramById`/`listPrograms` ελέγχει `ownerId`· τα εσωτερικά query functions (`listSequencesForProgram(programId)`, `getSequenceById(id)`, `addSongToSequence(sequenceId, songId)`, `removeSongFromSequence(...)`, `reorderSequenceSongs(...)`, κ.λπ.) δεν παίρνουν καθόλου `ownerId` — σήμερα προστατεύονται μόνο έμμεσα, επειδή κανείς άλλος δεν ξέρει τα ids. Μόλις ένα πρόγραμμα μοιραστεί, τα ids γίνονται γνωστά σε δεύτερο χρήστη, οπότε αυτό γίνεται το πραγματικό security boundary του feature.

Πρέπει να γίνει, **πριν** χτιστεί οποιοδήποτε UI διαχείρισης συνεργατών:

1. Κάθε route κάτω από `/api/programs/[id]/...` (top-level + sequences + songs-in-sequence) καλεί `getProgramAccess(userId, programId)` πρώτο και επιστρέφει 403/404 αν είναι `null`.
2. Οι ενέργειες creator-only (διαγραφή προγράμματος, add/remove collaborator) ελέγχουν ρητά `role === 'creator'`.
3. Επιβεβαίωση ότι το `x-user-id` header μπαίνει αποκλειστικά server-side από `src/proxy.ts` και δεν είναι client-settable (ισχύει ήδη σήμερα, αλλά αξίζει ρητή επιβεβαίωση τώρα που το header κουβαλάει όλο το βάρος του access control).

**Verification:** συνεργάτης μπορεί να επεξεργαστεί sequences/τραγούδια ενός μοιρασμένου προγράμματος· ένας τρίτος χρήστης (μη-μέλος) παίρνει 403 στο ίδιο endpoint.

## Προσθήκη / αφαίρεση συνεργάτη

- **Προσθήκη:** `POST /api/programs/[id]/collaborators` (creator-only), body `{ email }`. Αναζήτηση χρήστη με `eq(users.email, email)`· αν δεν βρεθεί → 404 με μήνυμα "Δεν βρέθηκε χρήστης με αυτό το email" (καμία δημιουργία pending state). Αν βρεθεί και δεν είναι ήδη ο δημιουργός/συνεργάτης → insert στο `programCollaborators`. Αν είναι ήδη συνεργάτης → 409, no-op.
- **Αφαίρεση από τον δημιουργό ή αποχώρηση:** `DELETE /api/programs/[id]/collaborators/[userId]`. Ο δημιουργός μπορεί να αφαιρέσει οποιονδήποτε συνεργάτη· ένας συνεργάτης μπορεί να αφαιρέσει μόνο τον εαυτό του (`userId === requesterId`). Ο δημιουργός δεν μπορεί να αφαιρεθεί μέσω αυτού του endpoint (πρέπει να διαγράψει το πρόγραμμα αν θέλει να "φύγει").
- Και στις δύο περιπτώσεις αφαίρεσης (creator-initiated ή leave) εκτελείται το cleanup του επόμενου τμήματος.

## Τύχη περιεχομένου κατά την αφαίρεση συνεργάτη

Όταν ένας συνεργάτης αφαιρεθεί (από τον δημιουργό ή μόνος του) **ή** διαγράψει τον λογαριασμό του (υπάρχον GDPR delete flow), όλες οι γραμμές `sequence_songs` που δείχνουν σε τραγούδια που του ανήκουν (`songs.ownerId = αυτός ο χρήστης`), μέσα σε sequences του συγκεκριμένου προγράμματος, διαγράφονται. Το πρόγραμμα και τα sequences του παραμένουν intact για τους υπόλοιπους — απλά χάνονται οι θέσεις των δικών του τραγουδιών.

```ts
export async function removeCollaboratorContent(programId: number, userId: number): Promise<void> {
  const sequences = await db.select({ id: programSequences.id }).from(programSequences)
    .where(eq(programSequences.programId, programId));
  const sequenceIds = sequences.map((s) => s.id);
  if (sequenceIds.length === 0) return;
  await db.delete(sequenceSongs).where(
    and(
      inArray(sequenceSongs.sequenceId, sequenceIds),
      inArray(sequenceSongs.songId, db.select({ id: songs.id }).from(songs).where(eq(songs.ownerId, userId)))
    )
  );
}
```

**GDPR delete flow (`src/app/api/account/route.ts` ή όπου υλοποιείται σήμερα):** επεκτείνεται ώστε, πριν διαγράψει τα δικά του `songs`, να βρίσκει όλα τα `program_collaborators.programId` όπου συμμετέχει *καθώς και* όλα τα προγράμματα **άλλων** χρηστών που περιέχουν δικά του τραγούδια σε sequences (μέσω `sequence_songs.songId → songs.ownerId`), και να τρέχει το ίδιο cleanup εκεί πριν προχωρήσει στη διαγραφή λογαριασμού. Αυτό είναι απαραίτητο γιατί σήμερα το GDPR flow σβήνει μόνο δεδομένα ιδιοκτησίας του ίδιου του χρήστη — τώρα πρέπει να αγγίξει και προγράμματα που δεν του ανήκουν.

## Λίστα προγραμμάτων (owned + shared)

`listPrograms(ownerId)` γίνεται `listAccessiblePrograms(userId)` — union ιδιόκτητων + όσων συμμετέχει ως συνεργάτης, με επιπλέον πεδία `role: 'creator' | 'collaborator'` και `collaborators: { id, email }[]` (για το badge). Χρησιμοποιείται τόσο από το web `/programs` όσο και από `listProgramsWithSequencesAndSongs` (reference-data).

## UI

- **`/programs`**: μία ενιαία λίστα, δικά + μοιρασμένα. Μοιρασμένα προγράμματα παίρνουν μικρό badge δίπλα στον τίτλο ("μοιράζεται με τον/την Χ", ή "+2 ακόμα" αν είναι πολλοί).
- **`/programs/[id]`**: νέα ενότητα "Συνεργάτες" — λίστα με email/όνομα, κουμπί αφαίρεσης ανά γραμμή (ορατό μόνο στον δημιουργό) και input προσθήκης με email (ορατό μόνο στον δημιουργό). Ο ίδιος ο χρήστης βλέπει κουμπί "Αποχώρηση" αν είναι συνεργάτης (όχι δημιουργός).
- Καμία αλλαγή στο layout σειρών/αναπαραγωγής — ήδη δουλεύει πάνω σε ό,τι επιστρέφει το API.

## Mobile (Android, offline)

- `GET /api/reference-data` περνάει σε `listAccessiblePrograms(userId)` αντί για `listPrograms(ownerId)` — έτσι το `programs` payload περιλαμβάνει και τα μοιρασμένα.
- Το `songs` array του ίδιου payload πρέπει να συμπεριλάβει και τραγούδια που ανήκουν σε συνεργάτες αλλά αναφέρονται σε sequences προσβάσιμων προγραμμάτων — αλλιώς το client-side lookup `songIds.map(id => songs.find(...))` (βλ. `2026-08-09-mobile-fixed-programs-design.md`) αποτυγχάνει σιωπηλά για τραγούδια που δεν ανήκουν στον χρήστη. Τα `genres`/`axisValues`/λοιπά taxonomy arrays **δεν** αλλάζουν εμβέλεια (βλ. "Εκτός εμβέλειας").
- Καμία αλλαγή στο native UI (`programs/local/*`) — ήδη view-only, ήδη κάνει lookup by id, δεν διακρίνει owned/shared.
- Staleness μετά από share: όπως και κάθε άλλη αλλαγή, ορατή στο κινητό μόνο μετά το επόμενο "Συγχρονισμός τραγουδιών" — ίδιο μοτίβο με το mobile-fixed-programs.

## Ταυτόχρονες αλλαγές (conflict handling)

Last-write-wins, χωρίς locking, χωρίς version/updatedAt έλεγχο. Δεδομένου του πραγματικού αριθμού χρηστών (George + λίγοι φίλοι), ταυτόχρονη επεξεργασία του ίδιου προγράμματος είναι σπάνιο σενάριο· δεν αξίζει η πολυπλοκότητα locking/merge σε v1.

## Edge cases

- Δημιουργός γράφει το δικό του email ή email ήδη συνεργάτη → 409/no-op με μήνυμα.
- Πρόγραμμα με μηδέν συνεργάτες συμπεριφέρεται ακριβώς όπως σήμερα (καμία αλλαγή συμπεριφοράς για μη-μοιρασμένα προγράμματα).
- Αφαίρεση τελευταίου τραγουδιού μιας σειράς λόγω cleanup συνεργάτη → η σειρά μένει, απλά άδεια (ίδιο state με το υπάρχον "καμία σειρά δεν έχει τραγούδια" empty message).
- Διαγραφή προγράμματος από τον δημιουργό → cascade διαγραφή `programCollaborators` (μέσω FK `onDelete: 'cascade'`), `programSequences`, `sequenceSongs` — ίδιο με το υπάρχον `deleteProgram`.

## Testing

- Unit/integration στα query functions: `getProgramAccess` επιστρέφει σωστό role· `removeCollaboratorContent` αφαιρεί μόνο τα σωστά `sequence_songs`.
- API-level: συνεργάτης μπορεί να επεξεργαστεί sequences/τραγούδια· μη-μέλος παίρνει 403· μόνο ο δημιουργός μπορεί να διαγράψει το πρόγραμμα ή να αφαιρέσει άλλον συνεργάτη.
- Χειροκίνητη επαλήθευση με τους δύο υπάρχοντες λογαριασμούς (`farantosgeo@gmail.com`, `farantosee@gmail.com`): προσθήκη συνεργάτη, συνεπεξεργασία και από τους δύο, αποχώρηση, GDPR delete cleanup.
- Mobile: sync και στους δύο λογαριασμούς, επιβεβαίωση ότι μοιρασμένο πρόγραμμα εμφανίζεται και αναπαράγεται σωστά offline (airplane mode) σε και τους δύο.
