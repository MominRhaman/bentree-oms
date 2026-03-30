import { useEffect, useRef } from 'react';

export const useScanner = (onScan) => {
    const buffer = useRef('');
    const lastKeyTime = useRef(Date.now());

    useEffect(() => {
        const handleKeyDown = (e) => {
            const currentTime = Date.now();
            
            // If the interval between keys is > 100ms, it's a human typing, so clear the buffer.
            if (currentTime - lastKeyTime.current > 100) {
                buffer.current = '';
            }

            if (e.key === 'Enter') {
                if (buffer.current.length > 2) {
                    onScan(buffer.current);
                    buffer.current = ''; // Clear after successful scan
                }
            } else if (e.key.length === 1) {
                // Add character to buffer
                buffer.current += e.key;
            }

            lastKeyTime.current = currentTime;
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onScan]);
};