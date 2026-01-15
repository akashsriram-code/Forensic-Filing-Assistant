"use client";

import { useState, useEffect, useRef } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface Suggestion {
    cik: string;
    ticker: string;
    title: string;
}

interface TickerSearchProps {
    value: string;
    onChange: (val: string) => void;
    onSelect?: (ticker: string) => void;
    placeholder?: string;
    theme?: 'light' | 'dark';
    className?: string;
}

export function TickerSearch({ value, onChange, onSelect, placeholder = "Search Ticker...", theme = 'light', className = "" }: TickerSearchProps) {
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Sync internal state if parent updates value directly
    useEffect(() => {
        setQuery(value);
    }, [value]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (query.length < 2) {
                setSuggestions([]);
                return;
            }
            if (query === value && !isOpen) return; // Don't search if we just selected something

            setLoading(true);
            try {
                const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    setSuggestions(data.results || []);
                    setIsOpen(true);
                }
            } catch (e) {
                console.error("Autocomplete fetch failed", e);
            } finally {
                setLoading(false);
            }
        }, 300); // 300ms Debounce

        return () => clearTimeout(timer);
    }, [query]);

    const handleSelect = (s: Suggestion) => {
        setQuery(s.ticker);
        onChange(s.ticker);
        setIsOpen(false);
        if (onSelect) onSelect(s.ticker);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.toUpperCase();
        setQuery(val);
        onChange(val);
        setIsOpen(true);
    };

    return (
        <div ref={wrapperRef} className={`relative w-full ${className}`}>
            <div className="relative">
                <Search className={`absolute left-4 top-3.5 h-5 w-5 ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-400'}`} />
                <input
                    type="text"
                    placeholder={placeholder}
                    className={`w-full pl-12 pr-4 py-3 rounded-lg border outline-none transition-all font-mono text-sm ${theme === 'dark' ? 'bg-black/20 border-zinc-800 focus:border-white text-white placeholder-zinc-600' : 'bg-gray-50 border-gray-200 focus:border-black text-gray-900 placeholder-gray-400'}`}
                    value={query}
                    onChange={handleChange}
                    onFocus={() => query.length > 1 && setIsOpen(true)}
                />
                {loading && (
                    <div className="absolute right-4 top-3.5">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                )}
            </div>

            {isOpen && suggestions.length > 0 && (
                <div className={`absolute z-50 w-full mt-2 rounded-lg border shadow-xl max-h-60 overflow-y-auto ${theme === 'dark' ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'}`}>
                    {suggestions.map((s) => (
                        <div
                            key={s.cik}
                            onClick={() => handleSelect(s)}
                            className={`px-4 py-3 cursor-pointer flex justify-between items-center transition-colors ${theme === 'dark' ? 'hover:bg-zinc-800 border-b border-zinc-800/50' : 'hover:bg-gray-50 border-b border-gray-100'}`}
                        >
                            <div>
                                <span className={`font-bold mr-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{s.ticker}</span>
                                <span className={`text-xs truncate max-w-[200px] inline-block align-bottom ${theme === 'dark' ? 'text-zinc-500' : 'text-gray-500'}`}>{s.title}</span>
                            </div>
                            <span className="text-[10px] font-mono opacity-40">CIK: {s.cik}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
