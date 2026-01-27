import SwiftUI

enum SidebarItem: String, CaseIterable, Identifiable {
    case accessibility = "Accessibility"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .accessibility:
            return "hand.raised.fill"
        }
    }
}

struct HomeView: View {
    @State private var selectedItem: SidebarItem? = .accessibility

    var body: some View {
        NavigationSplitView {
            List(SidebarItem.allCases, selection: $selectedItem) { item in
                Label(item.rawValue, systemImage: item.icon)
                    .tag(item)
            }
            .listStyle(.sidebar)
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
        } detail: {
            if let selected = selectedItem {
                switch selected {
                case .accessibility:
                    AccessibilityPageView()
                }
            } else {
                Text("Select an item from the sidebar")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

struct AccessibilityPageView: View {
    @State private var hasAccessibilityPermission: Bool = false
    @State private var isChecking: Bool = true

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: hasAccessibilityPermission ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                .font(.system(size: 64))
                .foregroundStyle(hasAccessibilityPermission ? .green : .orange)

            Text("Accessibility Permission")
                .font(.title)
                .fontWeight(.semibold)

            if isChecking {
                ProgressView()
                    .scaleEffect(0.8)
                Text("Checking permissions...")
                    .foregroundStyle(.secondary)
            } else if hasAccessibilityPermission {
                VStack(spacing: 8) {
                    Text("Permission Granted")
                        .font(.headline)
                        .foregroundStyle(.green)

                    Text("Bap has the necessary accessibility permissions to capture keyboard shortcuts globally.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 400)
                }
            } else {
                VStack(spacing: 16) {
                    Text("Permission Required")
                        .font(.headline)
                        .foregroundStyle(.orange)

                    Text("Bap needs accessibility permission to listen for the global hotkey (Option + Space). Without this permission, the push-to-talk feature won't work when other apps are focused.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 400)

                    Button(action: openAccessibilitySettings) {
                        Label("Open System Settings", systemImage: "gear")
                    }
                    .buttonStyle(.borderedProminent)
                }
            }

            Spacer()

            Button(action: checkPermission) {
                Label("Refresh Status", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            checkPermission()
        }
    }

    private func checkPermission() {
        isChecking = true

        // Small delay to show the checking state
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            hasAccessibilityPermission = AXIsProcessTrusted()
            isChecking = false
        }
    }

    private func openAccessibilitySettings() {
        let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!
        NSWorkspace.shared.open(url)
    }
}

#Preview {
    HomeView()
        .frame(width: 600, height: 400)
}
