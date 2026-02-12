import { useAuth } from '@/hooks/use-auth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useQuery } from '@tanstack/react-query';

export default function AdminConsole() {
    const { user } = useAuth();

    // Fetch all users (admin only API could be added later)
    const { data: users = [] } = useQuery({
        queryKey: ['admin', 'users'],
        queryFn: async () => {
            const res = await fetch('/api/users');
            if (!res.ok) throw new Error('Failed to fetch users');
            return res.json();
        },
    });

    if (user?.role !== 'admin') {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-muted-foreground mt-2">Only administrators can access this page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Admin Header */}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h2 className="text-lg font-semibold text-amber-900">Admin Console</h2>
                <p className="text-sm text-amber-700 mt-1">Manage all users and system settings</p>
            </div>

            {/* Users Management Card */}
            <Card className="p-6">
                <h3 className="text-xl font-semibold mb-4">Users Management</h3>

                {users.length === 0 ? (
                    <p className="text-muted-foreground">No users found.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-3 px-4 font-semibold">Name</th>
                                    <th className="text-left py-3 px-4 font-semibold">Email</th>
                                    <th className="text-left py-3 px-4 font-semibold">Role</th>
                                    <th className="text-left py-3 px-4 font-semibold">Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {users.map((user: any) => (
                                    <tr key={user.id} className="border-b hover:bg-muted/50">
                                        <td className="py-3 px-4">{user.name}</td>
                                        <td className="py-3 px-4">{user.email}</td>
                                        <td className="py-3 px-4">
                                            <Badge variant={user.role === 'admin' ? 'default' : 'outline'}>
                                                {user.role}
                                            </Badge>
                                        </td>
                                        <td className="py-3 px-4 text-sm text-muted-foreground">
                                            {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* System Stats Card */}
            <Card className="p-6">
                <h3 className="text-xl font-semibold mb-4">System Statistics</h3>
                <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-muted rounded-lg">
                        <div className="text-2xl font-bold">{users.length}</div>
                        <p className="text-sm text-muted-foreground mt-1">Total Users</p>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                        <div className="text-2xl font-bold">
                            {users.filter((u: any) => u.role === 'admin').length}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Administrators</p>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                        <div className="text-2xl font-bold">
                            {users.filter((u: any) => u.role === 'user').length}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Regular Users</p>
                    </div>
                </div>
            </Card>
        </div>
    );
}
