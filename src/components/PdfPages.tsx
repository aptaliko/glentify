'use client';

// Renders a lyrics PDF page by page into canvases stacked vertically at the container's width.
// Pages beyond MAX_PDF_PAGES are not rendered, and a note says so. Loaded client-only by the
// live view (next/dynamic, ssr: false) because pdf.js needs the browser and a worker file.
import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { MAX_PDF_PAGES } from '@/lib/stackBlocks';

type Status = 'loading' | 'ready' | 'error';

export default function PdfPages({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | null = null;
    const container = containerRef.current;

    async function render() {
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        task = pdfjsLib.getDocument({ url });
        const loaded = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        const pageCount = Math.min(loaded.numPages, MAX_PDF_PAGES);
        setTruncated(loaded.numPages > MAX_PDF_PAGES);
        const width = container?.clientWidth || 320;

        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
          const page = await loaded.getPage(pageNumber);
          const natural = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / natural.width });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.className = 'mb-2 block h-auto w-full';
          const context = canvas.getContext('2d');
          if (!context) throw new Error('no 2d canvas context');
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          if (cancelled) return;
          container?.appendChild(canvas);
        }
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void render();
    return () => {
      cancelled = true;
      void task?.destroy();
      if (container) container.innerHTML = '';
    };
  }, [url]);

  return (
    <div className="w-full">
      {status === 'loading' && <p className="text-sm text-base-content/60">Φόρτωση PDF…</p>}
      {status === 'error' && (
        <p role="alert" className="text-sm text-error">
          Το PDF δεν φορτώθηκε.
        </p>
      )}
      {status === 'ready' && truncated && (
        <p className="text-xs text-base-content/60">Εμφανίζονται οι πρώτες {MAX_PDF_PAGES} σελίδες.</p>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
