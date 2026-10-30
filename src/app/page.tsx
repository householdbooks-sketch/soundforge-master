'use client';

import dynamic from 'next/dynamic';

const AppContent = dynamic(() => import('./AppContent'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#121518] flex items-center justify-center font-mono text-[#60B0E5] text-sm">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-[#60B0E5] animate-ping" />
        <span>Initializing SoundForge Mastering Rack...</span>
      </div>
    </div>
  ),
});

export default function Page() {
  return <AppContent />;
}
