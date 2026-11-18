import React, { useState } from 'react';
import { AlertTriangle, User, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signInWithCustomToken, signOut, updateProfile } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { GOOGLE_ACCOUNTS } from '../utils';

const LoginPage = ({ onLogin }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');

    const handleGoogle = async () => {
        setError('');
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            const email = result.user.email;

            if (GOOGLE_ACCOUNTS[email]) {
                onLogin(result.user, GOOGLE_ACCOUNTS[email]);
            } else {
                await signOut(auth);
                setError("Access Denied: Email not authorized.");
            }
        } catch (err) {
            console.error(err);
            setError("Google Login Failed. Try again.");
        }
    };

    const handleTraditional = async (e) => {
        e.preventDefault();
        setError('');
        const userKey = username.trim();

        let login;
        try {
            // 1. Verify username/password on the server. It returns a custom
            // token that carries the account role, which Firestore rules trust.
            const credentialLogin = httpsCallable(functions, 'credentialLogin');
            login = (await credentialLogin({ username: userKey, password })).data;
        } catch (err) {
            if (err?.code === 'functions/permission-denied') {
                setError("Invalid Username or Password.");
            } else {
                console.error(err);
                setError("Database Connection Failed.");
            }
            return;
        }

        try {
            // 2. Sign in with the server-issued token to get Firebase Token
            const result = await signInWithCustomToken(auth, login.token);

            const role = login.role;
            const fullName = login.name;

            // 3. CRITICAL FIX: Explicitly update the Firebase Auth Profile
            // This ensures the name persists on reload and shows in the sidebar
            await updateProfile(result.user, {
                displayName: fullName
            });

            // 4. Pass the updated info to the App
            const userInfo = { ...result.user, displayName: fullName };
            onLogin(userInfo, role);

        } catch (err) {
            console.error(err);
            setError("Database Connection Failed.");
        }
    };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-slate-100">
            <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-200">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Bentree OMS</h1>
                    <p className="text-slate-500 text-sm mt-2">Secure Order Management System</p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-center">
                        <AlertTriangle size={16} className="mr-2" /> {error}
                    </div>
                )}

                <form onSubmit={handleTraditional} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Username</label>
                        <div className="relative">
                            <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                className="w-full pl-10 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                placeholder="Enter username"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Password</label>
                        <div className="relative">
                            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                className="w-full pl-10 pr-10 p-3 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(v => !v)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                                title={showPassword ? 'Hide password' : 'Show password'}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>
                    <button type="submit" className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg transition-colors shadow-lg">
                        Login
                    </button>
                </form>

                <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400">Or continue with</span></div>
                </div>

                <button onClick={handleGoogle} className="w-full border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold py-3 rounded-lg flex items-center justify-center transition-colors">
                    <Mail size={18} className="mr-2 text-red-500" /> Sign in with Google
                </button>
            </div>
        </div>
    );
};

export default React.memo(LoginPage);