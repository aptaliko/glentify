import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 10 * 1024 * 1024, // 10MB client-side ceiling, same as images
        addRandomSuffix: true, // avoid pathname collisions across users uploading same-named files
      }),
      // Lyrics PDFs use the same flow as images (see image-upload). No onUploadCompleted:
      // this route sits behind proxy.ts's auth gate, and Vercel Blob's
      // completion callback is a server-to-server POST with no cookie/Bearer attached, so it
      // would 401 before reaching handleUpload anyway. No server-side bookkeeping is needed —
      // the client PATCHes the song's pdfUrl itself once upload() resolves.
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
