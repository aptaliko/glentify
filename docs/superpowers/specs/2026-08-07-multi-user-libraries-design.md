# Multi-user Personal Libraries — Design

## Πλαίσιο και πρόβλημα

Σήμερα το Glentify έχει ένα ενιαίο, κοινό ρεπερτόριο πίσω από ένα μοναδικό password (`APP_PASSWORD`) — δεν υπάρχει έννοια "χρήστη". Ο στόχος είναι να ανοίξει η εφαρμογή ώστε **οποιοσδήποτε μουσικός** να μπορεί να φτιάξει τον δικό του λογαριασμό και να κρατάει το δικό του ρεπερτόριο (τραγούδια, μεταδεδομένα, προγράμματα, sessions), χωρίς να βλέπει ή να επηρεάζει τα δεδομένα άλλων χρηστών.

Ταυτόχρονα, το υπάρχον ρεπερτόριο του σημερινού χρήστη (ο οποίος γίνεται ο πρώτος `admin` λογαριασμός) είναι πολύτιμο ως σημείο εκκίνησης για νέους χρήστες: όταν κάποιος πάει να προσθέσει ένα τραγούδι που πιθανόν υπάρχει ήδη, θέλουμε να του προτείνουμε να αντιγράψει στίχους/μεταδεδομένα από εκεί αντί να τα πληκτρολογήσει από την αρχή — χωρίς όμως να κάνουμε ορατά προσωπικά δεδομένα/αρχεία άλλων απλών χρηστών μεταξύ τους.

Επιπλέον, κάποιοι χρήστες μπορεί να προτιμούν να ανεβάσουν φωτογραφία παρτιτούρας αντί να πληκτρολογήσουν στίχους.

## Στόχος (αυτού του σχεδιασμού)

- Πλήρεις, αυτοδιαχειριζόμενοι λογαριασμοί χρηστών (email + password), χωρίς εξωτερικό identity provider (OAuth κ.λπ.).
- Κάθε χρήστης έχει τη δική του βιβλιοθήκη τραγουδιών, τα δικά του προγράμματα (setlists) και sessions — πλήρως απομονωμένα από άλλους απλούς χρήστες.
- Το ρεπερτόριο του `admin` λογαριασμού λειτουργεί ως κοινή, μόνο-για-αντιγραφή "δεξαμενή προτάσεων" όταν οποιοσδήποτε χρήστης προσθέτει νέο τραγούδι.
- Υποστήριξη εικόνας παρτιτούρας ως εναλλακτική (ή συμπληρωματική) στους στίχους.
- Ανοιχτή εγγραφή, login/logout, password reset μέσω email, διαγραφή λογαριασμού (GDPR right-to-erasure).

## Εκτός εμβέλειας (ρητά)

- Sharing/collaboration μεταξύ δύο απλών χρηστών (π.χ. να δει ο ένας το setlist του άλλου). Η μόνη διάχυση περιεχομένου είναι μονόδρομη: από `admin` προς όλους, μέσω του suggestion-on-create.
- Επιβεβαίωση email στο signup (email verification link).
- OAuth/social login.
- Διαγραφή του μοναδικού `admin` λογαριασμού (βλ. Edge cases).

## Μοντέλο δεδομένων

### Νέος πίνακας `users`

```
users
  id, email (unique, not null), passwordHash (not null), role ('admin' | 'user', default 'user'), createdAt
```

`passwordHash`: Node's built-in `crypto.scrypt` (salt + hash), όχι εξωτερική βιβλιοθήκη bcrypt — μηδενικό νέο dependency.

### Νέος πίνακας `passwordResetTokens`

```
password_reset_tokens
  id, userId (FK -> users.id), tokenHash (not null), expiresAt (not null), usedAt (nullable), createdAt
```

Αποθηκεύεται μόνο το hash του token (ίδιο σκεπτικό με password), όχι το ίδιο το token. Single-use, λήξη 1 ώρα.

### Ownership στα υπάρχοντα entities

- `songs`, `programs`, `sessions`: προστίθεται `ownerId` (FK -> `users.id`, **not null** μετά το migration).
- `regions`, `rhythms`, `dromoi`, `genres`, `composers`: προστίθεται `ownerId` (FK -> `users.id`, **nullable**).
  - `NULL` = κοινή "baseline" εγγραφή, ορατή/επιλέξιμη από όλους. Μόνο `role: 'admin'` μπορεί να δημιουργήσει/επεξεργαστεί/διαγράψει `NULL`-owner εγγραφές.
  - Non-null = προσωπική προσθήκη του συγκεκριμένου χρήστη, ορατή/επιλέξιμη **μόνο** από αυτόν.
- `programSequences`, `sequenceSongs`, `sessionPlayedSongs`, `song_axis_values`: δεν αποκτούν δικό τους `ownerId` — η ιδιοκτησία τους είναι έμμεση, μέσω `programId`/`sessionId`/`songId` αντίστοιχα.

### `songs.imageUrl`

