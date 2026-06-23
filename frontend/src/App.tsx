import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/context/auth";
import { AppLayout } from "@/components/AppLayout";
import { EnvBadge } from "@/components/EnvBadge";
import { LoginPage } from "@/pages/Login";
import { ProjectsPage } from "@/pages/Projects";
import { TaskPage } from "@/pages/Task";
import { ChatPage } from "@/pages/Chat";
import { UsersPage } from "@/pages/Users";

// Old per-project routes now map onto the overview's project filter.
function ProjectRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/?project=${id}` : "/"} replace />;
}

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

// RequireAdmin gates admin-only routes; non-admins are bounced to the overview.
function RequireAdmin() {
  const { user } = useAuth();
  if (user && user.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <AuthProvider>
      <EnvBadge />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectRedirect />} />
          <Route path="/projects/:id/board" element={<ProjectRedirect />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
