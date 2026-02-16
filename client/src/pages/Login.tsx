import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export default function Login() {
    const { login, error, isLoading, isAuthenticated, user } = useAuth();
    const [, setLocation] = useLocation();
    const [formError, setFormError] = useState('');

    const [formData, setFormData] = useState({
        email: '',
        password: '',
    });

    // Redirect to dashboard after successful login
    useEffect(() => {
        if (isAuthenticated && user) {
            if (user.role === "admin") {
                setLocation('/');
            } else {
                setLocation('/board');
            }
        }
    }, [isAuthenticated, user, setLocation]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setFormError('');

        try {
            await login(formData.email, formData.password);
            setFormData({ email: '', password: '' });
        } catch (err) {
            setFormError(err instanceof Error ? err.message : 'An error occurred');
        }
    };



    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <div className="p-8">
                    {/* Header */}
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold mb-2">Task Master</h1>
                        <p className="text-gray-500">Sign in to your account</p>
                    </div>

                    {/* Error Alert */}
                    {(error || formError) && (
                        <Alert variant="destructive" className="mb-6">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{error || formError}</AlertDescription>
                        </Alert>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-4">

                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                name="email"
                                type="email"
                                placeholder="you@example.com"
                                value={formData.email}
                                onChange={handleChange}
                                disabled={isLoading}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                name="password"
                                type="password"
                                placeholder="••••••••"
                                value={formData.password}
                                onChange={handleChange}
                                disabled={isLoading}
                                required
                            />
                        </div>



                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isLoading}
                        >
                            {isLoading ? 'Loading...' : 'Sign In'}
                        </Button>
                    </form>



                    {/* Demo Info */}
                    {/* {!isRegister && (
                        <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
                            <p className="text-sm font-semibold text-blue-900 mb-2">Demo Credentials:</p>
                            <div className="text-xs text-blue-800 space-y-1">
                                <p><strong>Admin:</strong> admin@example.com / password</p>
                                <p><strong>User:</strong> alice@example.com / password</p>
                            </div>
                        </div>
                    )} */}
                </div>
            </Card>
        </div>
    );
}