Νέα nullable στήλη `imageUrl` (text) στο `songs`. Optional, ανεξάρτητο από το `lyrics` — ένα τραγούδι μπορεί να έχει το ένα, το άλλο, και τα δύο, ή κανένα (προσωρινά, μέχρι να συμπληρωθεί).

## Auth & λογαριασμοί

- **Εγγραφή** (`/register`): email + password → νέος λογαριασμός `role: 'user'`, immediate login (καμία επιβεβαίωση email).
- **Login/logout** (`/login`): αντικαθιστά το σημερινό ενιαίο password-gate. Session cookie: signed token (`userId` + expiry), υπογεγραμμένο με HMAC μέσω του υπάρχοντος `AUTH_SECRET` — ίδια λογική με το σημερινό `src/lib/auth.ts`, πλέον parameterized ανά χρήστη αντί για ένα σταθερό token.
- **"Ξέχασα τον κωδικό"**: φόρμα email → αν υπάρχει λογαριασμός, δημιουργείται reset token και στέλνεται email μέσω **Resend** (δωρεάν tier: 3.000 emails/μήνα, 100/ημέρα) με link `/reset-password?token=...`. Η φόρμα δεν αποκαλύπτει αν το email υπάρχει ή όχι (ίδιο μήνυμα και στις δύο περιπτώσεις), για να μην γίνεται email enumeration.
  - **Dependency**: το Resend χρειάζεται verified sending domain για production παράδοση email — προαπαιτούμενο να υπάρχει domain δεμένο στο Vercel project πριν το deploy αυτού του feature.
- **Διαγραφή λογαριασμού**: ο χρήστης μπορεί να διαγράψει τον δικό του λογαριασμό από ρύθμιση προφίλ· cascade delete στα δικά του `songs`/`programs`/`sessions` (και ό,τι κρέμεται από αυτά: `programSequences`, `sequenceSongs`, `sessionPlayedSongs`) και στις προσωπικές του ταξινομίες.
- **Login errors**: γενικό μήνυμα ("λάθος email ή κωδικός") και στις δύο περιπτώσεις (άγνωστο email ή λάθος password) — καμία διάκριση, ίδιο σκεπτικό με το reset.

### Νέα env vars

- `AUTH_SECRET` — παραμένει, τώρα υπογράφει per-user session tokens.
- `RESEND_API_KEY` — νέο, για password reset emails.
- `BLOB_READ_WRITE_TOKEN` — νέο, αυτόματο όταν ενεργοποιείται Vercel Blob store στο project.
- `APP_PASSWORD` — **καταργείται**, αντικαθίσταται πλήρως από per-user login.

## Κοινές ταξινομίες — UX

- Dropdown επιλογής (π.χ. Ρυθμός, Περιοχή) σε κάθε χρήστη = baseline (`ownerId IS NULL`) ∪ οι δικές του (`ownerId = self`).
- Οι υπάρχουσες σελίδες `/admin/regions`, `/admin/rhythms`, `/admin/dromoi`, `/admin/genres`, `/admin/composers` παραμένουν όπως είναι, αλλά **μόνο για `role: 'admin'`** — διαχειρίζονται πλέον ρητά τη baseline λίστα (`ownerId = NULL`).
- Απλοί χρήστες **δεν** έχουν πρόσβαση σε αυτές τις σελίδες admin. Αντ' αυτού, μέσα στη φόρμα τραγουδιού, κάθε dropdown έχει μια επιλογή "+ Νέα τιμή" που δημιουργεί επιτόπου μια προσωπική εγγραφή (`ownerId = self`) — ελαφρύ inline flow, όχι ξεχωριστή σελίδα διαχείρισης.
- Προστασία διαγραφής (ήδη υπάρχει): μια ταξινομία δεν διαγράφεται αν χρησιμοποιείται ήδη από τραγούδι — ισχύει το ίδιο, τώρα φυσικά scoped ανά owner.
- **Αποδεκτός περιορισμός**: αν ένας χρήστης προσθέσει προσωπική τιμή με ίδιο όνομα με μια ήδη υπάρχουσα baseline τιμή (π.χ. δικό του "Καλαματιανός" ενώ υπάρχει ήδη κοινό), δεν γίνεται merge/dedup — εμφανίζονται ως ξεχωριστές επιλογές. Δεν αναμένεται να είναι συχνό, δεν αξίζει την πολυπλοκότητα τώρα.

## Suggestion-on-create

