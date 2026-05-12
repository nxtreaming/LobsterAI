import mermaid from 'mermaid';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Artifact } from '@/types/artifact';

let mermaidInitialized = false;

function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
  });
  mermaidInitialized = true;
}

interface MermaidRendererProps {
  artifact: Artifact;
}

const MermaidRenderer: React.FC<MermaidRendererProps> = ({ artifact }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setScale(prev => Math.max(0.1, Math.min(5, prev - e.deltaY * 0.001)));
    }
  }, []);

  const resetZoom = useCallback(() => setScale(1), []);
  const zoomIn = useCallback(() => setScale(prev => Math.min(5, prev + 0.1)), []);
  const zoomOut = useCallback(() => setScale(prev => Math.max(0.1, prev - 0.1)), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark');
    if (!mermaidInitialized) {
      initMermaid(isDark);
    }

    let cancelled = false;
    const renderDiagram = async () => {
      try {
        const id = `mermaid-${artifact.id.replace(/[^a-zA-Z0-9]/g, '')}`;
        const { svg: rendered } = await mermaid.render(id, artifact.content);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      }
    };

    renderDiagram();
    return () => { cancelled = true; };
  }, [artifact.content, artifact.id]);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        <p className="font-medium">Mermaid render error</p>
        <pre className="mt-2 text-xs whitespace-pre-wrap">{error}</pre>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div className="w-full h-full overflow-auto" ref={containerRef}>
        <div
          className="flex items-center justify-center min-h-full p-4"
          style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1">
        <button
          onClick={zoomOut}
          disabled={scale <= 0.1}
          className="w-6 h-6 flex items-center justify-center text-xs rounded bg-surface text-secondary hover:bg-surface-hover disabled:opacity-30"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="px-1.5 py-0.5 text-xs rounded bg-surface text-secondary hover:bg-surface-hover tabular-nums"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={zoomIn}
          disabled={scale >= 5}
          className="w-6 h-6 flex items-center justify-center text-xs rounded bg-surface text-secondary hover:bg-surface-hover disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
};

export default MermaidRenderer;
