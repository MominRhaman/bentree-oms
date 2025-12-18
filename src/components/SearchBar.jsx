import React from 'react';
import { Search } from 'lucide-react';

const SearchBar = ({ searchTerm, setSearchTerm, placeholder = "Search..." }) => (
    <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
        <input
            className="pl-9 pr-4 py-2 border rounded-full text-sm w-64 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            placeholder={placeholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
        />
    </div>
);

export default SearchBar;