- Η "δεξαμενή προτάσεων" = όλα τα `songs` όπου `ownerId` ανήκει σε χρήστη με `role = 'admin'`.
- Στη φόρμα "νέο τραγούδι", καθώς πληκτρολογείται ο τίτλος, live αναζήτηση (`ILIKE`, debounced) πάνω σε αυτή τη δεξαμενή. Αποτελέσματα εμφανίζονται ως λίστα με τίτλο + genre.
- Κουμπί **"Χρησιμοποίησε ως βάση"** σε κάθε αποτέλεσμα: αντιγράφει `lyrics`, `notes`, `genreId`, και τις τιμές αξόνων (`song_axis_values`) στη φόρμα του νέου τραγουδιού — ο χρήστης τα βλέπει pre-filled και επεξεργάσιμα πριν το αποθηκεύσει. **Ανεξάρτητο, one-time copy** — καμία μόνιμη σύνδεση/reference μετά την αντιγραφή (μελλοντική διαγραφή ή αλλαγή του πρωτότυπου τραγουδιού του admin δεν επηρεάζει τα αντίγραφα).
- **Edge case**: αν κάποια τιμή άξονα στο πρωτότυπο δείχνει σε *προσωπική* (όχι baseline) ταξινομία του admin, παραλείπεται από την αντιγραφή (ο νέος χρήστης δεν τη βλέπει/δεν την επιλέγει έτσι κι αλλιώς) — αντιγράφονται τα υπόλοιπα πεδία κανονικά.

## Εικόνα παρτιτούρας

- Upload μέσω **Vercel Blob**, client-upload flow (το αρχείο πάει απευθείας browser → Blob store, όχι μέσω server function) — μηδενικό data-transfer κόστος στο upload, σύμφωνα με το Vercel pricing model.
- Δωρεάν όριο Hobby plan: **5GB storage / 100GB data transfer τον μήνα** — άνετο για λίγους χρήστες με φωτογραφίες παρτιτούρας. Καταγράφεται ρητά ως όριο, όχι "απεριόριστο".
- Client-side όριο μεγέθους αρχείου (π.χ. 10MB) πριν το upload, για προστασία από κατάχρηση.
- Public blob URLs με μη-μαντέψιμο τυχαίο path (default συμπεριφορά Vercel Blob) — όχι private-delivery proxy. Αποδεκτό, μιας που όλο το app είναι ήδη πίσω από login και οι εικόνες παρτιτούρας δεν είναι ευαίσθητο περιεχόμενο.
- Στο live session: αν το τρέχον τραγούδι έχει `imageUrl`, εμφανίζεται (zoomable) αντί για το κείμενο στίχων· αλλιώς οι στίχοι όπως σήμερα.

## Migration υπαρχόντων δεδομένων

One-off script (ίδιο πνεύμα με τα υπάρχοντα `scripts/migrate.ts`, `scripts/rebetika-import.ts`):

1. Δημιουργεί τον πρώτο πραγματικό λογαριασμό — `role: 'admin'` — με email/password που θα οριστούν κατά το τρέξιμο.
2. Backfill `ownerId = <νέος admin>` σε **όλα** τα υπάρχοντα `songs`, `programs`, `sessions` (που σήμερα δεν έχουν owner).
3. Οι υπάρχουσες εγγραφές `regions`/`rhythms`/`dromoi`/`genres`/`composers` δεν χρειάζονται backfill — μένουν με `ownerId = NULL`, γίνονται αυτόματα η κοινή baseline λίστα.

Μετά το migration, τίποτα δεν αλλάζει λειτουργικά για τον σημερινό χρήστη· το ρεπερτόριό του γίνεται επίσημα δικό του και ταυτόχρονα η δεξαμενή προτάσεων του σημείου "Suggestion-on-create".

## Edge cases & error handling

- Εγγραφή με ήδη υπαρκτό email → σφάλμα validation στη φόρμα.
- Reset token: λήγει μετά από 1 ώρα, single-use (μαρκάρεται `usedAt` μόλις χρησιμοποιηθεί, δεύτερη χρήση απορρίπτεται).
- Διαγραφή του μοναδικού `admin` λογαριασμού: **μπλοκάρεται** — το σύστημα χρειάζεται τουλάχιστον έναν `admin` για να έχει νόημα η κοινή baseline/δεξαμενή προτάσεων. Αν χρειαστεί ποτέ, θέλει δικό του σχεδιασμό (π.χ. μεταβίβαση ρόλου).
- Ασυνεπές upload εικόνας (π.χ. διακοπή σύνδεσης mid-upload): το τραγούδι απλά μένει χωρίς `imageUrl`, καμία μερική/corrupted εγγραφή στο DB (η στήλη ενημερώνεται μόνο μετά από επιβεβαιωμένο, ολοκληρωμένο upload).
- Διπλότυπο όνομα προσωπικής vs baseline ταξινομίας → επιτρέπεται, καμία συγχώνευση (βλ. παραπάνω).

## Testing

- Unit tests: password hashing/verification (scrypt), session token sign/verify, reset-token generation/verification/expiry/single-use, ownership-scoping helper (ποιες ταξινομίες είναι ορατές σε ποιον χρήστη), suggestion-pool query (μόνο `admin`-owned songs).
- Χειροκίνητη επαλήθευση σε browser/tablet: πλήρες register → login → logout, forgot-password → email → reset flow, ορατότητα baseline vs προσωπικών ταξινομιών ανά ρόλο, suggestion-on-create copy flow, upload και προβολή εικόνας παρτιτούρας στο live session, διαγραφή λογαριασμού με cascade.
