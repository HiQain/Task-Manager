import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@shared/routes';
import type { User } from '@shared/schema';


interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    error: string | null;
    login: (email: string, password: string) => Promise<User>;
    logout: () => Promise<void>;
    isAuthenticated: boolean;
}

export function useAuth(): AuthContextType {
    const qc = useQueryClient();
    const [error, setError] = useState<string | null>(null);

    // Fetch current user
    const { data: user, isLoading, error: fetchError } = useQuery({
        queryKey: ['auth', 'me'],
        queryFn: async () => {
            try {
                const res = await fetch(api.auth.me.path, {
                    credentials: 'include',
                });
                if (!res.ok) {
                    if (res.status === 401) {
                        return null;
                    }
                    throw new Error('Failed to fetch user');
                }
                return res.json();
            } catch (err) {
                return null;
            }
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: false,
    });

    // Login mutation
    const loginMutation = useMutation({
        mutationFn: async (credentials: { email: string; password: string }) => {
            const res = await fetch(api.auth.login.path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(credentials),
                credentials: 'include',
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || 'Login failed');
            }

            return res.json();
        },
        onSuccess: (data) => {
            setError(null);
            qc?.setQueryData(['auth', 'me'], data);
        },
        onError: (error: Error) => {
            setError(error.message);
        },
    });

    // Logout mutation
    const logoutMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch(api.auth.logout.path, {
                method: 'POST',
                credentials: 'include',
            });

            if (!res.ok) {
                throw new Error('Logout failed');
            }

            return res.json();
        },
        onSuccess: () => {
            setError(null);
            qc?.setQueryData(['auth', 'me'], null);
            qc?.clear();
        },
        onError: (error: Error) => {
            setError(error.message);
        },
    });

    return {
        user: user || null,
        isLoading,
        error: error || (fetchError ? 'Failed to fetch user' : null),
        login: async (email, password) => loginMutation.mutateAsync({ email, password }),
        logout: async () => logoutMutation.mutateAsync(),
        isAuthenticated: !!user,
    };
}
