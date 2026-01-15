"use client";

import { useState, useEffect } from 'react';
import { Bell, BellOff } from 'lucide-react';

interface FollowButtonProps {
    ticker: string;
    theme?: 'light' | 'dark';
    className?: string;
}

export function FollowButton({ ticker, theme = 'light', className = "" }: FollowButtonProps) {
    const [isFollowed, setIsFollowed] = useState(false);
    const [showConfig, setShowConfig] = useState(false);

    // Default config: Follow everything if just clicking "Follow" for first time
    const [selectedTypes, setSelectedTypes] = useState<string[]>(['10-K', '10-Q', '8-K', '4', 'S-1', 'SC 13G', '13F']);

    const ALL_TYPES = ['10-K', '10-Q', '8-K', '4', 'S-1', 'SC 13G', '13F'];

    useEffect(() => {
        if (!ticker) return;
        const followed = JSON.parse(localStorage.getItem('follows') || '[]');

        // Handle migration (string[] -> object[])
        const entry = followed.find((f: any) => (typeof f === 'string' ? f === ticker : f.ticker === ticker));

        if (entry) {
            setIsFollowed(true);
            if (typeof entry !== 'string') {
                setSelectedTypes(entry.types || ALL_TYPES);
            }
        } else {
            setIsFollowed(false);
        }
    }, [ticker]);

    const saveFollow = (newTypes: string[]) => {
        const followed = JSON.parse(localStorage.getItem('follows') || '[]');

        // Remove existing (string or object)
        const cleanList = followed.filter((f: any) => (typeof f === 'string' ? f !== ticker : f.ticker !== ticker));

        if (newTypes.length > 0) {
            cleanList.push({ ticker, types: newTypes });
            setIsFollowed(true);
        } else {
            setIsFollowed(false);
        }

        localStorage.setItem('follows', JSON.stringify(cleanList));
        window.dispatchEvent(new Event('storage'));
        setShowConfig(false);
    };

    const toggleFollow = () => {
        if (!ticker) return;

        // Request permission if not granted
        if (Notification.permission === 'default') {
            Notification.requestPermission();
        }

        if (isFollowed) {
            // Unfollow completely
            saveFollow([]);
        } else {
            // Open config to let them choose? Or default to all? 
            // Better UX: Just follow All immediately, let them configure if they want.
            saveFollow(ALL_TYPES);
            // Optionally open config automatically:
            setShowConfig(true);
        }
    };

    const toggleType = (type: string) => {
        if (selectedTypes.includes(type)) {
            setSelectedTypes(selectedTypes.filter(t => t !== type));
        } else {
            setSelectedTypes([...selectedTypes, type]);
        }
    };

    if (!ticker) return null;

    return (
        <div className="relative inline-block">
            <button
                onClick={toggleFollow}
                className={`transition-all hover:scale-105 active:scale-95 ${className}`}
                title={isFollowed ? `Following ${ticker}` : `Follow ${ticker}`}
            >
                {isFollowed ? (
                    <Bell className="w-5 h-5 text-emerald-500 fill-emerald-500" />
                ) : (
                    <Bell className={`w-5 h-5 ${theme === 'dark' ? 'text-zinc-500 hover:text-emerald-400' : 'text-gray-400 hover:text-emerald-500'}`} />
                )}
            </button>

            {/* Config Popover Trigger (only when followed) */}
            {isFollowed && (
                <button
                    onClick={() => setShowConfig(!showConfig)}
                    className="absolute -top-1 -right-2 w-4 h-4 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-[10px] text-gray-600 border border-gray-300 shadow-sm"
                    title="Configure Alerts"
                >
                    ⚙️
                </button>
            )}

            {showConfig && (
                <div className={`absolute z-50 top-8 left-0 w-48 p-4 rounded-xl shadow-2xl border ${theme === 'dark' ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-200'}`}>
                    <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-bold uppercase tracking-wide">Alert On</span>
                        <button onClick={() => setShowConfig(false)} className="text-gray-400 hover:text-red-500"><BellOff className="w-3 h-3" /></button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                        {ALL_TYPES.map(type => (
                            <label key={type} className="flex items-center gap-2 text-xs cursor-pointer hover:opacity-80">
                                <input
                                    type="checkbox"
                                    checked={selectedTypes.includes(type)}
                                    onChange={() => toggleType(type)}
                                    className="rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                                />
                                <span className={theme === 'dark' ? 'text-zinc-300' : 'text-gray-700'}>{type}</span>
                            </label>
                        ))}
                    </div>
                    <button
                        onClick={() => saveFollow(selectedTypes)}
                        className="w-full mt-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded hover:bg-emerald-600 transition-colors"
                    >
                        Save
                    </button>
                </div>
            )}
        </div>
    );
}
