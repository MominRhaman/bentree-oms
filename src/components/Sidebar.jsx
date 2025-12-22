import React, { useRef } from 'react';
import {
    Plus, ClipboardCheck, CheckCircle, Truck, PauseCircle,
    ArrowRightLeft, Ban, Layers, MapPin, Globe, ShoppingBag,
    BarChart3, PieChart, LogOut, Camera, X
} from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab, userRole, onLogout, user, setUser, isOpen, onClose }) => {
    const fileInputRef = useRef(null);

    const allItems = [
        { id: 'new-order', label: 'New Order', icon: Plus, roles: ['master', 'employee', 'qmt'] },
        { id: 'primary', label: 'Primary Orders', icon: ClipboardCheck, roles: ['master', 'employee', 'qmt'] },
        { id: 'confirmed', label: 'Confirmed Orders', icon: CheckCircle, roles: ['master', 'employee', 'qmt'] },
        { id: 'dispatch', label: 'Dispatch Info', icon: Truck, roles: ['master', 'employee', 'qmt'] },
        { id: 'hold', label: 'Hold Orders', icon: PauseCircle, roles: ['master', 'employee', 'qmt'] },
        { id: 'exchange', label: 'Exchange Orders', icon: ArrowRightLeft, roles: ['master', 'employee', 'qmt'] },
        { id: 'cancelled', label: 'Cancel & Return', icon: Ban, roles: ['master', 'employee', 'qmt'] },
        { id: 'inventory', label: 'Inventory', icon: Layers, roles: ['master', 'employee'] },
        { id: 'stock-location', label: 'Stock Location', icon: MapPin, roles: ['master', 'employee'] },
        { id: 'online-sales', label: 'Online Sales', icon: Globe, roles: ['master', 'employee'] },
        { id: 'store-sales', label: 'Store Sales', icon: ShoppingBag, roles: ['master', 'employee'] },
        { id: 'reports', label: 'Sales Reports', icon: BarChart3, roles: ['master'] },
        { id: 'monthly-profit', label: 'Monthly Profit', icon: PieChart, roles: ['master'] },
    ];

    const menuItems = allItems.filter(item => item.roles.includes(userRole));

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        const userName = user?.displayName || 'unknown_user';
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result;
                localStorage.setItem(`bentree_photo_${userName}`, base64String);
                if (setUser && user) setUser({ ...user, photoURL: base64String });
            };
            reader.readAsDataURL(file);
        }
    };

    const displayImage = user?.photoURL;

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
                    onClick={onClose}
                ></div>
            )}

            {/* Sidebar Content */}
            <div className={`fixed left-0 top-0 h-screen bg-slate-900 text-white w-64 z-30 transition-transform duration-300 ease-in-out transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 overflow-y-auto`}>
                
                {/* Close Button (Mobile Only) */}
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 text-slate-400 hover:text-white lg:hidden"
                >
                    <X size={24} />
                </button>

                <div className="p-6 border-b border-slate-800">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative group cursor-pointer" onClick={() => fileInputRef.current.click()}>
                            {displayImage ? (
                                <img
                                    src={displayImage}
                                    alt="Profile"
                                    referrerPolicy="no-referrer"
                                    className="w-12 h-12 rounded-full object-cover border-2 border-emerald-500 shadow-md bg-white"
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-slate-700 border-2 border-slate-600 flex items-center justify-center">
                                    <Camera size={20} className="text-slate-400" />
                                </div>
                            )}
                            
                            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Camera size={16} className="text-white" />
                            </div>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleImageUpload}
                                className="hidden"
                                accept="image/*"
                            />
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-sm font-bold text-white truncate w-32" title={user?.displayName}>
                                {user?.displayName || 'Bentree User'}
                            </p>
                            <div className="mt-1 inline-block px-2 py-0.5 rounded bg-slate-800 text-[10px] text-emerald-400 uppercase font-bold tracking-wide border border-slate-700">
                                {userRole}
                            </div>
                        </div>
                    </div>
                    <h1 className="text-lg font-bold tracking-wider text-slate-500">Bentree OMS</h1>
                    <p className="text-slate-500 text-sm mt-2">Secure Order Management System</p>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    {menuItems.map((item) => (
                        <a
                            key={item.id}
                            href={`/${item.id}`} // UPDATED: Path based URL
                            onClick={(e) => {
                                // 1. Check if CTRL (Windows) or META (Mac Command) key is pressed
                                if (e.ctrlKey || e.metaKey) {
                                    return; // Let browser open new tab
                                }
                                
                                // 2. Normal Click
                                e.preventDefault();
                                setActiveTab(item.id);
                                onClose(); 

                                // 3. Update URL with clean path
                                const newUrl = `/${item.id}`;
                                window.history.pushState({ path: newUrl }, '', newUrl);
                            }}
                            className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors cursor-pointer text-decoration-none ${activeTab === item.id
                                ? 'bg-emerald-600 text-white shadow-lg'
                                : 'text-slate-300 hover:bg-slate-800'
                                }`}
                        >
                            <item.icon size={20} />
                            <span className="font-medium">{item.label}</span>
                        </a>
                    ))}
                </nav>

                <div className="p-4 border-t border-slate-800">
                    <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 text-slate-400 hover:text-white hover:bg-slate-800 p-2 rounded transition-colors text-sm font-medium">
                        <LogOut size={16} /> Logout
                    </button>
                    <div className="mt-4 text-[10px] text-center text-slate-600">
                        v3.3.0 Bentree OMS (Stable)
                    </div>
                </div>
            </div>
        </>
    );
};

export default Sidebar;