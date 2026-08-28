import { NextRequest, NextResponse } from 'next/server';
import { getProgramById, getProgramAccess, listSequencesForProgram, listSongsForSequence } from '@/db/queries/programs';
import { getUserId } from '@/lib/requestUser';
import { generateProgramPdf, type ProgramPdfSequence } from '@/lib/programPdf';
import { sanitizeFilename } from '@/lib/pdfFilename';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = getUserId(request);
  const { id } = await params;
  const programId = Number(id);

  const role = await getProgramAccess(userId, programId);
  if (!role) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });

  const program = await getProgramById(programId);
  if (!program) return NextResponse.json({ error: 'Δεν βρέθηκε' }, { status: 404 });

  const sequenceRows = await listSequencesForProgram(programId);
  const sequences: ProgramPdfSequence[] = await Promise.all(
    sequenceRows.map(async (seq) => {
      const entries = await listSongsForSequence(seq.id);
      return { title: seq.title, songs: entries.map((e) => e.song.title) };
    })
  );

  const pdfBuffer = await generateProgramPdf(program.title, sequences);
  const filename = sanitizeFilename(program.title);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
