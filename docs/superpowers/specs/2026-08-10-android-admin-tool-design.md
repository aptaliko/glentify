# Admin Εργαλείο στο Android — Design

## Πλαίσιο και πρόβλημα

Σήμερα το `/admin/*` (Τραγούδια, Προγράμματα, Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη) είναι αποκλειστικά web — το `scripts/build-mobile.sh` το αφαιρεί εξ ολοκλήρου (`rm -rf .mobile-build/src/app/admin`) πριν το static export. Παρά το όνομα "admin", δεν είναι πραγματικά περιορισμένο σε admin ρόλο — δεν υπάρχει κανένας έλεγχος `role` πουθενά (ούτε στο `AdminLayout`, ούτε στο `proxy.ts`) — είναι απλώς το CRUD interface όπου κάθε λογαριασμός διαχειρίζεται τα δικά του τραγούδια/προγράμματα/ταξινομία.

Το mobile build είναι Capacitor static export **χωρίς κανέναν server** (`output: 'export'`, `NEXT_PUBLIC_API_BASE_URL` δείχνει στο ήδη deployed `https://glentify-kohl.vercel.app`). Το native app καλεί ήδη το production API με επιτυχία, αλλά **μόνο με GET** (το sync — `GET /api/reference-data`). Αυτό το feature θα είναι το πρώτο POST/PATCH/DELETE cross-origin request που κάνει ποτέ το native shell.

Αυτό είναι το #2 από τα δύο εναπομείναντα features του mobile roadmap (μετά το program-sharing, βλ. [[mobile-roadmap]]).

## Στόχος

- Πλήρης λειτουργική ισοτιμία με το web `/admin/*` στο Android — και οι 7 ενότητες, όχι υποσύνολο.
- **Thin client**: κάθε ενέργεια (create/update/delete) καλεί απευθείας το ήδη-deployed API, σε πραγματικό χρόνο. Καμία offline ουρά εγγραφών, κανένα sync-back — αν δεν υπάρχει σύνδεση, η ενέργεια αποτυγχάνει με το ίδιο μήνυμα σφάλματος που θα έδειχνε και το web.
- Image upload (Vercel Blob) για τραγούδια περιλαμβάνεται εξ αρχής, όχι αργότερα.
- Νέο κουμπί "Διαχείριση" στην αρχική σελίδα (native-only), δίπλα στα "Ξεκίνα Γλέντι" / "Σταθερά προγράμματα".

## Εκτός εμβέλειας

- Οποιαδήποτε offline λειτουργία (δημιουργία/επεξεργασία χωρίς σύνδεση) — αυτό είναι το ξεχωριστό feature #1 του roadmap (offline creation/sync-back), δεν συγχωνεύεται εδώ.
- Περιορισμός πρόσβασης ανά ρόλο — δεν υπάρχει σήμερα ούτε στο web, δεν εισάγεται τώρα.
- Αλλαγές στο ίδιο το API/server-side — το feature είναι αμιγώς client-side (νέες native σελίδες + δικτυακό wrapper πάνω στο ήδη υπάρχον API).
- iOS-specific δουλειά (η αλλαγή γίνεται στο κοινό `src/`, οπότε το iOS build θα την πάρει κι αυτό, αλλά δεν δοκιμάζεται εδώ — ίδιο σκεπτικό με τα προηγούμενα mobile specs).

## Δικτυακή υποδομή: authenticated fetch wrapper

Σήμερα υπάρχει **ένα** cross-origin call στο native (`handleSync` στο `src/app/page.tsx`), και προσθέτει χειροκίνητα `Authorization: Bearer <token>` επειδή το `glentify_auth` cookie δεν ταξιδεύει από το `capacitor://localhost` origin. Δεν υπάρχει κανένα reusable wrapper — κάθε νέα σελίδα διαχείρισης θα χρειαστεί το ίδιο.

Νέο `src/lib/nativeApiFetch.ts`:

```ts
import { apiUrl } from './apiClient';
import { getAuthToken } from './authToken';

export async function nativeApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(apiUrl(path), { ...init, headers });
}
```

