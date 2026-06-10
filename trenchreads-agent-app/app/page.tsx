'use client';
import { useState } from 'react';

export default function Home() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!address) return;
    setLoading(true);
    setResult('');
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenAddress: address }),
      });
      const data = await res.json();
      setResult(JSON.stringify(data.result, null, 2));
    } catch {
      setResult('Error analyzing token');
    }
    setLoading(false);
  };

  return (
    <main className="min-h-screen bg-black text-green-400 p-8">
      <h1 className="text-4xl font-bold mb-2">TrenchReads Agent</h1>
      <p className="text-gray-400 mb-8">Onchain token risk analysis powered by Azure AI Foundry</p>
      <div className="flex gap-4 mb-8">
        <input
          className="flex-1 bg-gray-900 border border-green-400 rounded px-4 py-3 text-white"
          placeholder="Enter token contract address..."
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button
          onClick={analyze}
          disabled={loading}
          className="bg-green-400 text-black px-6 py-3 rounded font-bold hover:bg-green-300 disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>
      {result && (
        <pre className="bg-gray-900 p-6 rounded border border-green-400 whitespace-pre-wrap text-sm">
          {result}
        </pre>
      )}
    </main>
  );
}