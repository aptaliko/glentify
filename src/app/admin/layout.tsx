import Link from 'next/link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base-200">
      <nav className="navbar flex-wrap gap-2 bg-base-100 shadow-sm">
        <Link href="/admin/songs" className="btn btn-ghost btn-sm">Τραγούδια</Link>
        <Link href="/admin/programs" className="btn btn-ghost btn-sm">Προγράμματα</Link>
        <Link href="/admin/regions" className="btn btn-ghost btn-sm">Περιοχές</Link>
        <Link href="/admin/rhythms" className="btn btn-ghost btn-sm">Ρυθμοί</Link>
        <Link href="/admin/dromoi" className="btn btn-ghost btn-sm">Δρόμοι</Link>
        <Link href="/admin/composers" className="btn btn-ghost btn-sm">Συνθέτες</Link>
        <Link href="/admin/genres" className="btn btn-ghost btn-sm">Είδη</Link>
        <Link href="/" className="btn btn-ghost btn-sm ml-auto">Αρχική</Link>
      </nav>
      <main className="p-4">{children}</main>
    </div>
  );
}