Στο web, `getAuthToken()` επιστρέφει πάντα `null` (κανείς δεν αποθηκεύει token εκεί σήμερα — μόνο το native login/register flow το κάνει), οπότε ο wrapper λειτουργεί αδρανώς: το cookie συνεχίζει να κάνει τη δουλειά όπως πάντα. Όλες οι νέες/μεταφερμένες σελίδες διαχείρισης χρησιμοποιούν `nativeApiFetch` αντί για ωμό `fetch`.

**Άγνωστο που πρέπει να επαληθευτεί πρώτο, πριν χτιστεί οτιδήποτε πάνω του:** το `proxy.ts` *φαίνεται* να υποστηρίζει ήδη POST/PATCH/DELETE cross-origin (χειρίζεται OPTIONS→204, επιτρέπει `Authorization, Content-Type` headers και όλες τις μεθόδους), αλλά αυτό δεν έχει δοκιμαστεί ποτέ από πραγματικό native shell — μόνο GET έχει δοκιμαστεί. Το πρώτο task του plan πρέπει να είναι ένα ελάχιστο πείραμα: ένα πραγματικό PATCH από συσκευή/emulator σε ένα ήδη υπάρχον endpoint, πριν γραφτεί οποιαδήποτε από τις 7 ενότητες.

## Image upload: δεύτερο, ξεχωριστό ρίσκο

Η φόρμα τραγουδιού καλεί σήμερα:
```ts
const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/songs/image-upload' });
```
Δύο προβλήματα στο native:
1. `handleUploadUrl` είναι **σχετικό** path — σε native origin (`capacitor://localhost`) σπάει, γιατί δεν υπάρχει τοπικός server. Πρέπει να γίνει `apiUrl('/api/songs/image-upload')` (απόλυτο URL).
2. Το `/api/songs/image-upload` route κάθεται πίσω από το `proxy.ts`'s auth gate (βλ. το ήδη υπάρχον σχόλιο στον κώδικα) — χρειάζεται το ίδιο Bearer header. Δεν είναι ξεκάθαρο αν το `@vercel/blob/client`'s `upload()` SDK δέχεται custom headers στο `handleUploadUrl` request out of the box· χρειάζεται έλεγχος του SDK API.

Ξεχωριστό πείραμα/επαλήθευση στο plan, μετά το γενικό CRUD πείραμα — αν το SDK δεν υποστηρίζει custom headers καθαρά, θα χρειαστεί wrapper γύρω από το `handleUploadUrl` call (π.χ. custom `fetch` injection αν το SDK το επιτρέπει, ή προσωρινό workaround).

## Routing: hybrid — μόνο τα δύο dynamic routes αντιγράφονται

Από τις 7 ενότητες, μόνο 2 έχουν dynamic (`[id]`) routes που δεν δουλεύουν σε static export:

| Ενότητα | Routes | Native πλάνο |
|---|---|---|
| Περιοχές, Ρυθμοί, Δρόμοι, Συνθέτες, Είδη | `admin/<name>/page.tsx` (static, list+inline edit) | Αυτούσιες στο mobile bundle — μόνο swap `fetch` → `nativeApiFetch` |
| Τραγούδια | `admin/songs/page.tsx` (list, static), `admin/songs/new/page.tsx` (static) | Αυτούσιες, ίδιο swap |
| Τραγούδια | `admin/songs/[id]/page.tsx` (**dynamic** — επεξεργασία) | Νέο static native δίδυμο: `admin/local/songs/edit/page.tsx` |
| Προγράμματα | `admin/programs/page.tsx` (list, static) | Αυτούσια, ίδιο swap· τα links προς `[id]` γίνονται platform-aware (native: αποθήκευση id στο preferencesStore + push σε static route· web: κανονικό `<Link href>`) |
| Προγράμματα | `admin/programs/[id]/page.tsx` (**dynamic** — sequences, τραγούδια, Συνεργάτες) | Νέο static native δίδυμο: `admin/local/programs/edit/page.tsx` |

