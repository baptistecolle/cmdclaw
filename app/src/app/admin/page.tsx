export default function AdminPage() {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Admin Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage app-level configuration for administrators.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-6">
        <h3 className="text-base font-semibold">Overview</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the tabs above to access admin-only settings.
        </p>
      </div>
    </div>
  );
}
