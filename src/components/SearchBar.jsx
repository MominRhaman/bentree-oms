import React, { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';

const SearchBar = ({ searchTerm, setSearchTerm, placeholder = "Search..." }) => {
    const [localValue, setLocalValue] = useState(searchTerm);
    const timerRef = useRef(null);

    // Sync from parent if searchTerm is cleared externally
    useEffect(() => { if (!searchTerm) setLocalValue(''); }, [searchTerm]);

    const handleChange = (e) => {
        const val = e.target.value;
        setLocalValue(val);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setSearchTerm(val), 250);
    };

    useEffect(() => () => clearTimeout(timerRef.current), []);

    return (
        <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
            <input
                className="pl-9 pr-4 py-2 border rounded-full text-sm w-64 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                placeholder={placeholder}
                value={localValue}
                onChange={handleChange}
            />
        </div>
    );
};

export default React.memo(SearchBar);