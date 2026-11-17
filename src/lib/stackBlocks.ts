// Which pieces of a song's content the live view shows, in display order:
// score image, then lyrics PDF, then typed lyrics. A piece counts only when it has
// non-whitespace content, so an empty URL or blank lyrics never produces a block.
export type StackBlock = 'image' | 'pdf' | 'lyrics';

// Pages rendered from a lyrics PDF; the rest are skipped to bound memory on the phone.
export const MAX_PDF_PAGES = 50;

function present(value: string | null): boolean {
  return value !== null && value.trim() !== '';
}

export function selectStackBlocks(input: {
  imageUrl: string | null;
  pdfUrl: string | null;
  lyrics: string | null;
}): StackBlock[] {
  const blocks: StackBlock[] = [];
  if (present(input.imageUrl)) blocks.push('image');
  if (present(input.pdfUrl)) blocks.push('pdf');
  if (present(input.lyrics)) blocks.push('lyrics');
  return blocks;
}
