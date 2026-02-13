export default function AdminPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Admin Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage app-level configuration for administrators.
        </p>
      </div>

      <div className="bg-card rounded-lg border p-6">
        <h3 className="text-base font-semibold">Overview</h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Use the tabs above to access admin-only settings.
        </p>
      </div>
    </div>
  );
}
