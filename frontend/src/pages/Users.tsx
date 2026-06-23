import { UserManagementPanel } from "@/components/UserManagement";

// UsersPage is the admin-only user management surface, formerly a dialog inside
// the account modal. Route access is gated in App.tsx (non-admins redirect away).
// The panel owns its own heading + "Add member" action and a responsive card grid.
export function UsersPage() {
  return (
    <div className="pt-1">
      <UserManagementPanel />
    </div>
  );
}
