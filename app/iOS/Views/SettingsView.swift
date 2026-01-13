//
//  SettingsView.swift
//  BapIOS
//
//  App settings
//

import SwiftUI

struct SettingsView: View {
    private var authManager = AuthManager.shared
    @State private var isTestingConnection = false
    @State private var connectionStatus: ConnectionStatus?
    @State private var showSignOutConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                // Account Section
                Section("Account") {
                    if let user = authManager.currentUser {
                        LabeledContent("Email", value: user.email)

                        if let name = user.name {
                            LabeledContent("Name", value: name)
                        }
                    }

                    Button(role: .destructive) {
                        showSignOutConfirmation = true
                    } label: {
                        HStack {
                            Text("Sign Out")
                            Spacer()
                            Image(systemName: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }

                Section("Server") {
                    LabeledContent("Status") {
                        if isTestingConnection {
                            ProgressView()
                                .controlSize(.small)
                        } else if let status = connectionStatus {
                            HStack {
                                Image(systemName: status.iconName)
                                    .foregroundStyle(status.color)
                                Text(status.text)
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Text("Not tested")
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("Test Connection") {
                        testConnection()
                    }
                    .disabled(isTestingConnection)
                }

                Section("About") {
                    LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                    LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
                }
            }
            .navigationTitle("Settings")
        }
        .confirmationDialog(
            "Sign Out",
            isPresented: $showSignOutConfirmation,
            titleVisibility: .visible
        ) {
            Button("Sign Out", role: .destructive) {
                Task {
                    await authManager.signOut()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to sign out?")
        }
    }

    private func testConnection() {
        isTestingConnection = true
        connectionStatus = nil

        Task {
            do {
                #if DEBUG
                let serverURL = "http://localhost:3000"
                #else
                let serverURL = "https://www.heybap.com"
                #endif

                guard let url = URL(string: serverURL) else {
                    throw URLError(.badURL)
                }

                let healthURL = url.appendingPathComponent("api/rpc/health.ping")
                let (_, response) = try await URLSession.shared.data(from: healthURL)

                if let httpResponse = response as? HTTPURLResponse,
                   (200...299).contains(httpResponse.statusCode) {
                    connectionStatus = .connected
                } else {
                    connectionStatus = .failed
                }
            } catch {
                connectionStatus = .failed
            }

            isTestingConnection = false
        }
    }
}

enum ConnectionStatus {
    case connected
    case failed

    var iconName: String {
        switch self {
        case .connected: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        }
    }

    var color: Color {
        switch self {
        case .connected: .green
        case .failed: .red
        }
    }

    var text: String {
        switch self {
        case .connected: "Connected"
        case .failed: "Failed"
        }
    }
}

#Preview {
    SettingsView()
}
