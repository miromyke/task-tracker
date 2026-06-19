import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/context/auth";
import { AppLayout } from "@/components/AppLayout";
import { LoginPage } from "@/pages/Login";
import { ProjectsPage } from "@/pages/Projects";
import { ProjectOverviewPage } from "@/pages/ProjectOverview";
import { ProjectBoardPage } from "@/pages/ProjectBoard";
import { TaskPage } from "@/pages/Task";
import { CalendarPage } from "@/pages/Calendar";

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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectOverviewPage />} />
          <Route path="/projects/:id/board" element={<ProjectBoardPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
