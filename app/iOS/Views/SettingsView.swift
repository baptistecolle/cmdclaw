//
//  SettingsView.swift
//  BapIOS
//
//  App settings
//

import SwiftUI

struct SettingsView: View {
    @AppStorage("serverURL") private var serverURL = "http://localhost:3000"
    @State private var isTestingConnection = false
    @State private var connectionStatus: ConnectionStatus?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    LabeledContent("URL") {
                        Text(serverURL)
                            .foregroundStyle(.secondary)
                    }

                    Button {
                        testConnection()
                    } label: {
                        HStack {
                            Text("Test Connection")
                            Spacer()
                            if isTestingConnection {
                                ProgressView()
                                    .controlSize(.small)
                            } else if let status = connectionStatus {
                                Image(systemName: status.iconName)
                                    .foregroundStyle(status.color)
                            }
                        }
                    }
                    .disabled(isTestingConnection)
                }

                Section("About") {
                    LabeledContent("Version", value: "1.0.0")
                    LabeledContent("Build", value: "1")
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func testConnection() {
        isTestingConnection = true
        connectionStatus = nil

        Task {
            do {
                guard let url = URL(string: serverURL) else {
                    throw URLError(.badURL)
                }

                let healthURL = url.appendingPathComponent("api/health")
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
}

#Preview {
    SettingsView()
}
