"use client";

import { useEffect, useState, useRef } from 'react';
import { Loader2, Upload, Search, FileText, X, CheckCircle, AlertCircle } from 'lucide-react';

interface SearchResult {
    company: string;
    period: string;
    text: string;
    similarity: number;
    source_file: string;
}

interface UploadStatus {
    type: 'success' | 'error' | 'uploading';
    message: string;
}

export function MarketPulse({ theme }: { theme: 'light' | 'dark' }) {
    // Upload state
    const [company, setCompany] = useState('');
    const [period, setPeriod] = useState('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadStatus, setUploadStatus] = useState<UploadStatus | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const [totalChunks, setTotalChunks] = useState(0);
    const [companies, setCompanies] = useState<string[]>([]);

    // Load initial stats
    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const res = await fetch('/api/semantic-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '' })
            });
            const data = await res.json();
            setTotalChunks(data.total_chunks || 0);
            setCompanies(data.companies || []);
        } catch (e) {
            console.error('Failed to fetch stats:', e);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setUploadStatus(null);
        }
    };

    const handleUpload = async () => {
        if (!selectedFile || !company || !period) {
            setUploadStatus({ type: 'error', message: 'Please fill in all fields' });
            return;
        }

        setUploadStatus({ type: 'uploading', message: 'Processing document...' });

        try {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('company', company);
            formData.append('period', period);

            const res = await fetch('/api/upload-document', {
                method: 'POST',
                body: formData
            });

            const result = await res.json();

            if (res.ok) {
                setUploadStatus({
                    type: 'success',
                    message: `Indexed ${result.chunks_indexed} chunks from ${selectedFile.name}`
                });
                setSelectedFile(null);
                setCompany('');
                setPeriod('');
                if (fileInputRef.current) fileInputRef.current.value = '';
                fetchStats();
            } else {
                setUploadStatus({ type: 'error', message: result.error || 'Upload failed' });
            }
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e.message || 'Upload failed' });
        }
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setSearching(true);
        setSearchResults([]);

        try {
            const res = await fetch('/api/semantic-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery })
            });
            const result = await res.json();
            setSearchResults(result.results || []);
            setTotalChunks(result.total_chunks || 0);
            setCompanies(result.companies || []);
        } catch (e) {
            console.error('Search failed:', e);
        } finally {
            setSearching(false);
        }
    };

    const highlightText = (text: string, query: string) => {
        if (!query) return text;
        const words = query.toLowerCase().split(' ').filter(w => w.length > 2);
        let result = text;
        words.forEach(word => {
            const regex = new RegExp(`(${word})`, 'gi');
            result = result.replace(regex, '<mark class="bg-yellow-300 dark:bg-yellow-600 px-0.5 rounded">$1</mark>');
        });
        return result;
    };

    const isDark = theme === 'dark';
    const cardBg = isDark ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-gray-200';
    const inputBg = isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-gray-50 border-gray-200';
    const textMuted = isDark ? 'text-zinc-400' : 'text-gray-500';

    return (
        <div className={`space-y-6 ${isDark ? 'text-white' : 'text-gray-900'}`}>

            {/* Header */}
            <div className={`p-6 rounded-2xl border ${cardBg}`}>
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Search className="w-5 h-5 text-purple-500" />
                            Document Search
                        </h2>
                        <p className={`text-sm ${textMuted}`}>
                            Upload earnings transcripts or filings, then search semantically.
                        </p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-mono font-bold">{totalChunks}</div>
                        <div className={`text-xs uppercase tracking-widest ${textMuted}`}>Chunks Indexed</div>
                    </div>
                </div>

                {/* Companies */}
                {companies.length > 0 && (
                    <div className={`mt-4 text-xs ${textMuted}`}>
                        <span className="font-semibold">Companies:</span> {companies.join(', ')}
                    </div>
                )}
            </div>

            {/* Upload Section */}
            <div className={`p-6 rounded-2xl border ${cardBg}`}>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Upload Document
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${textMuted}`}>Company Name</label>
                        <input
                            type="text"
                            placeholder="e.g., Apple Inc"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-purple-500`}
                        />
                    </div>
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${textMuted}`}>Period</label>
                        <input
                            type="text"
                            placeholder="e.g., Q4 2025"
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                            className={`w-full px-3 py-2 rounded-lg border text-sm ${inputBg} focus:outline-none focus:ring-2 focus:ring-purple-500`}
                        />
                    </div>
                    <div>
                        <label className={`block text-xs font-medium mb-1 ${textMuted}`}>File (PDF, DOCX, TXT)</label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,.docx,.doc,.txt"
                            onChange={handleFileSelect}
                            className={`w-full px-3 py-1.5 rounded-lg border text-sm ${inputBg} file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:text-xs file:bg-purple-500 file:text-white`}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={handleUpload}
                        disabled={!selectedFile || !company || !period || uploadStatus?.type === 'uploading'}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-500 rounded-lg text-white text-sm font-medium transition-colors flex items-center gap-2"
                    >
                        {uploadStatus?.type === 'uploading' ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                        ) : (
                            <><Upload className="w-4 h-4" /> Upload & Index</>
                        )}
                    </button>

                    {uploadStatus && uploadStatus.type !== 'uploading' && (
                        <div className={`flex items-center gap-2 text-sm ${uploadStatus.type === 'success' ? 'text-emerald-500' : 'text-red-500'}`}>
                            {uploadStatus.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            {uploadStatus.message}
                        </div>
                    )}
                </div>
            </div>

            {/* Search Section */}
            <div className={`p-6 rounded-2xl border ${cardBg}`}>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Search className="w-4 h-4" />
                    Semantic Search
                </h3>

                <div className="flex gap-2 mb-4">
                    <div className={`flex-1 flex items-center gap-2 px-4 py-2 rounded-lg border ${inputBg}`}>
                        <Search className="w-4 h-4 opacity-50" />
                        <input
                            type="text"
                            placeholder="Search across all documents... (e.g., 'revenue growth', 'supply chain')"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            className={`flex-1 bg-transparent outline-none text-sm ${isDark ? 'placeholder-zinc-500' : 'placeholder-gray-400'}`}
                        />
                    </div>
                    <button
                        onClick={handleSearch}
                        disabled={searching || !searchQuery.trim()}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-500 rounded-lg text-white text-sm font-medium transition-colors"
                    >
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                    </button>
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                    <div className="space-y-3">
                        <h4 className={`text-xs font-semibold uppercase ${textMuted}`}>
                            Results ({searchResults.length})
                        </h4>
                        {searchResults.map((r, i) => (
                            <div key={i} className={`p-4 rounded-lg border ${isDark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-gray-50 border-gray-200'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div>
                                        <span className="font-bold">{r.company}</span>
                                        <span className={`ml-2 text-sm ${textMuted}`}>{r.period}</span>
                                    </div>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                                        {Math.round(r.similarity * 100)}% match
                                    </span>
                                </div>
                                <p
                                    className={`text-sm ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}
                                    dangerouslySetInnerHTML={{ __html: highlightText(r.text, searchQuery) }}
                                />
                                <div className={`mt-2 text-xs ${textMuted}`}>
                                    <FileText className="w-3 h-3 inline mr-1" />
                                    {r.source_file}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {searchResults.length === 0 && searchQuery && !searching && (
                    <div className={`text-center py-8 ${textMuted}`}>
                        No results found. Try a different search term or upload more documents.
                    </div>
                )}

                {totalChunks === 0 && (
                    <div className={`text-center py-8 ${textMuted}`}>
                        No documents indexed yet. Upload a document above to get started.
                    </div>
                )}
            </div>
        </div>
    );
}