Τα δύο νέα native δίδυμα ακολουθούν ακριβώς το pattern του `programs/local/*` (mobile-fixed-programs): το "ποιο song/πρόγραμμα επεξεργάζομαι" περνάει μέσω `preferencesStore` (νέα κλειδιά, π.χ. `selectedEditSongId`/`selectedEditProgramId` στο ήδη υπάρχον `localProgramsStore.ts` ή αντίστοιχο), όχι URL param. Το `admin/local/programs/edit` περιλαμβάνει την ίδια λειτουργικότητα με το web `admin/programs/[id]` σήμερα — sequences, τραγούδια μέσα σε sequence, **και** την ενότητα "Συνεργάτες" (πρόσθεση/αφαίρεση/αποχώρηση) που μόλις χτίστηκε στο πρόγραμμα διαμοιρασμού.

## Αλλαγές στο `scripts/build-mobile.sh`

Σήμερα: `rm -rf .mobile-build/src/app/admin` (διαγράφει τα πάντα). Αλλάζει σε στοχευμένη διαγραφή μόνο των δύο dynamic φακέλων:

```bash
rm -rf ".mobile-build/src/app/admin/songs/[id]"
rm -rf ".mobile-build/src/app/admin/programs/[id]"
```

Νέος αμυντικός έλεγχος, ίδιο μοτίβο με τους ήδη υπάρχοντες για `api`/`session/[id]`:

```bash
if [ -d ".mobile-build/src/app/admin/songs/[id]" ] || [ -d ".mobile-build/src/app/admin/programs/[id]" ]; then
  echo "build-mobile: a dynamic admin route survived staging, aborting" >&2
  exit 1
fi
```

## Εξάρτηση από το εκκρεμές push

Τα 12 commits του program-sharing feature (`GET /api/account`, τα collaborator routes) είναι ακόμα unpushed στο `origin/main` — το native testing δοκιμάζει το **deployed** API, όχι το local. Καμία επαλήθευση της native σελίδας "Συνεργάτες" δεν μπορεί να τρέξει πριν γίνει αυτό το push. Το testing section του plan θα το δηλώνει ρητά ως προαπαιτούμενο πριν εκείνο το συγκεκριμένο βήμα, όχι να γράψει βήματα που δεν μπορούν να τρέξουν ακόμα.

## UI / Home page

Νέο κουμπί "Διαχείριση" στο `src/app/page.tsx` (native-only, `<Link href="/admin/songs">` ή αντίστοιχο entry point), δίπλα στα ήδη υπάρχοντα "Ξεκίνα Γλέντι"/"Σταθερά προγράμματα" κουμπιά.

## Edge cases & error handling

- Καμία σύνδεση κατά την αποθήκευση: το ίδιο μήνυμα σφάλματος που δείχνει ήδη το web σήμερα (κάθε φόρμα έχει ήδη `try/catch`/`res.ok` check) — καμία νέα "offline" λογική.
- 401 σε οποιοδήποτε admin fetch (ληγμένο token): ίδιο σκεπτικό με το `handleSync`'s `unauthorized` state — καθαρισμός token, ανακατεύθυνση σε login.
- Άδειες λίστες (καμία σειρά/τραγούδι/συνεργάτης): ίδια empty-state μηνύματα με το web, ήδη υπάρχοντα per section.

## Testing

- Χειροκίνητη επαλήθευση σε πραγματική συσκευή (όπως και το υπόλοιπο mobile flow, δεν υπάρχει test harness για Capacitor/native σε αυτό το repo).
- **Πρώτο, αυτοτελές βήμα:** επαλήθευση ότι ένα PATCH cross-origin περνάει σωστά (CORS preflight) από πραγματικό native shell.
- **Δεύτερο, ξεχωριστό βήμα:** επαλήθευση του image upload flow (absolute URL + auth header) από native.
- Η επαλήθευση της "Συνεργάτες" σελίδας περιμένει το push των εκκρεμών 12 commits στο production.
- `npm run build:mobile` πρέπει να ολοκληρώνεται χωρίς σφάλμα και οι αμυντικοί έλεγχοι του script (παλιοί + νέοι) να περνάνε.
